#!/usr/bin/env node
// AI-Factory daemon — Telegram ingress for product ideas. Zero dependencies (Node >= 20).
//
//   TELEGRAM_BOT_TOKEN=... node daemon/factory-daemon.mjs
//
// Flow: idea arrives in an allowlisted chat → product workspace scaffolded →
// GitHub repo created and pushed → headless `claude` build launched with the
// factory pipeline → phase-change pings + dashboard regeneration → completion report.
//
// Chat commands:  /start (greet + chat id) · /status (progress overview) · /help
// Any other text message is treated as a product idea.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildDashboard, statusText } from '../scripts/build-dashboard.mjs';
import { monitorPass, healthText } from '../scripts/monitor.mjs';
import { makeLineParser, applyTaskOps } from '../scripts/agent-stream.mjs';
import { checkUpstreams } from '../scripts/check-upstreams.mjs';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAEMON_DIR = path.join(ROOT, 'daemon');
const LOG_DIR = path.join(DAEMON_DIR, 'logs');
const STATE_FILE = path.join(DAEMON_DIR, 'state.json');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DAEMON_DIR, 'config.json'), 'utf8'));
const MON = { intervalSeconds: 300, failThreshold: 3, timeoutMs: 10000, autoIncident: false, incidentCooldownMinutes: 60, ...(CONFIG.monitor || {}) };
const PROMPT_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'build-prompt.md'), 'utf8');
const INCIDENT_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'incident-prompt.md'), 'utf8');
const UPDATE_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'update-prompt.md'), 'utf8');
const QA_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'qa-prompt.md'), 'utf8');
const QA_ENABLED = CONFIG.qa?.enabled !== false;
const UPGRADE_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'upgrade-prompt.md'), 'utf8');
const STRATEGY_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'strategy-prompt.md'), 'utf8');

// --- self-check mode (no token needed): validate environment and exit -------
if (process.argv.includes('--check')) {
  const checks = [];
  for (const bin of [CONFIG.claudeBin, 'gh', 'git']) {
    try { await execFileP('which', [bin]); checks.push(`ok: ${bin}`); }
    catch { checks.push(`MISSING: ${bin}`); }
  }
  try {
    await execFileP('gh', ['auth', 'status']);
    checks.push('ok: gh authenticated');
  } catch { checks.push('FAIL: gh not authenticated (run `gh auth login`)'); }
  checks.push(fs.existsSync(path.join(ROOT, 'scripts', 'new-product.sh')) ? 'ok: new-product.sh' : 'MISSING: scripts/new-product.sh');
  try {
    const { stdout } = await execFileP('npx', ['-y', 'wrangler', 'whoami'], { timeout: 60000 });
    checks.push(/not authenticated/i.test(stdout) ? 'note: Cloudflare not connected — run `npx wrangler login` once to enable autonomous hosting' : 'ok: Cloudflare connected (autonomous hosting enabled)');
  } catch { checks.push('note: Cloudflare check failed — run `npx wrangler login` once to enable autonomous hosting'); }
  checks.push(process.env.TELEGRAM_BOT_TOKEN ? 'ok: TELEGRAM_BOT_TOKEN set' : 'note: TELEGRAM_BOT_TOKEN not set (required to run)');
  console.log(checks.join('\n'));
  process.exit(checks.some(c => c.startsWith('MISSING') || c.startsWith('FAIL')) ? 1 : 0);
}

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Create a bot with @BotFather and export the token.');
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;

fs.mkdirSync(LOG_DIR, { recursive: true });
const state = loadState();
const running = new Map(); // slug -> { child, chatId, watcher, lastPhaseSig }
const warnedChats = new Set();
const pendingIdeas = new Map(); // chatId -> message text awaiting new-vs-update routing
const pendingStrategy = new Map(); // chatId -> {slug,dest,idea,repoUrl} awaiting strategy approval

function listProducts() {
  try {
    return fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
  } catch { return []; }
}

function readSummary(dest, file) {
  try { return fs.readFileSync(path.join(dest, file), 'utf8').trim().slice(0, 1500); } catch { return ''; }
}

// Did a failed run die from provider-side capacity issues rather than its own work?
function isTransientFailure(logBase) {
  try {
    const tail = fs.readFileSync(path.join(LOG_DIR, `${logBase}.log`), 'utf8').slice(-12000);
    return /overloaded|rate.?limit|status.?529|temporarily unavailable/i.test(tail);
  } catch { return false; }
}

// Spawn a headless agent whose every action streams into the product's
// .factory-activity.json — the dashboard's live activity feed.
function spawnAgent(dest, prompt, logName, runKind) {
  const logStream = fs.createWriteStream(path.join(LOG_DIR, `${logName}.log`), { flags: 'a' });
  const child = spawn(CONFIG.claudeBin,
    ['-p', prompt, '--permission-mode', CONFIG.permissionMode, '--output-format', 'stream-json', '--verbose', ...CONFIG.extraClaudeArgs],
    { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });

  const actFile = path.join(dest, '.factory-activity.json');
  let act = { updatedAt: null, counts: { actions: 0, writes: 0, commands: 0 }, entries: [], tasks: [] };
  try { act = { ...act, ...JSON.parse(fs.readFileSync(actFile, 'utf8')) }; } catch {}
  act.tasks = []; // each run gets a fresh task list; history lives in the feed
  if (runKind) act.runKind = runKind;
  let dirty = false;
  const parser = makeLineParser((entry) => {
    act.counts.actions++;
    if (entry.kind === 'write') act.counts.writes++;
    if (entry.kind === 'command') act.counts.commands++;
    act.entries.push(entry);
    if (act.entries.length > 40) act.entries = act.entries.slice(-40);
    act.updatedAt = entry.t;
    dirty = true;
  }, (ops) => {
    act.tasks = applyTaskOps(act.tasks || [], ops);
    dirty = true;
  });
  const flush = setInterval(() => {
    if (!dirty) return;
    dirty = false;
    try { fs.writeFileSync(actFile, JSON.stringify(act)); } catch {}
  }, 2000);
  child.stdout.on('data', (c) => { logStream.write(c); parser(c); });
  child.stderr.on('data', (c) => logStream.write(c));
  child.on('exit', () => {
    clearInterval(flush);
    try { fs.writeFileSync(actFile, JSON.stringify(act)); } catch {}
    logStream.end();
  });
  return child;
}

