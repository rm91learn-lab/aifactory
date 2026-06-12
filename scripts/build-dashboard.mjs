#!/usr/bin/env node
// AI-Factory dashboard generator — zero dependencies.
// Scans products/*/.planning and emits dashboard/index.html + dashboard/data.json.
// Also exported as a module: collectProducts() is reused by the factory daemon for /status.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(cwd, ...args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function parsePhases(planningDir) {
  // GSD layout: .planning/phases/<NN-name>/ with SUMMARY*.md written when the phase completes.
  const phasesDir = path.join(planningDir, 'phases');
  let dirs = [];
  try {
    dirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name).sort();
  } catch { return []; }
  return dirs.map(name => {
    let done = false;
    try { done = fs.readdirSync(path.join(phasesDir, name)).some(f => /^SUMMARY/i.test(f)); } catch {}
    return { name: name.replace(/^\d+[-_]?/, '').replace(/[-_]/g, ' ') || name, done };
  });
}

function parseCheckboxes(text) {
  const done = (text.match(/^\s*[-*] \[x\]/gim) || []).length;
  const total = done + (text.match(/^\s*[-*] \[ \]/gim) || []).length;
  return { done, total };
}

function parseStateLine(text) {
  for (const re of [/current\s*phase[^:\n]*:\s*(.+)/i, /status[^:\n]*:\s*(.+)/i, /position[^:\n]*:\s*(.+)/i]) {
    const m = text.match(re);
    if (m) return m[1].replace(/[*_`]/g, '').trim().slice(0, 120);
  }
  return '';
}

function parseVersion(productDir) {
  const v = read(path.join(productDir, 'VERSION')).trim();
  if (/^\d+\.\d+/.test(v)) return v;
  const m = read(path.join(productDir, 'CHANGELOG.md')).match(/^#+\s*\[?v?(\d+\.\d+\.\d+)/m);
  return m ? m[1] : '';
}

export function collectProducts(root = ROOT) {
  const productsDir = path.join(root, 'products');
  let names = [];
  try {
    names = fs.readdirSync(productsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort();
  } catch {}

  // Daemon marks in-flight builds in daemon/state.json.
  let active = [];
  try { active = JSON.parse(read(path.join(root, 'daemon', 'state.json'))).active || []; } catch {}

  return names.map(name => {
    const dir = path.join(productsDir, name);
    const planning = path.join(dir, '.planning');
    const phases = parsePhases(planning);
    const boxes = parseCheckboxes(read(path.join(planning, 'ROADMAP.md')));
    const phasesDone = phases.filter(p => p.done).length;
    const pct = phases.length ? Math.round((phasesDone / phases.length) * 100)
      : boxes.total ? Math.round((boxes.done / boxes.total) * 100)
      : 0;
    const hasPlanning = fs.existsSync(planning);
    return {
      name,
      idea: read(path.join(dir, 'IDEA.md')).replace(/^#.*\n/, '').trim().slice(0, 200),
      building: active.includes(name),
      pct,
      phases,
      checkboxes: boxes,
      stateLine: parseStateLine(read(path.join(planning, 'STATE.md'))),
      version: parseVersion(dir),
      repoUrl: git(dir, 'remote', 'get-url', 'origin').replace(/\.git$/, ''),
      lastCommit: git(dir, 'log', '-1', '--format=%cr · %s').slice(0, 100),
      commits: Number(git(dir, 'rev-list', '--count', 'HEAD')) || 0,
      stage: !hasPlanning ? 'scaffolded' : pct >= 100 ? 'complete' : phases.length ? 'in progress' : 'planning',
    };
  });
}

export function statusText(root = ROOT) {
  const products = collectProducts(root);
  if (!products.length) return 'No products yet. Send an idea to start one.';
  return products.map(p => {
    const bar = '▰'.repeat(Math.round(p.pct / 10)) + '▱'.repeat(10 - Math.round(p.pct / 10));
    const flag = p.building ? ' 🔨 building' : '';
    return `${p.name}${flag}\n${bar} ${p.pct}% · ${p.stage}${p.version ? ' · v' + p.version : ''}\n${p.stateLine || p.lastCommit || 'no activity yet'}`;
  }).join('\n\n');
}

function html(products) {
  const generated = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>AI-Factory Dashboard</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--accent:#3fb950;--build:#d29922;--bar:#21262d}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;padding:32px 24px;max-width:1100px;margin:0 auto}
  header{display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px;margin-bottom:28px}
  h1{font-size:22px;font-weight:600}
  .meta{color:var(--dim);font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px}
  .card h2{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--dim)}
  .badge.building{color:var(--build);border-color:var(--build)}
  .badge.complete{color:var(--accent);border-color:var(--accent)}
  .idea{color:var(--dim);font-size:13px;margin:8px 0 12px;min-height:1em}
  .barwrap{background:var(--bar);border-radius:6px;height:8px;overflow:hidden;margin:6px 0 4px}
  .bar{background:var(--accent);height:100%;transition:width .4s}
  .pct{font-size:13px;color:var(--dim)}
  ul.phases{list-style:none;margin:12px 0 0;font-size:13px}
  ul.phases li{padding:2px 0;color:var(--dim)}
  ul.phases li.done{color:var(--text)}
  ul.phases li.done::before{content:"✓ ";color:var(--accent)}
  ul.phases li:not(.done)::before{content:"○ ";color:var(--dim)}
  .foot{margin-top:12px;font-size:12px;color:var(--dim);border-top:1px solid var(--border);padding-top:10px}
  .foot a{color:#58a6ff;text-decoration:none}
  .empty{color:var(--dim);text-align:center;padding:80px 0;font-size:15px}
</style></head><body>
<header><h1>AI-Factory</h1><span class="meta">${products.length} product${products.length === 1 ? '' : 's'} · generated ${generated}</span></header>
${products.length === 0 ? '<div class="empty">No products yet — send an idea to the factory bot or run scripts/new-product.sh</div>' : `<div class="grid">
${products.map(p => `<div class="card">
  <h2>${esc(p.name)}${p.building ? '<span class="badge building">building</span>' : ''}<span class="badge ${p.stage === 'complete' ? 'complete' : ''}">${esc(p.stage)}${p.version ? ' · v' + esc(p.version) : ''}</span></h2>
  <div class="idea">${esc(p.idea)}</div>
  <div class="barwrap"><div class="bar" style="width:${p.pct}%"></div></div>
  <div class="pct">${p.pct}%${p.checkboxes.total ? ` · ${p.checkboxes.done}/${p.checkboxes.total} tasks` : ''}${p.stateLine ? ' · ' + esc(p.stateLine) : ''}</div>
  ${p.phases.length ? `<ul class="phases">${p.phases.map(ph => `<li class="${ph.done ? 'done' : ''}">${esc(ph.name)}</li>`).join('')}</ul>` : ''}
  <div class="foot">${p.lastCommit ? esc(p.lastCommit) + ' · ' : ''}${p.commits} commits${p.repoUrl ? ` · <a href="${esc(p.repoUrl)}">repo</a>` : ''}</div>
</div>`).join('\n')}
</div>`}
</body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function buildDashboard(root = ROOT) {
  const products = collectProducts(root);
  const out = path.join(root, 'dashboard');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify({ generated: new Date().toISOString(), products }, null, 2));
  fs.writeFileSync(path.join(out, 'index.html'), html(products));
  return products;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const products = buildDashboard();
  console.log(`dashboard/index.html written — ${products.length} product(s)`);
}
