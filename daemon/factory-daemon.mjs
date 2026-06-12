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
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildDashboard, statusText } from '../scripts/build-dashboard.mjs';
import { monitorPass, healthText } from '../scripts/monitor.mjs';

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DAEMON_DIR = path.join(ROOT, 'daemon');
const LOG_DIR = path.join(DAEMON_DIR, 'logs');
const STATE_FILE = path.join(DAEMON_DIR, 'state.json');
const CONFIG = JSON.parse(fs.readFileSync(path.join(DAEMON_DIR, 'config.json'), 'utf8'));
const MON = { intervalSeconds: 300, failThreshold: 3, timeoutMs: 10000, autoIncident: false, incidentCooldownMinutes: 60, ...(CONFIG.monitor || {}) };
const PROMPT_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'build-prompt.md'), 'utf8');
const INCIDENT_TEMPLATE = fs.readFileSync(path.join(DAEMON_DIR, 'incident-prompt.md'), 'utf8');

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

function slugify(idea) {
  let base = idea.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim()
    .split(/\s+/).slice(0, 4).join('-').slice(0, 32).replace(/^-+|-+$/g, '') || 'product';
  let slug = base, n = 2;
  while (fs.existsSync(path.join(ROOT, 'products', slug))) slug = `${base}-${n++}`;
  return slug;
}

async function handleMessage(msg) {
  const chatId = msg.chat?.id;
  const text = (msg.text || '').trim();
  if (!chatId || !text) return;

  if (!CONFIG.allowedChatIds.includes(chatId)) {
    if (!warnedChats.has(chatId)) {
      warnedChats.add(chatId);
      await send(chatId, `This factory doesn't know you yet.\nYour chat id: ${chatId}\nAdd it to daemon/config.json → allowedChatIds and restart the daemon.`);
    }
    return;
  }

  if (text === '/start') {
    await send(chatId, `AI-Factory online. Chat id ${chatId} is authorized.\n\nSend any message describing a product idea and I'll build it.\n/status — progress of all products\n/health — live health of deployed products\n/help — commands`);
  } else if (text === '/status') {
    await send(chatId, statusText(ROOT));
  } else if (text === '/health') {
    await send(chatId, healthText(ROOT));
  } else if (text === '/help') {
    await send(chatId, 'Send a plain message = new product idea (scaffold → GitHub repo → autonomous build).\n/status — progress overview\n/health — deployment health\n/start — show chat id');
  } else if (text.startsWith('/')) {
    await send(chatId, `Unknown command ${text.split(' ')[0]}. /help for commands.`);
  } else {
    state.queue.push({ idea: text, chatId });
    saveState();
    const position = state.queue.length + running.size;
    await send(chatId, running.size >= CONFIG.concurrency
      ? `Idea queued (position ${position}). I'll start when a build slot frees up.`
      : 'Idea received — starting the build pipeline.');
    pump();
  }
}

function pump() {
  while (running.size < CONFIG.concurrency && state.queue.length > 0) {
    const job = state.queue.shift();
    saveState();
    startBuild(job).catch(async err => {
      log('build failed to start:', err.message);
      await send(job.chatId, `Failed to start build: ${err.message}`);
    });
  }
}

async function startBuild({ idea, chatId }) {
  const slug = slugify(idea);
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
  const logFile = fs.openSync(path.join(LOG_DIR, `${slug}.log`), 'a');
  const child = spawn(CONFIG.claudeBin,
    ['-p', prompt, '--permission-mode', CONFIG.permissionMode, ...CONFIG.extraClaudeArgs],
    { cwd: dest, stdio: ['ignore', logFile, logFile], detached: false });

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
    const report = fs.existsSync(path.join(dest, 'FINAL-REPORT.md'))
      ? '\nFINAL-REPORT.md is in the repo.' : '';
    await send(chatId, code === 0
      ? `✅ "${slug}" build finished.\n${repoUrl}${report}\n/status for the overview.`
      : `⚠️ "${slug}" build exited with code ${code}. Last log: daemon/logs/${slug}.log\n${repoUrl}${report}`);
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

let pushingDashboard = false;
function refreshDashboard() {
  const products = buildDashboard(ROOT);
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
  const logFile = fs.openSync(path.join(LOG_DIR, `${name}-incident.log`), 'a');
  spawn(CONFIG.claudeBin, ['-p', prompt, '--permission-mode', CONFIG.permissionMode, ...CONFIG.extraClaudeArgs],
    { cwd: dest, stdio: ['ignore', logFile, logFile] });
  log(`incident agent dispatched: ${name}`);
  for (const chatId of CONFIG.allowedChatIds) send(chatId, `🚑 Incident agent dispatched for ${name} — diagnose + safe rollback only; report lands in the repo as INCIDENT-*.md`);
}

// --- main long-poll loop -----------------------------------------------------
log(`factory daemon up — owner=${CONFIG.githubOwner}, concurrency=${CONFIG.concurrency}, allowed chats: ${CONFIG.allowedChatIds.join(', ') || '(none yet — send /start to your bot to get your chat id)'}`);
refreshDashboard();
pump(); // resume any queue persisted across restarts
runMonitor();
setInterval(runMonitor, MON.intervalSeconds * 1000);

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