function loadState() {
  try { return { queue: [], active: [], lastUpdateId: 0, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }; }
  catch { return { queue: [], active: [], lastUpdateId: 0 }; }
}
function saveState() {
  state.active = [...running.keys()];
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function tg(method, params) {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err) {
    log(`telegram ${method} failed:`, err.message);
    return { ok: false };
  }
}
const send = (chatId, text) => tg('sendMessage', { chat_id: chatId, text: String(text).slice(0, 4000) });

function dashboardLink() {
  return (typeof tunnelUrl !== 'undefined' && tunnelUrl) || `http://localhost:${CONFIG.dashboardPort || 7717}`;
}

function slugify(text) {
  let base = text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim()
    .split(/\s+/).join('-').slice(0, 40).replace(/^-+|-+$/g, '') || 'product';
  let slug = base, n = 2;
  while (fs.existsSync(path.join(ROOT, 'products', slug))) slug = `${base}-${n++}`;
  return slug;
}

const STOPWORDS = new Set(['a', 'an', 'the', 'i', 'we', 'my', 'our', 'your', 'for', 'with', 'and', 'or', 'to', 'of', 'in', 'on', 'that', 'this', 'it', 'is', 'be', 'want', 'need', 'make', 'build', 'create', 'please', 'can', 'you', 'me', 'app', 'website', 'site', 'product', 'just', 'like', 'some']);
function suggestName(idea) {
  const words = idea.toLowerCase().replace(/[^a-z0-9\s-]/g, '').split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w)).slice(0, 3);
  return words.length ? words.join('-').slice(0, 40) : 'my-product';
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  if (!chatId) return;

  if (!CONFIG.allowedChatIds.includes(chatId)) {
    if (!warnedChats.has(chatId)) {
      warnedChats.add(chatId);
      await send(chatId, `This factory doesn't know you yet.\nYour chat id: ${chatId}\nAdd it to daemon/config.json → allowedChatIds and restart the daemon.`);
    }
    return;
  }

  const text = (msg.text || '').trim();
  if (!text) {
    if (msg.voice || msg.audio || msg.video_note) {
      await send(chatId, "I can't listen to voice notes yet — please type it as a regular message.");
    } else if (msg.photo || msg.document || msg.video || msg.sticker) {
      await send(chatId, 'I can only read text for now — please describe it in a message.');
    }
    return;
  }

  if (text === '/start') {
    await send(chatId, `AI-Factory online. Chat id ${chatId} is authorized.\n\nSend any message describing a product idea — I'll always confirm before starting anything.\n\n📊 Live dashboard: ${dashboardLink()}\n(login: factory — tip: pin this message)\n\n/status — progress of all products\n/health — live health of deployed products\n/dashboard — dashboard link\n/cancel — stop everything\n/help — commands`);
  } else if (text === '/dashboard') {
    await send(chatId, `📊 ${dashboardLink()}\nLogin: factory + your dashboard password.\nUpdates live while builds run — pin this message for one-tap access.`);
  } else if (text === '/status') {
    await send(chatId, statusText(ROOT));
  } else if (text === '/health') {
    await send(chatId, healthText(ROOT));
  } else if (text === '/help') {
    await send(chatId, 'Just text me in plain words — I always ask before starting anything.\n\n• New product idea → I build it and send you the link.\n• Problem or change ("the payment button is broken") → tap which product, I fix it.\n• Voice notes aren\'t supported yet — please type.\n\n/status — how every product is going\n/health — are the live products up\n/dashboard — live dashboard link\n/cancel — stop everything queued or running\n/start — show chat id');
  } else if (text === '/cancel') {
    const queued = state.queue.length;
    state.queue = [];
    saveState();
    pendingIdeas.delete(chatId);
    pendingStrategy.delete(chatId);
    const killed = [];
    for (const [key, entry] of running) {
      try { entry.child.kill('SIGTERM'); killed.push(key); } catch {}
    }
    await send(chatId, queued || killed.length
      ? `Stopped. Cancelled ${queued} waiting and stopped ${killed.length} running (${killed.join(', ') || 'none'}). Anything already created stays until you tell me to remove it.`
      : 'Nothing was running or waiting.');
  } else if (text.startsWith('/')) {
    await send(chatId, `Unknown command ${text.split(' ')[0]}. /help for commands.`);
  } else if (pendingStrategy.has(chatId)) {
    await handleStrategyReply(chatId, text);
  } else {
    await routeIdea(chatId, text);
  }
}

const preview = (s) => (s.length > 90 ? s.slice(0, 90) + '…' : s);

