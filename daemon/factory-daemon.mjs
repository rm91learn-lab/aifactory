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

function listProducts() {
  try {
    return fs.readdirSync(path.join(ROOT, 'products'), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
  } catch { return []; }
}

function readSummary(dest, file) {
  try { return fs.readFileSync(path.join(dest, file), 'utf8').trim().slice(0, 1500); } catch { return ''; }
}

// Spawn a headless agent whose every action streams into the product's
// .factory-activity.json — the dashboard's live activity feed.
function spawnAgent(dest, prompt, logName) {
  const logStream = fs.createWriteStream(path.join(LOG_DIR, `${logName}.log`), { flags: 'a' });
  const child = spawn(CONFIG.claudeBin,
    ['-p', prompt, '--permission-mode', CONFIG.permissionMode, '--output-format', 'stream-json', '--verbose', ...CONFIG.extraClaudeArgs],
    { cwd: dest, stdio: ['ignore', 'pipe', 'pipe'] });

  const actFile = path.join(dest, '.factory-activity.json');
  let act = { updatedAt: null, counts: { actions: 0, writes: 0, commands: 0 }, entries: [], tasks: [] };
  try { act = { ...act, ...JSON.parse(fs.readFileSync(actFile, 'utf8')) }; } catch {}
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
  const cloud = CONFIG.cloudDashboard;
  return cloud?.enabled && cloud.url ? cloud.url : `http://localhost:${CONFIG.dashboardPort || 7717}`;
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
    const killed = [];
    for (const [key, entry] of running) {
      try { entry.child.kill('SIGTERM'); killed.push(key); } catch {}
    }
    await send(chatId, queued || killed.length
      ? `Stopped. Cancelled ${queued} waiting and stopped ${killed.length} running (${killed.join(', ') || 'none'}). Anything already created stays until you tell me to remove it.`
      : 'Nothing was running or waiting.');
  } else if (text.startsWith('/')) {
    await send(chatId, `Unknown command ${text.split(' ')[0]}. /help for commands.`);
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

async function startUpdate({ product, idea, chatId }) {
  const dest = path.join(ROOT, 'products', product);
  if (!fs.existsSync(dest)) throw new Error(`product "${product}" is not on this machine`);
  const prompt = UPDATE_TEMPLATE.replace('{{PRODUCT}}', product).replace('{{REQUEST}}', idea);
  const child = spawnAgent(dest, prompt, `${product}-update`);
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
  await send(chatId, `🏭 Building "${slug}"\n1/3 scaffolding workspace…`);

  // 1. Scaffold workspace + create GitHub repo (new-product.sh handles both).
  await execFileP('bash', [path.join(ROOT, 'scripts', 'new-product.sh'), slug, '--github', '--owner', CONFIG.githubOwner],
    { cwd: ROOT, env: { ...process.env, FACTORY_REPO_VISIBILITY: CONFIG.repoVisibility } });

  // 2. Record the idea verbatim and push it.
  fs.writeFileSync(path.join(dest, 'IDEA.md'), `# Product idea\n\n${idea}\n\n_Received via factory bot, ${new Date().toISOString()}_\n`);
  await gitIn(dest, 'add', '-A');
  await gitIn(dest, 'commit', '-m', 'factory: record product idea');
  await gitIn(dest, 'push', '-u', 'origin', 'HEAD');
  const repoUrl = `https://github.com/${CONFIG.githubOwner}/${slug}`;
  await send(chatId, `2/3 repo created: ${repoUrl}\n3/3 launching autonomous build — I'll ping you at each phase. /status anytime.`);

  // 3. Launch the headless build.
  const prompt = PROMPT_TEMPLATE.replace('{{IDEA}}', idea);
  const child = spawnAgent(dest, prompt, slug);

  const entry = { child, chatId, lastPhaseSig: '' };
  entry.watcher = setInterval(() => checkProgress(slug, dest, entry), CONFIG.statusPollSeconds * 1000);
  running.set(slug, entry);
  saveState();
  refreshDashboard();

  child.on('exit', async (code) => {
    clearInterval(entry.watcher);
    running.delete(slug);
    saveState();
    // Safety net: push anything the build left uncommitted, then the final state.
    try {
      await gitIn(dest, 'add', '-A');
      await gitIn(dest, 'commit', '-m', 'factory: final build state');
    } catch { /* nothing to commit */ }
    try { await gitIn(dest, 'push', 'origin', 'HEAD'); } catch (err) { log(`${slug}: final push failed:`, err.message); }
    refreshDashboard();
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

let lastCloudPush = 0;
function pushDashboardOnline() {
  const cloud = CONFIG.cloudDashboard;
  const token = process.env.DASHBOARD_PUSH_TOKEN;
  if (!cloud?.enabled || !cloud.url || !token) return;
  if (Date.now() - lastCloudPush < 10_000) return;
  lastCloudPush = Date.now();
  try {
    const html = fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html'), 'utf8');
    const data = fs.readFileSync(path.join(ROOT, 'dashboard', 'data.json'), 'utf8');
    fetch(`${cloud.url.replace(/\/$/, '')}/update`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ html, data }),
    }).catch(err => log('cloud dashboard push failed:', err.message));
  } catch (err) {
    log('cloud dashboard push failed:', err.message);
  }
}

let pushingDashboard = false;
function refreshDashboard() {
  const products = buildDashboard(ROOT);
  pushDashboardOnline();
  if (CONFIG.pushDashboard && !pushingDashboard) {
    pushingDashboard = true;
    (async () => {
      try {
        await gitIn(ROOT, 'add', 'dashboard');
        await gitIn(ROOT, 'commit', '-m', 'dashboard: refresh');
        await gitIn(ROOT, 'push');
      } catch { /* no changes or push race — fine */ }
      pushingDashboard = false;
    })();
  }
  return products;
}

const gitIn = (cwd, ...args) => execFileP('git', ['-C', cwd, ...args]);

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
  const child = spawnAgent(dest, prompt, `${name}-incident`);
  log(`incident agent dispatched: ${name}`);
  for (const chatId of CONFIG.allowedChatIds) send(chatId, `🚑 ${name} is having trouble — I'm on it. I'll fix it and report back; no action needed from you.`);
  child.on('exit', async (code) => {
    refreshDashboard();
    const summary = readSummary(dest, 'INCIDENT-SUMMARY.txt');
    for (const chatId of CONFIG.allowedChatIds) {
      await send(chatId, code === 0
        ? `🚑 ${name}: handled.\n\n${summary || 'Fixed, but no summary was written — /health to confirm it is up.'}`
        : `🚑 ${name}: I couldn't finish fixing this on my own.\n${summary || `Details: daemon/logs/${name}-incident.log`}`);
    }
  });
}

// --- live dashboard server (localhost only) ----------------------------------
let lastGen = 0;
function freshDashboard() {
  if (Date.now() - lastGen > 3000) { buildDashboard(ROOT); lastGen = Date.now(); }
}
const DASH_PORT = CONFIG.dashboardPort || 7717;
http.createServer((req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    if (url === '/' || url === '/index.html') {
      freshDashboard();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(ROOT, 'dashboard', 'index.html')));
    } else if (url === '/data.json') {
      freshDashboard();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(fs.readFileSync(path.join(ROOT, 'dashboard', 'data.json')));
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

// --- main long-poll loop -----------------------------------------------------
log(`factory daemon up — owner=${CONFIG.githubOwner}, concurrency=${CONFIG.concurrency}, allowed chats: ${CONFIG.allowedChatIds.join(', ') || '(none yet — send /start to your bot to get your chat id)'}`);
refreshDashboard();
pump(); // resume any queue persisted across restarts
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
