#!/usr/bin/env node
// AI-Factory health monitor — zero dependencies.
// Cheap layer of the monitoring stack: HTTP checks for every product that has a
// DEPLOY.json (written by the deploy skill), state tracked in daemon/health.json.
// The daemon runs this on an interval and escalates transitions; it can also be
// run standalone (one pass): node scripts/monitor.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULTS = { failThreshold: 3, timeoutMs: 10000 };

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function check(url, timeoutMs) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    return { up: res.status >= 200 && res.status < 400, httpStatus: res.status, ms: Date.now() - started };
  } catch (err) {
    return { up: false, httpStatus: 0, ms: Date.now() - started, error: err.name === 'TimeoutError' ? 'timeout' : err.message };
  }
}

// One monitoring pass over all products. Returns { health, transitions } where a
// transition is emitted when a product crosses up->down (after failThreshold
// consecutive failures) or down->up.
export async function monitorPass(root = ROOT, cfg = {}) {
  const { failThreshold, timeoutMs } = { ...DEFAULTS, ...cfg };
  const healthFile = path.join(root, 'daemon', 'health.json');
  const prev = readJson(healthFile)?.products || {};
  const products = {};
  const transitions = [];

  let names = [];
  try {
    names = fs.readdirSync(path.join(root, 'products'), { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name);
  } catch {}

  for (const name of names) {
    const deploy = readJson(path.join(root, 'products', name, 'DEPLOY.json'));
    const base = deploy?.url || deploy?.live_url;
    if (!base) continue;
    const url = deploy.health_url || new URL(deploy.healthPath || '/', base).href;
    const result = await check(url, timeoutMs);
    const before = prev[name] || { fails: 0, alerted: false };
    const fails = result.up ? 0 : (before.fails || 0) + 1;
    const entry = {
      url,
      platform: deploy.platform || '',
      ...result,
      fails,
      alerted: before.alerted || false,
      downSince: result.up ? null : (before.downSince || new Date().toISOString()),
      lastIncidentAt: before.lastIncidentAt || null,
      checkedAt: new Date().toISOString(),
    };
    if (!result.up && fails >= failThreshold && !before.alerted) {
      entry.alerted = true;
      transitions.push({ name, to: 'down', entry });
    } else if (result.up && before.alerted) {
      entry.alerted = false;
      transitions.push({ name, to: 'up', entry });
    }
    products[name] = entry;
  }

  fs.mkdirSync(path.dirname(healthFile), { recursive: true });
  const health = { checkedAt: new Date().toISOString(), products };
  fs.writeFileSync(healthFile, JSON.stringify(health, null, 2));
  return { health, transitions };
}

export function healthText(root = ROOT) {
  const health = readJson(path.join(root, 'daemon', 'health.json'));
  const entries = Object.entries(health?.products || {});
  if (!entries.length) return 'No deployed products being monitored (deploy writes DEPLOY.json to enable).';
  return entries.map(([name, h]) =>
    `${h.up ? '🟢' : '🔴'} ${name} — ${h.up ? `up · ${h.ms}ms` : `DOWN since ${h.downSince || '?'} (${h.error || 'HTTP ' + h.httpStatus})`}\n${h.url}`
  ).join('\n\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { health, transitions } = await monitorPass();
  const n = Object.keys(health.products).length;
  console.log(`checked ${n} deployed product(s); ${transitions.length} transition(s)`);
  console.log(healthText());
}