// Two deliberate taps before anything is created:
//   stage 'route'   — what is this? (new product / which product / ignore)
//   stage 'confirm' — final summary, explicit ✅ Yes / ❌ Cancel
async function routeIdea(chatId, text) {
  const products = listProducts();
  const pending = pendingIdeas.get(chatId);

  if (pending?.stage === 'confirm') {
    pendingIdeas.delete(chatId);
    if (text.startsWith('✅') || /^yes/i.test(text)) {
      await enqueue(pending.action);
    } else if (text.startsWith('❌') || /^(no|cancel)/i.test(text)) {
      await send(chatId, 'Cancelled. Nothing was started.');
    } else {
      await send(chatId, 'That wasn\'t a ✅, so I cancelled the previous request. Now, about your new message:');
      await routeIdea(chatId, text);
    }
    return;
  }

  if (pending?.stage === 'name') {
    pendingIdeas.delete(chatId);
    if (/ignore|cancel/i.test(text) || text.startsWith('❌')) {
      await send(chatId, 'Cancelled. Nothing was started.');
      return;
    }
    const name = slugify(text);
    const action = { type: 'build', idea: pending.idea, chatId, name };
    pendingIdeas.set(chatId, { stage: 'confirm', idea: pending.idea, action });
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Final check — I'm about to build "${name}" from:\n"${preview(pending.idea)}"\n\nThat means: a private repo called ${name}, an autonomous build, and a live demo link when done.\n\nGo ahead?`,
      reply_markup: {
        keyboard: [[{ text: '✅ Yes, start' }], [{ text: '❌ Cancel' }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    return;
  }

  if (pending?.stage === 'route') {
    pendingIdeas.delete(chatId);
    if (/ignore/i.test(text) || text.startsWith('❌')) {
      await send(chatId, 'Okay, ignored. Nothing was started.');
      return;
    }
    if (/new product/i.test(text) || text.startsWith('🆕')) {
      pendingIdeas.set(chatId, { stage: 'name', idea: pending.idea });
      await tg('sendMessage', {
        chat_id: chatId,
        text: 'What should this product be called? Tap my suggestion or type your own name (it becomes the repo and demo link, e.g. yoga-booking):',
        reply_markup: {
          keyboard: [[{ text: suggestName(pending.idea) }], [{ text: '❌ Cancel' }]],
          one_time_keyboard: true,
          resize_keyboard: true,
        },
      });
      return;
    }
    const pick = text.trim().toLowerCase();
    const target = products.find(p => p.toLowerCase() === pick) || products.find(p => pick.includes(p.toLowerCase()));
    if (!target) {
      await send(chatId, `I don't recognize "${text.trim()}", so nothing was started. Send the request again to retry.`);
      return;
    }
    const action = { type: 'update', product: target, idea: pending.idea, chatId };
    pendingIdeas.set(chatId, { stage: 'confirm', idea: pending.idea, action });
    await tg('sendMessage', {
      chat_id: chatId,
      text: `Final check — I'm about to change "${target}" based on:\n"${preview(pending.idea)}"\n\nGo ahead?`,
      reply_markup: {
        keyboard: [[{ text: '✅ Yes, start' }], [{ text: '❌ Cancel' }]],
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    });
    return;
  }

  // Fresh message — never create anything without the two confirmations above.
  pendingIdeas.set(chatId, { stage: 'route', idea: text });
  await tg('sendMessage', {
    chat_id: chatId,
    text: `Before I start anything — what should I do with this?\n\n"${preview(text)}"`,
    reply_markup: {
      keyboard: [
        [{ text: '🆕 Build this as a new product' }],
        ...products.map(p => [{ text: p }]),
        [{ text: '❌ Ignore that message' }],
      ],
      one_time_keyboard: true,
      resize_keyboard: true,
    },
  });
}

async function enqueue(job) {
  state.queue.push(job);
  saveState();
  const verb = job.type === 'update' ? `change to "${job.product}"` : 'new product build';
  const busy = job.type === 'update' && running.has(job.product);
  await send(job.chatId, (busy
    ? `"${job.product}" is being worked on right now — I'll apply this change the moment it finishes.`
    : running.size >= CONFIG.concurrency
      ? `Queued: ${verb} (${state.queue.length} in line). I'll start as soon as a slot frees up.`
      : `On it — starting the ${verb} now.`) + `\nWatch live: ${dashboardLink()}\nSend /cancel anytime to stop everything.`);
  pump();
}

function pump() {
  while (running.size < CONFIG.concurrency && state.queue.length > 0) {
    const job = state.queue[0];
    if (job.type === 'update' && running.has(job.product)) break; // that product is busy; wait for it
    state.queue.shift();
    saveState();
    const start = job.type === 'update' ? startUpdate : startBuild;
    start(job).catch(async err => {
      log('job failed to start:', err.message);
      await send(job.chatId, `Couldn't start that: ${err.message}`);
    });
  }
}

async function startUpdate({ product, idea, chatId, qaRound = 0, retried = 0 }) {
  const dest = path.join(ROOT, 'products', product);
  if (!fs.existsSync(dest)) throw new Error(`product "${product}" is not on this machine`);
  const prompt = UPDATE_TEMPLATE.replace('{{PRODUCT}}', product).replace('{{REQUEST}}', idea);
  const child = spawnAgent(dest, prompt, `${product}-update`, "change");
  running.set(product, { child, chatId });
  saveState();
  refreshDashboard();
  await send(chatId, `🔧 Working on "${product}" now — I'll report here when it's done. Watch live: ${dashboardLink()}`);
  child.on('exit', async (code) => {
    running.delete(product);
    saveState();
    try { await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: update checkpoint'); } catch {}
    try { await gitIn(dest, 'push', 'origin', 'HEAD'); } catch (err) { log(`${product}: update push failed:`, err.message); }
    refreshDashboard();
    if (code === 0 && QA_ENABLED) {
      await send(chatId, `🛠 Change to "${product}" finished — independent QA is testing it before I call it done.`);
      startQA(product, dest, chatId, qaRound, 'UPDATE-SUMMARY.txt', '');
      return;
    }
    if (code !== 0 && !retried && isTransientFailure(`${product}-update`)) {
      await send(chatId, `⚠️ The AI service hit a temporary capacity limit while working on "${product}" — retrying automatically.`);
      state.queue.push({ type: 'update', product, idea, chatId, qaRound, retried: 1 });
      saveState();
      pump();
      return;
    }
    const summary = readSummary(dest, 'UPDATE-SUMMARY.txt');
    await send(chatId, code === 0
      ? `✅ Done with "${product}".\n\n${summary || 'The change is in, but no summary was written — ask me to check if unsure.'}`
      : `⚠️ The change to "${product}" hit a problem.\n${summary || `I saved the details in daemon/logs/${product}-update.log.`}`);
    pump();
  });
}

async function startBuild({ idea, chatId, name }) {
  const slug = name && fs.existsSync(path.join(ROOT, 'products', name)) ? slugify(name) : (name || slugify(suggestName(idea)));
  const dest = path.join(ROOT, 'products', slug);
  await send(chatId, `🏭 "${slug}" — scaffolding the repo, then drawing up the strategy for your approval (no code until you approve).`);
  // Scaffold workspace + GitHub repo + record the idea
  await execFileP('bash', [path.join(ROOT, 'scripts', 'new-product.sh'), slug, '--github', '--owner', CONFIG.githubOwner],
    { cwd: ROOT, env: { ...process.env, FACTORY_REPO_VISIBILITY: CONFIG.repoVisibility } });
  fs.writeFileSync(path.join(dest, 'IDEA.md'), `# Product idea\n\n${idea}\n\n_Received via factory bot, ${new Date().toISOString()}_\n`);
  await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: record product idea');
  await gitIn(dest, 'push', '-u', 'origin', 'HEAD');
  const repoUrl = `https://github.com/${CONFIG.githubOwner}/${slug}`;
  // MANDATORY strategy gate (step 1) — deliberate a strategy, present for human approval before any build
  await runStrategy(slug, dest, chatId, idea, repoUrl, '');
}

// Step 1 (mandatory): office-hours strategy → STRATEGY.md → present to founder for approval.
async function runStrategy(slug, dest, chatId, idea, repoUrl, feedback) {
  await send(chatId, `🧭 Deliberating the strategy for "${slug}" — I'll send it for your approval shortly (no build until then).`);
  const prompt = STRATEGY_TEMPLATE.replace('{{IDEA}}', idea)
    .replace('{{FEEDBACK}}', feedback ? `\nFOUNDER FEEDBACK on the previous strategy — revise to address it:\n${feedback}\n` : '');
  const child = spawnAgent(dest, prompt, `${slug}-strategy`, 'strategy');
  running.set(slug, { child, chatId });
  saveState(); refreshDashboard();
  child.on('exit', async () => {
    running.delete(slug); saveState();
    try { await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: product strategy'); await gitIn(dest, 'push', 'origin', 'HEAD'); } catch {}
    refreshDashboard();
    const summary = readSummary(dest, 'STRATEGY-SUMMARY.txt') || readSummary(dest, 'STRATEGY.md') || 'Strategy written — open STRATEGY.md in the repo.';
    pendingStrategy.set(chatId, { slug, dest, idea, repoUrl });
    await tg('sendMessage', {
      chat_id: chatId,
      text: `🧭 STRATEGY for "${slug}" — approve before I build:\n\n${summary.slice(0, 3200)}\n\n✅ Approve to build · type any changes to revise · ❌ Cancel`,
      reply_markup: { keyboard: [[{ text: '✅ Approve & build' }], [{ text: '❌ Cancel' }]], one_time_keyboard: true, resize_keyboard: true },
    });
    pump();
  });
}

async function handleStrategyReply(chatId, text) {
  const s = pendingStrategy.get(chatId);
  if (!s) return;
  const t = text.trim();
  if (/^✅|^approve|^yes\b|^go\b|build/i.test(t)) {
    pendingStrategy.delete(chatId);
    await send(chatId, `Approved — building "${s.slug}" to the strategy now, through the full pipeline (research → plan review → design → build → QA → staged).`);
    runProductBuild(s.slug, s.dest, chatId, s.repoUrl, s.idea);
  } else if (/^❌|^cancel|^stop/i.test(t)) {
    pendingStrategy.delete(chatId);
    await send(chatId, `Cancelled "${s.slug}". The repo + strategy are saved; say the word to resume.`);
  } else {
    pendingStrategy.delete(chatId);
    await send(chatId, `Revising the strategy for "${s.slug}" with your input — I'll resend it for approval.`);
    runStrategy(s.slug, s.dest, chatId, s.idea, s.repoUrl, t);
  }
}

// The actual build — only reached after the founder approves the strategy.
async function runProductBuild(slug, dest, chatId, repoUrl, idea, retried = 0) {
  const prompt = PROMPT_TEMPLATE.replace('{{IDEA}}', idea);
  const child = spawnAgent(dest, prompt, slug, 'build');
  const entry = { child, chatId, lastPhaseSig: '' };
  entry.watcher = setInterval(() => checkProgress(slug, dest, entry), CONFIG.statusPollSeconds * 1000);
  running.set(slug, entry);
  saveState(); refreshDashboard();
  child.on('exit', async (code) => {
    clearInterval(entry.watcher); running.delete(slug); saveState();
    try { await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: final build state'); } catch {}
    try { await gitIn(dest, 'push', 'origin', 'HEAD'); } catch (err) { log(`${slug}: final push failed:`, err.message); }
    refreshDashboard();
    if (code === 0 && QA_ENABLED) {
      await send(chatId, `🛠 "${slug}" build finished — handing it to independent QA before I call it done.`);
      startQA(slug, dest, chatId, 0, 'BUILD-SUMMARY.txt', repoUrl);
      return;
    }
    if (code !== 0 && !retried && isTransientFailure(slug)) {
      await send(chatId, `⚠️ The AI service hit a temporary capacity limit on "${slug}" — retrying automatically.`);
      runProductBuild(slug, dest, chatId, repoUrl, idea, 1);
      return;
    }
    const summary = readSummary(dest, 'BUILD-SUMMARY.txt');
    await send(chatId, code === 0
      ? `✅ "${slug}" is built.\n\n${summary || 'No summary was written — the full report (FINAL-REPORT.md) is in the repo.'}\n\n${repoUrl}\n/status for the overview.`
      : `⚠️ The "${slug}" build stopped early.\n${summary || `Details saved to daemon/logs/${slug}.log.`}\n${repoUrl}`);
    pump();
  });
}

async function checkProgress(slug, dest, entry) {
  try {
    const products = refreshDashboard();
    const p = products.find(x => x.name === slug);
    if (!p) return;
    const sig = `${p.phases.filter(ph => ph.done).length}/${p.phases.length}|${p.stateLine}`;
    if (sig !== entry.lastPhaseSig && (p.phases.length || p.stateLine)) {
      entry.lastPhaseSig = sig;
      const done = p.phases.filter(ph => ph.done).length;
      await send(entry.chatId, `📦 ${slug}: ${p.pct}%${p.phases.length ? ` · phase ${Math.min(done + 1, p.phases.length)}/${p.phases.length}` : ''}${p.stateLine ? `\n${p.stateLine}` : ''}`);
    }
  } catch (err) {
    log(`${slug}: progress check failed:`, err.message);
  }
}

function refreshDashboard() {
  return buildDashboard(ROOT);
}

const gitIn = (cwd, ...args) => execFileP('git', ['-C', cwd, ...args]);

// Self-heal: a daemon restart/crash mid-build orphans the agent, so the staged
// result is never promoted. On boot, recover any product left with a staged
// build: promote it if QA already passed, otherwise re-queue it to finish.
function reconcileOnBoot() {
  for (const name of listProducts()) {
    if (running.has(name)) continue;
    const dest = path.join(ROOT, 'products', name);
    if (!fs.existsSync(path.join(dest, 'DEPLOY-STAGED.json'))) continue;
    const verdict = readSummary(dest, 'QA-VERDICT.txt');
    if (/^PASS/i.test(verdict)) {
      log(`reconcile: ${name} has a QA-passed staged build never promoted — promoting`);
      promoteStaged(name, dest).then(r => {
        if (r.promoted) { startCanary(name, dest, CONFIG.allowedChatIds[0]); for (const c of CONFIG.allowedChatIds) send(c, `🔧 Recovered a finished build of "${name}" that a restart had stranded — now promoted to production.`); }
      }).catch(err => log(`reconcile promote failed for ${name}:`, err.message));
    } else {
      log(`reconcile: ${name} has an unpromoted staged build — re-queuing to finish`);
      state.queue.push({ type: 'update', product: name, chatId: CONFIG.allowedChatIds[0], idea: 'A staged build from a previous session was left unfinished by a restart. Verify it, resolve any remaining QA findings, re-stage, and let the factory promote on QA pass.' });
      saveState(); pump();
    }
  }
}

// --- production protection: staged promotion, canary, deterministic rollback --
async function quickCheck(dest) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(dest, 'DEPLOY.json'), 'utf8'));
    const base = d.url || d.live_url;
    if (!base) return null;
    const url = d.health_url || new URL(d.healthPath || '/', base).href;
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10000) });
    return { ok: res.status >= 200 && res.status < 400, status: res.status, url };
  } catch (err) {
    return { ok: false, status: 0, url: '', err: err.message };
  }
}

