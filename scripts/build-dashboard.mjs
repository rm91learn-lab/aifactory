#!/usr/bin/env node
// AI-Factory dashboard generator — zero dependencies.
// Scans products/*/.planning and emits dashboard/index.html (interactive) + data.json.
// Served live by the daemon at http://localhost:<dashboardPort>; also works as a
// plain file (falls back to a 60s reload instead of live fetch updates).
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

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
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

  // Daemon marks in-flight builds in daemon/state.json; the monitor writes daemon/health.json.
  let active = [];
  try { active = readJson(path.join(root, 'daemon', 'state.json'))?.active || []; } catch {}
  const healthAll = readJson(path.join(root, 'daemon', 'health.json'))?.products || {};

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
    const h = healthAll[name];
    return {
      name,
      idea: read(path.join(dir, 'IDEA.md')).replace(/^#.*\n/, '').trim().slice(0, 400),
      building: active.includes(name),
      pct,
      phases,
      checkboxes: boxes,
      stateLine: parseStateLine(read(path.join(planning, 'STATE.md'))),
      version: parseVersion(dir),
      repoUrl: git(dir, 'remote', 'get-url', 'origin').replace(/\.git$/, ''),
      deployUrl: readJson(path.join(dir, 'DEPLOY.json'))?.url || '',
      lastCommit: git(dir, 'log', '-1', '--format=%cr · %s').slice(0, 100),
      commits: Number(git(dir, 'rev-list', '--count', 'HEAD')) || 0,
      stage: !hasPlanning ? 'scaffolded' : pct >= 100 ? 'ready' : phases.length ? 'in progress' : 'planning',
      health: h ? { up: h.up, ms: h.ms, url: h.url, downSince: h.downSince } : null,
    };
  });
}

export function statusText(root = ROOT) {
  const products = collectProducts(root);
  if (!products.length) return 'No products yet. Send an idea to start one.';
  return products.map(p => {
    const bar = '▰'.repeat(Math.round(p.pct / 10)) + '▱'.repeat(10 - Math.round(p.pct / 10));
    const flag = (p.building ? ' 🔨 building' : '') + (p.health ? (p.health.up ? ' 🟢' : ' 🔴 DOWN') : '');
    const demo = (p.health?.up && p.health.url) ? `\n🔗 ${p.health.url}` : p.deployUrl ? `\n🔗 ${p.deployUrl}` : '';
    return `${p.name}${flag}\n${bar} ${p.pct}% · ${p.stage}${p.version ? ' · v' + p.version : ''}\n${p.stateLine || p.lastCommit || 'no activity yet'}${demo}`;
  }).join('\n\n');
}