// QA passed -> the factory (not the agent) sends the staged version to production.
async function promoteStaged(name, dest) {
  const stagedFile = path.join(dest, 'DEPLOY-STAGED.json');
  if (!fs.existsSync(stagedFile)) return { promoted: false, reason: 'nothing staged' };
  const staged = JSON.parse(fs.readFileSync(stagedFile, 'utf8'));
  if (!staged.promoteCommand) return { promoted: false, reason: 'no promote command recorded' };
  log(`promoting ${name} to production`);
  await execFileP('bash', ['-lc', staged.promoteCommand], { cwd: dest, timeout: 300000 });
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 15000));
    const c = await quickCheck(dest);
    if (c?.ok) {
      fs.renameSync(stagedFile, path.join(dest, '.last-promotion.json'));
      try { await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: promote QA-approved version to production'); await gitIn(dest, 'push', 'origin', 'HEAD'); } catch {}
      return { promoted: true };
    }
  }
  return { promoted: false, reason: 'production health did not confirm after promotion' };
}

// 10-minute canary after anything reaches production; two strikes -> roll back.
function startCanary(name, dest, chatId) {
  if (!fs.existsSync(path.join(dest, 'DEPLOY.json'))) return;
  let fails = 0, ticks = 0;
  log(`canary watching ${name}`);
  const timer = setInterval(async () => {
    ticks++;
    const c = await quickCheck(dest);
    if (!c) { clearInterval(timer); return; }
    fails = c.ok ? 0 : fails + 1;
    if (fails >= 2) { clearInterval(timer); await rollbackProduct(name, dest, chatId, c); return; }
    if (ticks >= 20) { clearInterval(timer); log(`canary clean: ${name}`); }
  }, 30000);
}

async function rollbackProduct(name, dest, chatId, evidence) {
  log(`CANARY FAILED for ${name} — rolling back production`);
  let recovered = false;
  try {
    await execFileP('bash', ['-lc', "printf 'y\\n' | npx -y wrangler rollback 2>&1 | tail -3"], { cwd: dest, timeout: 180000 });
    for (let i = 0; i < 3 && !recovered; i++) {
      await new Promise(r => setTimeout(r, 20000));
      const c = await quickCheck(dest);
      if (c?.ok) recovered = true;
    }
  } catch (err) { log('deterministic rollback failed:', err.message); }
  if (recovered) {
    await send(chatId, `⚡ A fresh update to "${name}" started failing live checks minutes after going out — I rolled production back to the previous working version immediately. Customers are unaffected. A corrected version is being prepared and will be fully re-tested before it goes anywhere near production.`);
    state.queue.push({ type: 'update', product: name, chatId, idea: `The promoted version was automatically ROLLED BACK after failing live canary checks (${evidence?.status ?? 'no response'} at ${evidence?.url || 'health URL'}). Production now runs the previous version. Reproduce why the new version failed in real production conditions (bindings, migrations, cold starts), fix at root cause with tests proving it, and stage the corrected version for QA. Do not rush.` });
    saveState();
    pump();
  } else {
    maybeSpawnIncident(name, { url: evidence?.url || '', error: 'post-promotion canary failure; deterministic rollback unconfirmed', httpStatus: evidence?.status || 0, fails: 2, lastIncidentAt: null });
  }
}