function html(products) {
  const data = JSON.stringify({ generated: new Date().toISOString(), products }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI-Factory Dashboard</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--accent:#3fb950;--build:#d29922;--red:#f85149;--bar:#21262d;--blue:#58a6ff}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;padding:28px 22px;max-width:1100px;margin:0 auto}
  header{margin-bottom:18px}
  h1{font-size:22px;font-weight:600;display:inline}
  #upd{color:var(--dim);font-size:13px;margin-left:12px}
  .bar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:16px 0 20px}
  .chip{background:var(--card);border:1px solid var(--border);color:var(--dim);border-radius:20px;padding:4px 14px;font-size:13px;cursor:pointer;user-select:none}
  .chip.active{color:var(--text);border-color:var(--blue)}
  #q{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 12px;font-size:14px;flex:1;min-width:140px;outline:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;cursor:pointer;transition:border-color .15s}
  .card:hover{border-color:#4b535d}
  .card h2{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--dim);white-space:nowrap}
  .badge.building{color:var(--build);border-color:var(--build)}
  .badge.ready{color:var(--accent);border-color:var(--accent)}
  .badge.live{color:var(--accent);border-color:var(--accent)}
  .badge.down{color:var(--red);border-color:var(--red)}
  .barwrap{background:var(--bar);border-radius:6px;height:8px;overflow:hidden;margin:12px 0 6px}
  .fill{background:var(--accent);height:100%;transition:width .4s}
  .meta{font-size:13px;color:var(--dim)}
  .details{max-height:0;overflow:hidden;transition:max-height .25s ease}
  .card.open .details{max-height:600px}
  .idea{color:var(--dim);font-size:13px;margin:12px 0;border-left:3px solid var(--border);padding-left:10px}
  ul.stages{list-style:none;margin:8px 0;font-size:13px}
  ul.stages li{padding:2px 0;color:var(--dim)}
  ul.stages li.done{color:var(--text)}
  ul.stages li.done::before{content:"✓ ";color:var(--accent)}
  ul.stages li:not(.done)::before{content:"○ ";color:var(--dim)}
  .links{display:flex;gap:8px;margin:12px 0 4px;flex-wrap:wrap}
  .links a{background:var(--bar);border:1px solid var(--border);color:var(--blue);text-decoration:none;font-size:13px;padding:5px 12px;border-radius:7px}
  .links a.demo{color:var(--accent)}
  .stats{font-size:12px;color:var(--dim);border-top:1px solid var(--border);padding-top:10px;margin-top:10px}
  .empty{color:var(--dim);text-align:center;padding:80px 0}
  .hint{font-size:11px;color:var(--dim);margin-top:8px}
</style></head><body>
<header>
  <h1>AI-Factory</h1><span id="upd"></span>
  <div class="bar-row">
    <span class="chip" data-f="all">All</span>
    <span class="chip" data-f="building">🔨 Building</span>
    <span class="chip" data-f="live">🟢 Live</span>
    <span class="chip" data-f="down">🔴 Down</span>
    <span class="chip" data-f="ready">✓ Ready</span>
    <input id="q" placeholder="search products…">
  </div>
</header>
<div class="grid" id="grid"></div>
<div class="empty" id="empty" style="display:none"></div>
<script>
var DATA = ${data};
var products = DATA.products, filter = 'all', q = '', last = Date.now(), open = {};

function el(tag, cls, txt) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function badge(txt, cls) { return el('span', 'badge' + (cls ? ' ' + cls : ''), txt); }
function link(href, txt, cls) {
  var a = el('a', cls, txt);
  a.href = href; a.target = '_blank';
  a.onclick = function (e) { e.stopPropagation(); };
  return a;
}
function matches(p) {
  if (q && (p.name + ' ' + p.idea).toLowerCase().indexOf(q) === -1) return false;
  if (filter === 'building') return p.building;
  if (filter === 'live') return p.health && p.health.up;
  if (filter === 'down') return p.health && !p.health.up;
  if (filter === 'ready') return p.stage === 'ready';
  return true;
}
function card(p) {
  var done = p.phases.filter(function (x) { return x.done; }).length;
  var c = el('div', 'card' + (open[p.name] ? ' open' : ''));
  c.onclick = function () { open[p.name] = !open[p.name]; render(); };

  var h = el('h2', null, p.name + ' ');
  if (p.building) h.appendChild(badge('🔨 building', 'building'));
  h.appendChild(badge(p.stage + (p.version ? ' · v' + p.version : ''), p.stage === 'ready' ? 'ready' : ''));
  if (p.health) h.appendChild(badge(p.health.up ? '● live · ' + p.health.ms + 'ms' : '● DOWN', p.health.up ? 'live' : 'down'));
  c.appendChild(h);

  var bw = el('div', 'barwrap'); var f = el('div', 'fill'); f.style.width = p.pct + '%'; bw.appendChild(f); c.appendChild(bw);
  var metaBits = [p.pct + '%'];
  if (p.phases.length) metaBits.push('stage ' + Math.min(done + 1, p.phases.length) + ' of ' + p.phases.length);
  if (p.checkboxes.total) metaBits.push(p.checkboxes.done + '/' + p.checkboxes.total + ' tasks');
  if (p.stateLine) metaBits.push(p.stateLine);
  c.appendChild(el('div', 'meta', metaBits.join(' · ')));

  var d = el('div', 'details');
  if (p.idea) d.appendChild(el('div', 'idea', p.idea));
  if (p.phases.length) {
    var ul = el('ul', 'stages');
    p.phases.forEach(function (ph) { ul.appendChild(el('li', ph.done ? 'done' : '', ph.name)); });
    d.appendChild(ul);
  }
  var demoUrl = (p.health && p.health.url) || p.deployUrl;
  if (demoUrl || p.repoUrl) {
    var links = el('div', 'links');
    if (demoUrl) links.appendChild(link(demoUrl, '▶ open demo', 'demo'));
    if (p.repoUrl) links.appendChild(link(p.repoUrl, 'code repository'));
    d.appendChild(links);
  }
  d.appendChild(el('div', 'stats', (p.lastCommit ? p.lastCommit + ' · ' : '') + p.commits + ' updates'));
  c.appendChild(d);
  c.appendChild(el('div', 'hint', open[p.name] ? 'click to collapse' : 'click for details'));
  return c;
}
function render() {
  var grid = document.getElementById('grid'), empty = document.getElementById('empty');
  grid.textContent = '';
  var shown = products.filter(matches);
  shown.forEach(function (p) { grid.appendChild(card(p)); });
  empty.style.display = shown.length ? 'none' : 'block';
  empty.textContent = products.length ? 'Nothing matches this filter.' : 'No products yet — text an idea to your factory bot.';
  document.querySelectorAll('.chip').forEach(function (ch) {
    ch.classList.toggle('active', ch.dataset.f === filter);
  });
}
document.querySelectorAll('.chip').forEach(function (ch) {
  ch.onclick = function () { filter = ch.dataset.f; render(); };
});
document.getElementById('q').oninput = function (e) { q = e.target.value.toLowerCase(); render(); };

function tick() {
  fetch('data.json?_=' + Date.now(), { cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (d) { products = d.products; last = Date.now(); render(); })
    .catch(function () {});
}
if (location.protocol === 'file:') {
  setTimeout(function () { location.reload(); }, 60000);
} else {
  setInterval(tick, 15000);
}
setInterval(function () {
  document.getElementById('upd').textContent = 'updated ' + Math.round((Date.now() - last) / 1000) + 's ago';
}, 1000);
render();
</script>
</body></html>`;
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