// Independent QA gate: a separate agent (fresh context, tester persona) tries to
// break what the builder just shipped. FAIL triggers ONE bounded fix-and-retest
// round, then we report honestly instead of looping.
function startQA(name, dest, chatId, qaRound, summaryFile, repoUrl) {
  const prompt = QA_TEMPLATE.replace('{{PRODUCT}}', name);
  const child = spawnAgent(dest, prompt, `${name}-qa`, "qa");
  running.set(name, { child, chatId });
  saveState();
  refreshDashboard();
  child.on('exit', async () => {
    running.delete(name);
    saveState();
    try { await gitIn(dest, 'add', '-A'); await gitIn(dest, 'commit', '-m', 'factory: QA round artifacts'); } catch {}
    try { await gitIn(dest, 'push', 'origin', 'HEAD'); } catch (err) { log(`${name}: QA push failed:`, err.message); }
    refreshDashboard();
    const verdictRaw = readSummary(dest, 'QA-VERDICT.txt');
    const pass = /^PASS/i.test(verdictRaw);
    const verdict = verdictRaw.replace(/^(PASS|FAIL)\s*/i, '').trim();
    const summary = readSummary(dest, summaryFile);
    if (pass) {
      let promoteNote = '';
      try {
        const result = await promoteStaged(name, dest);
        if (result.promoted) promoteNote = '\nThe QA-approved version is now live in production.';
        else if (result.reason !== 'nothing staged') promoteNote = `\n⚠️ Promotion to production did not complete (${result.reason}) — production still runs the previous version. I'll need another pass at this.`;
      } catch (err) {
        promoteNote = `\n⚠️ Promotion to production failed (${err.message.slice(0, 120)}) — production still runs the previous version.`;
      }
      await send(chatId, `🧪✅ Independent QA passed "${name}".\n${verdict}\n\n${summary || ''}${promoteNote}${repoUrl ? `\n${repoUrl}` : ''}`.trim());
      startCanary(name, dest, chatId);
    } else if (!verdictRaw) {
      await send(chatId, `🧪⚠️ QA finished for "${name}" but wrote no verdict — treat it as untested. QA log: daemon/logs/${name}-qa.log\n\n${summary || ''}`.trim());
    } else if (qaRound >= 1) {
      await send(chatId, `🧪❌ QA still finds problems in "${name}" after one fix round. I'm stopping and being honest instead of looping:\n${verdict || 'See QA-REPORT.md in the repo.'}\nSend me a message when you want another round.`);
    } else {
      await send(chatId, `🧪🔧 QA found problems in "${name}" — fixing them now, then re-testing:\n${verdict || 'See QA-REPORT.md.'}`);
      state.queue.push({
        type: 'update',
        product: name,
        chatId,
        qaRound: 1,
        idea: 'Independent QA just failed this product — fix every finding in QA-REPORT.md at root cause, with tests proving each fix. Do not edit or delete QA-REPORT.md or QA-VERDICT.txt; the next QA round will rewrite them.',
      });
      saveState();
    }
    pump();
  });
}

// --- continuous monitoring: cheap HTTP checks, AI agent only on failure ------
async function runMonitor() {
  try {
    const { transitions } = await monitorPass(ROOT, MON);
    for (const t of transitions) {
      const text = t.to === 'down'
        ? `🔴 ${t.name} is DOWN — ${t.entry.error || 'HTTP ' + t.entry.httpStatus} on ${t.entry.fails} consecutive checks\n${t.entry.url}`
        : `🟢 ${t.name} recovered (${t.entry.ms}ms)\n${t.entry.url}`;
      for (const chatId of CONFIG.allowedChatIds) await send(chatId, text);
      if (t.to === 'down' && MON.autoIncident) maybeSpawnIncident(t.name, t.entry);
    }
    if (transitions.length) refreshDashboard();
  } catch (err) {
    log('monitor error:', err.message);
  }
}

function maybeSpawnIncident(name, entry) {
  const dest = path.join(ROOT, 'products', name);
  if (!fs.existsSync(dest)) return;
  const last = entry.lastIncidentAt ? Date.parse(entry.lastIncidentAt) : 0;
  if (Date.now() - last < MON.incidentCooldownMinutes * 60_000) return;
  try { // persist the cooldown stamp so restarts don't re-dispatch
    const hf = path.join(DAEMON_DIR, 'health.json');
    const h = JSON.parse(fs.readFileSync(hf, 'utf8'));
    if (h.products?.[name]) {
      h.products[name].lastIncidentAt = new Date().toISOString();
      fs.writeFileSync(hf, JSON.stringify(h, null, 2));
    }
  } catch {}
  const prompt = INCIDENT_TEMPLATE
    .replace('{{PRODUCT}}', name)
    .replace('{{URL}}', entry.url)
    .replace('{{OBSERVED}}', entry.error || `HTTP ${entry.httpStatus}, ${entry.fails} consecutive failures`);
  const child = spawnAgent(dest, prompt, `${name}-incident`, "incident");
  log(`incident agent dispatched: ${name}`);
  for (const chatId of CONFIG.allowedChatIds) send(chatId, `🚑 ${name} is having trouble — I'm on it. I'll fix it and report back; no action needed from you.`);
  child.on('exit', async (code) => {
    refreshDashboard();
    const summary = readSummary(dest, 'INCIDENT-SUMMARY.txt');
    for (const chatId of CONFIG.allowedChatIds) {
      await send(chatId, code === 0
        ? `🚑 ${name}: stabilized.\n\n${summary || 'Handled, but no summary was written — /health to confirm it is up.'}`
        : `🚑 ${name}: I couldn't stabilize this on my own.\n${summary || `Details: daemon/logs/${name}-incident.log`}`);
    }
    // Root-cause fixes go through the full pipeline (build -> QA -> staged promotion).
    if (/^NEEDS-FIX/i.test(readSummary(dest, 'INCIDENT-VERDICT.txt'))) {
      state.queue.push({ type: 'update', product: name, chatId: CONFIG.allowedChatIds[0], idea: 'An incident just occurred on this product (see the latest INCIDENT-*.md). Production was stabilized on the previous version. Fix the root cause with tests proving it, and stage the corrected version for QA — never deploy to production directly.' });
      saveState();
      pump();
    }
  });
}

// --- autonomous self-upgrade: watch vendored sources, apply what matters ------
// Founder directive: important upgrades happen autonomously; silence on no-ops,
// one plain-language line after material upgrades, a ping only if humans needed.
let upgradeRunning = false;
async function runUpstreamCheck() {
  if (upgradeRunning || running.size > 0) return; // only in quiet moments
  try {
    const updates = await checkUpstreams(ROOT);
    if (!updates.length) return;
    upgradeRunning = true;
    log('upstream updates detected:', updates.map(u => `${u.name}+${u.ahead}`).join(' '));
    const preSha = (await gitIn(ROOT, 'rev-parse', 'HEAD')).stdout.trim();
    const child = spawnAgent(ROOT, UPGRADE_TEMPLATE, 'factory-upgrade');
    child.on('exit', async (code) => {
      upgradeRunning = false;
      const s = readSummary(ROOT, 'UPGRADE-SUMMARY.txt');
      try { fs.unlinkSync(path.join(ROOT, 'UPGRADE-SUMMARY.txt')); } catch {}
      try { fs.unlinkSync(path.join(ROOT, '.factory-activity.json')); } catch {}
      // Verify the kit after ANY upgrade attempt; a damaged kit rolls back instantly.
      let kitOk = true;
      try { await execFileP('node', [path.join(ROOT, 'scripts', 'verify-kit.mjs')]); } catch { kitOk = false; }
      if (!kitOk) {
        log('KIT VERIFICATION FAILED after upgrade — rolling back to', preSha.slice(0, 7));
        try {
          await gitIn(ROOT, 'reset', '--hard', preSha);
          await gitIn(ROOT, 'push', '--force-with-lease', 'origin', 'main');
        } catch (err) { log('kit rollback push issue:', err.message); }
        for (const c of CONFIG.allowedChatIds) await send(c, '🛡 A toolkit upgrade failed verification and was rolled back automatically — the factory is unchanged and healthy. It will be re-attempted carefully on the next cycle.');
        return;
      }
      if (code !== 0) {
        for (const c of CONFIG.allowedChatIds) await send(c, '⚠️ The factory tried to update its own toolkit and hit a problem — it will retry tomorrow. (Log: daemon/logs/factory-upgrade.log)');
      } else if (/^MATERIAL/i.test(s)) {
        for (const c of CONFIG.allowedChatIds) await send(c, `🆙 Factory toolkit upgraded itself.\n${s.replace(/^MATERIAL\s*/i, '').trim()}`);
      } else {
        log('upstream check: nothing material; pins updated');
      }
    });
  } catch (err) {
    upgradeRunning = false;
    log('upstream check failed:', err.message);
  }
}
setTimeout(runUpstreamCheck, 10 * 60 * 1000);          // first pass 10 min after boot
setInterval(runUpstreamCheck, 24 * 60 * 60 * 1000);    // then daily

// --- live dashboard server (localhost only) ----------------------------------
let lastGen = 0;
function freshDashboard() {
  if (Date.now() - lastGen > 3000) { buildDashboard(ROOT); lastGen = Date.now(); }
}
const DASH_PORT = CONFIG.dashboardPort || 7717;
// Basic-auth gate so the dashboard is safe to expose through a tunnel.
// Set daemon/.env DASHBOARD_VIEW_PASSWORD (user "factory"); no password = localhost-only, open.
const VIEW_PW = process.env.DASHBOARD_VIEW_PASSWORD || '';
function dashAuthed(req) {
  if (!VIEW_PW) return true; // no password set → open
  // Direct access on the iMac (Host: localhost/127.0.0.1) needs no login; only
  // the public tunnel (Host: *.trycloudflare.com etc.) requires the password.
  const host = (req.headers['host'] || '').toLowerCase();
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return true;
  const h = req.headers['authorization'] || '';
  return h === 'Basic ' + Buffer.from('factory:' + VIEW_PW).toString('base64');
}
http.createServer((req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    if (!dashAuthed(req)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="AI-Factory"' });
      res.end('sign in'); return;
    }
    if (url === '/' || url === '/index.html') {
      freshDashboard();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html')));
    } else if (url === '/data.json') {
      freshDashboard();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'dashboard', 'data.json')));
    } else if (url === '/request' && req.method === 'POST') {
      let b = '';
      req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
      req.on('end', () => {
        try {
          const j = JSON.parse(b || '{}');
          if (j.product && j.text && fs.existsSync(path.join(ROOT, 'products', j.product))) {
            const label = j.kind === 'bug' ? 'Bug from dashboard' : j.kind === 'scope' ? 'Scope edit from dashboard' : 'Change from dashboard';
            state.queue.push({ type: 'update', product: j.product, chatId: CONFIG.allowedChatIds[0], idea: `${label}: ${j.text}` });
            saveState();
            for (const c of CONFIG.allowedChatIds) send(c, `📥 ${label} for "${j.product}": ${j.text}\nQueued — runs through QA before promotion.`);
            pump();
            res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
          } else { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); }
        } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"ok":false}'); }
      });
    } else {
      res.writeHead(404); res.end('not found');
    }
  } catch (err) {
    res.writeHead(500); res.end(String(err.message));
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Another factory daemon is already running (port ${DASH_PORT} busy). Exiting — only one factory at a time.`);
    process.exit(1);
  }
  log('dashboard server error:', err.message);
}).listen(DASH_PORT, '127.0.0.1', () => log(`dashboard live at http://localhost:${DASH_PORT}`));

// --- remote access: self-managed Cloudflare quick tunnel to the dashboard -----
// Exposes the (basic-auth-gated) local dashboard at a public HTTPS URL, captures
// the assigned URL, and texts it once. Restart = fresh URL, re-announced.
let tunnelUrl = '';
function startTunnel() {
  if (CONFIG.tunnel === false) return;
  // resolve cloudflared by absolute path (launchd PATH may not include brew dirs)
  const bin = ['/opt/homebrew/bin/cloudflared', '/usr/local/bin/cloudflared'].find(p => fs.existsSync(p)) || 'cloudflared';
  const t = spawn(bin, ['tunnel', '--url', `http://localhost:${DASH_PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (c) => {
    const m = String(c).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && !tunnelUrl) {
      tunnelUrl = m[0];
      log('remote tunnel up:', tunnelUrl);
      for (const chatId of CONFIG.allowedChatIds) {
        send(chatId, `🌐 Remote dashboard is live:\n${tunnelUrl}\nLogin: factory · ${VIEW_PW}\n(URL changes if the factory restarts — I'll send the new one.)`);
      }
    }
  };
  t.stdout.on('data', onData); t.stderr.on('data', onData);
  t.on('exit', () => { log('tunnel exited; restarting in 10s'); tunnelUrl = ''; setTimeout(startTunnel, 10000); });
}
startTunnel();

// --- main long-poll loop -----------------------------------------------------
log(`factory daemon up — owner=${CONFIG.githubOwner}, concurrency=${CONFIG.concurrency}, allowed chats: ${CONFIG.allowedChatIds.join(', ') || '(none yet — send /start to your bot to get your chat id)'}`);
refreshDashboard();
pump(); // resume any queue persisted across restarts
reconcileOnBoot(); // self-heal: pick up builds stranded by a previous restart/crash
runMonitor();
setInterval(runMonitor, MON.intervalSeconds * 1000);
// While any agent is working, keep the dashboard (and its cloud copy) fresh so
// the live activity feed actually ticks for remote viewers.
setInterval(() => { if (running.size) refreshDashboard(); }, 20_000);


let backoff = 1;
while (true) {
  const res = await tg('getUpdates', { offset: state.lastUpdateId + 1, timeout: 50, allowed_updates: ['message'] });
  if (!res.ok) {
    await new Promise(r => setTimeout(r, Math.min(backoff *= 2, 60) * 1000));
    continue;
  }
  backoff = 1;
  for (const update of res.result || []) {
    state.lastUpdateId = Math.max(state.lastUpdateId, update.update_id);
    saveState();
    try { await handleMessage(update.message || {}); }
    catch (err) { log('handler error:', err.message); }
  }
}
