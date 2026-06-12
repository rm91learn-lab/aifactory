#!/usr/bin/env node
// AI-Factory dashboard generator — zero dependencies.
// Grid overview + per-product kanban page (#p=<name>): phases move through
// Backlog → Planning → In Development → Testing & QA → Done, derived from GSD's
// .planning artifacts. Live activity feed streams from .factory-activity.json.
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

// '## Phase 2: Booking flow' headings with their checkbox tasks.
function parseRoadmapSections(text) {
  const sections = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^#{2,4}\s*phase\s*(\d+)[:.\-\s]*(.*)/i);
    if (h) {
      cur = { n: +h[1], name: (h[2] || '').replace(/[*_`]/g, '').trim() || `Phase ${h[1]}`, tasks: [] };
      sections.push(cur);
      continue;
    }
    const t = line.match(/^\s*[-*] \[( |x)\]\s*(.+)/i);
    if (t && cur) cur.tasks.push({ done: t[1].toLowerCase() === 'x', s: t[2].replace(/[*_`]/g, '').trim().slice(0, 90) });
  }
  return sections;
}

// Kanban statuses from GSD phase-directory artifacts.
function buildBoard(planningDir, roadmapText) {
  const sections = parseRoadmapSections(roadmapText);
  const phasesDir = path.join(planningDir, 'phases');
  const dirs = {};
  try {
    for (const d of fs.readdirSync(phasesDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = d.name.match(/^(\d+)/);
      dirs[m ? +m[1] : d.name] = d.name;
    }
  } catch {}
  const dirStatus = (dn) => {
    let files = [];
    try { files = fs.readdirSync(path.join(phasesDir, dn)); } catch { return 'planning'; }
    if (files.some(f => /^SUMMARY/i.test(f))) return 'done';
    if (files.some(f => /^VERIFICATION/i.test(f))) return 'qa';
    if (files.some(f => /PLAN/i.test(f))) return 'dev';
    return 'planning';
  };
  const seen = new Set();
  const board = [];
  for (const s of sections) {
    const dn = dirs[s.n];
    if (dn) seen.add(dn);
    board.push({ name: s.name, status: dn ? dirStatus(dn) : 'backlog', tasks: s.tasks });
  }
  for (const dn of Object.values(dirs)) {
    if (seen.has(dn)) continue;
    board.push({ name: dn.replace(/^\d+[-_]?/, '').replace(/[-_]/g, ' ') || dn, status: dirStatus(dn), tasks: [] });
  }
  return board;
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

  let active = [];
  try { active = readJson(path.join(root, 'daemon', 'state.json'))?.active || []; } catch {}
  const healthAll = readJson(path.join(root, 'daemon', 'health.json'))?.products || {};

  return names.map(name => {
    const dir = path.join(productsDir, name);
    const planning = path.join(dir, '.planning');
    const roadmap = read(path.join(planning, 'ROADMAP.md'));
    const board = buildBoard(planning, roadmap);
    const boxes = parseCheckboxes(roadmap);
    const doneCount = board.filter(p => p.status === 'done').length;
    const pct = board.length ? Math.round((doneCount / board.length) * 100)
      : boxes.total ? Math.round((boxes.done / boxes.total) * 100)
      : 0;
    const hasPlanning = fs.existsSync(planning);
    const h = healthAll[name];
    const a = readJson(path.join(dir, '.factory-activity.json'));
    const tasks = (a?.tasks || []).slice(0, 60);
    const tasksDone = tasks.filter(t => t.status === 'completed').length;
    const pctFinal = board.length ? pct : tasks.length ? Math.round((tasksDone / tasks.length) * 100) : pct;
    return {
      name,
      idea: read(path.join(dir, 'IDEA.md')).replace(/^#.*\n/, '').trim().slice(0, 600),
      building: active.includes(name),
      pct: pctFinal,
      board,
      tasks,
      phases: board.map(p => ({ name: p.name, done: p.status === 'done' })),
      checkboxes: boxes,
      stateLine: parseStateLine(read(path.join(planning, 'STATE.md'))),
      version: parseVersion(dir),
      repoUrl: git(dir, 'remote', 'get-url', 'origin').replace(/\.git$/, ''),
      deployUrl: (() => { const d = readJson(path.join(dir, 'DEPLOY.json')); return d?.url || d?.live_url || ''; })(),
      lastCommit: git(dir, 'log', '-1', '--format=%cr · %s').slice(0, 100),
      commits: Number(git(dir, 'rev-list', '--count', 'HEAD')) || 0,
      stage: !hasPlanning && !tasks.length ? 'scaffolded' : pctFinal >= 100 ? 'ready' : (board.length || tasks.length) ? 'in progress' : 'planning',
      health: h ? { up: h.up, ms: h.ms, url: h.url, downSince: h.downSince } : null,
      activity: a ? { updatedAt: a.updatedAt, counts: a.counts, entries: (a.entries || []).slice(-15) } : null,
      requirements: read(path.join(planning, 'REQUIREMENTS.md')).trim().slice(0, 6000),
      assumptions: read(path.join(planning, 'ASSUMPTIONS.md')).replace(/^# .*\n+/,'').replace(/^Each entry.*\n+/m,'').trim().slice(0, 4000),
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
    const now = p.building && p.activity?.entries?.length ? `\nnow: ${p.activity.entries[p.activity.entries.length - 1].s}` : '';
    return `${p.name}${flag}\n${bar} ${p.pct}% · ${p.stage}${p.version ? ' · v' + p.version : ''}\n${p.stateLine || p.lastCommit || 'no activity yet'}${now}${demo}`;
  }).join('\n\n');
}

function html(products) {
  const botUsername = readJson(path.join(ROOT, 'daemon', 'config.json'))?.botUsername || '';
  const data = JSON.stringify({ generated: new Date().toISOString(), botUsername, products }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI-Factory Dashboard</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--dim:#8b949e;--accent:#3fb950;--build:#d29922;--red:#f85149;--bar:#21262d;--blue:#58a6ff}
  *{box-sizing:border-box;margin:0}
  body{background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,'Segoe UI',Roboto,sans-serif;padding:24px 20px;max-width:1200px;margin:0 auto}
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  h1{font-size:21px;font-weight:600;cursor:pointer}
  #upd{color:var(--dim);font-size:13px}
  .bar-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0 18px}
  .chip{background:var(--card);border:1px solid var(--border);color:var(--dim);border-radius:20px;padding:4px 14px;font-size:13px;cursor:pointer;user-select:none}
  .chip.active{color:var(--text);border-color:var(--blue)}
  #q{background:var(--card);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 12px;font-size:14px;flex:1;min-width:140px;outline:none}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
  .card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:18px;cursor:pointer;transition:border-color .15s}
  .card:hover{border-color:var(--blue)}
  .card h2{font-size:16px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .badge{font-size:11px;padding:2px 8px;border-radius:20px;border:1px solid var(--border);color:var(--dim);white-space:nowrap}
  .badge.building{color:var(--build);border-color:var(--build)}
  .badge.ready,.badge.live{color:var(--accent);border-color:var(--accent)}
  .badge.down{color:var(--red);border-color:var(--red)}
  .barwrap{background:var(--bar);border-radius:6px;height:8px;overflow:hidden;margin:12px 0 6px}
  .fill{background:var(--accent);height:100%;transition:width .4s}
  .meta{font-size:13px;color:var(--dim)}
  .now{font-size:13px;color:var(--build);margin-top:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hint{font-size:11px;color:var(--dim);margin-top:10px}
  .empty{color:var(--dim);text-align:center;padding:80px 0}
  /* product page */
  .back{color:var(--blue);cursor:pointer;font-size:14px;margin-bottom:14px;display:inline-block}
  .ptitle{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
  .ptitle h2{font-size:20px}
  .links{display:flex;gap:8px;margin:10px 0 18px;flex-wrap:wrap}
  .links a{background:var(--card);border:1px solid var(--border);color:var(--blue);text-decoration:none;font-size:13px;padding:6px 14px;border-radius:8px}
  .links a.demo{color:var(--accent)}
  .board{display:grid;grid-template-columns:repeat(5,minmax(170px,1fr));gap:10px;overflow-x:auto;margin-bottom:20px}
  .col{background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px;padding:10px;min-height:120px}
  .col h3{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--dim);margin-bottom:10px;display:flex;justify-content:space-between}
  .col h3 .n{color:var(--text)}
  .ph{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px;font-size:13px}
  .ph.dev{border-color:var(--build)}
  .ph.done{opacity:.75}
  .ph .tprog{font-size:11px;color:var(--dim);margin-top:4px}
  .ph ul{list-style:none;margin-top:6px;font-size:12px}
  .ph li{color:var(--dim);padding:1px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ph li.t-done{color:var(--text)}
  .ph li.t-done::before{content:"✓ ";color:var(--accent)}
  .ph li:not(.t-done)::before{content:"○ "}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:760px){.two{grid-template-columns:1fr}.board{grid-template-columns:repeat(5,minmax(150px,1fr))}}
  .panel{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px}
  .panel h4{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin-bottom:10px}
  .feed div{color:var(--dim);font-size:13px;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .feed div:first-child{color:var(--text)}
  .feed .ago{opacity:.6;font-size:11px;margin-left:5px}
  .idea-full{color:var(--dim);font-size:13px;white-space:pre-wrap}
  .doc{color:var(--dim);font-size:13px;white-space:pre-wrap;max-height:340px;overflow-y:auto}
  .stats-line{margin-top:14px;font-size:12px;color:var(--dim)}
  .cta{background:var(--bar);border:1px solid var(--build);color:var(--build);text-decoration:none;font-size:13px;padding:6px 14px;border-radius:8px}
</style></head><body>
<header><h1 onclick="location.hash=''">AI-Factory</h1><span id="upd"></span></header>
<div class="bar-row" id="chips">
  <span class="chip" data-f="all">All</span>
  <span class="chip" data-f="building">🔨 Building</span>
  <span class="chip" data-f="live">🟢 Live</span>
  <span class="chip" data-f="down">🔴 Down</span>
  <span class="chip" data-f="ready">✓ Ready</span>
  <input id="q" placeholder="search products…">
</div>
<div id="view"></div>
<script>
var DATA = ${data};
var products = DATA.products, filter = 'all', q = '', last = Date.now();
var COLS = [
  ['backlog', '📋 Backlog'],
  ['planning', '🧠 Planning'],
  ['dev', '🛠 In Development'],
  ['qa', '🧪 Testing & QA'],
  ['done', '✅ Done']
];

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
function ago(t) {
  var s = Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000));
  return s < 90 ? s + 's ago' : s < 5400 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago';
}
function route() {
  var m = location.hash.match(/^#p=(.+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}
function matches(p) {
  if (q && (p.name + ' ' + p.idea).toLowerCase().indexOf(q) === -1) return false;
  if (filter === 'building') return p.building;
  if (filter === 'live') return p.health && p.health.up;
  if (filter === 'down') return p.health && !p.health.up;
  if (filter === 'ready') return p.stage === 'ready';
  return true;
}
function titleBadges(p, h) {
  if (p.building) h.appendChild(badge('🔨 building', 'building'));
  h.appendChild(badge(p.stage + (p.version ? ' · v' + p.version : ''), p.stage === 'ready' ? 'ready' : ''));
  if (p.health) h.appendChild(badge(p.health.up ? '● live · ' + p.health.ms + 'ms' : '● DOWN', p.health.up ? 'live' : 'down'));
}
function gridCard(p) {
  var done = p.board.filter(function (x) { return x.status === 'done'; }).length;
  var c = el('div', 'card');
  c.onclick = function () { location.hash = '#p=' + encodeURIComponent(p.name); };
  var h = el('h2', null, p.name + ' ');
  titleBadges(p, h);
  c.appendChild(h);
  var bw = el('div', 'barwrap'); var f = el('div', 'fill'); f.style.width = p.pct + '%'; bw.appendChild(f); c.appendChild(bw);
  var bits = [p.pct + '%'];
  if (p.board.length) bits.push(done + '/' + p.board.length + ' stages done');
  if (p.checkboxes.total) bits.push(p.checkboxes.done + '/' + p.checkboxes.total + ' tasks');
  c.appendChild(el('div', 'meta', bits.join(' · ')));
  if (p.building && p.activity && p.activity.entries.length) {
    c.appendChild(el('div', 'now', 'now: ' + p.activity.entries[p.activity.entries.length - 1].s));
  }
  c.appendChild(el('div', 'hint', 'open product board →'));
  return c;
}
function renderGrid(view) {
  document.getElementById('chips').style.display = 'flex';
  var grid = el('div', 'grid');
  var shown = products.filter(matches);
  shown.forEach(function (p) { grid.appendChild(gridCard(p)); });
  view.appendChild(grid);
  if (!shown.length) view.appendChild(el('div', 'empty', products.length ? 'Nothing matches this filter.' : 'No products yet — text an idea to your factory bot.'));
  document.querySelectorAll('.chip').forEach(function (ch) { ch.classList.toggle('active', ch.dataset.f === filter); });
}
function renderProduct(view, p) {
  document.getElementById('chips').style.display = 'none';
  var back = el('span', 'back', '← all products');
  back.onclick = function () { location.hash = ''; };
  view.appendChild(back);

  var t = el('div', 'ptitle');
  t.appendChild(el('h2', null, p.name));
  titleBadges(p, t);
  view.appendChild(t);
  var bits = [p.pct + '% complete'];
  if (p.stateLine) bits.push(p.stateLine);
  view.appendChild(el('div', 'meta', bits.join(' · ')));

  var links = el('div', 'links');
  var demoUrl = (p.health && p.health.url) || p.deployUrl;
  if (demoUrl) links.appendChild(link(demoUrl, '▶ open demo', 'demo'));
  if (p.repoUrl) links.appendChild(link(p.repoUrl, 'code repository'));
  if (DATA.botUsername) {
    var cta = link('https://t.me/' + DATA.botUsername + '?text=' + encodeURIComponent('Add to ' + p.name + ': '), '➕ request a feature or change', 'cta');
    links.appendChild(cta);
  }
  view.appendChild(links);

  // Phase board when formal planning exists; otherwise the agent's own live
  // task list — the board is never empty while work is happening.
  var useTasks = !p.board.length && p.tasks && p.tasks.length;
  var cols = useTasks
    ? [['pending', '📋 To do'], ['in_progress', '🛠 In progress'], ['completed', '✅ Done']]
    : COLS;
  var items_of = function (key) {
    return useTasks
      ? p.tasks.filter(function (t) { return (t.status || 'pending') === key; }).map(function (t) { return { name: t.s, status: key, tasks: [] }; })
      : p.board.filter(function (ph) { return ph.status === key; });
  };
  var board = el('div', 'board');
  if (useTasks) board.style.gridTemplateColumns = 'repeat(3,1fr)';
  cols.forEach(function (col) {
    var c = el('div', 'col');
    var items = items_of(col[0]);
    var h3 = el('h3', null, col[1] + ' ');
    h3.appendChild(el('span', 'n', String(items.length)));
    c.appendChild(h3);
    items.forEach(function (ph) {
      var card = el('div', 'ph ' + ph.status, ph.name);
      if (ph.tasks.length) {
        var d = ph.tasks.filter(function (x) { return x.done; }).length;
        card.appendChild(el('div', 'tprog', d + '/' + ph.tasks.length + ' tasks'));
        var ul = el('ul');
        ph.tasks.slice(0, 6).forEach(function (tk) { ul.appendChild(el('li', tk.done ? 't-done' : '', tk.s)); });
        if (ph.tasks.length > 6) ul.appendChild(el('li', '', '+' + (ph.tasks.length - 6) + ' more…'));
        card.appendChild(ul);
      }
      c.appendChild(card);
    });
    board.appendChild(c);
  });
  view.appendChild(board);
  if (!p.board.length && !useTasks) {
    view.appendChild(el('div', 'meta', p.building
      ? 'The team is drawing up the roadmap right now — stages will appear here within minutes.'
      : 'No roadmap yet.'));
    view.appendChild(el('div', null, ' '));
  }

  var two = el('div', 'two');
  var feedPanel = el('div', 'panel');
  feedPanel.appendChild(el('h4', null, p.building ? '⚡ live activity' : '⚡ recent activity'));
  var feed = el('div', 'feed');
  if (p.activity && p.activity.entries.length) {
    p.activity.entries.slice().reverse().forEach(function (en) {
      var row = el('div', null, en.s);
      row.appendChild(el('span', 'ago', ago(en.t)));
      feed.appendChild(row);
    });
  } else {
    feed.appendChild(el('div', null, 'No agent activity recorded yet.'));
  }
  feedPanel.appendChild(feed);
  if (p.activity) feedPanel.appendChild(el('div', 'stats-line', p.activity.counts.actions + ' actions · ' + p.activity.counts.writes + ' files written · ' + p.activity.counts.commands + ' commands run'));
  two.appendChild(feedPanel);

  var ideaPanel = el('div', 'panel');
  ideaPanel.appendChild(el('h4', null, '💡 the brief'));
  ideaPanel.appendChild(el('div', 'idea-full', p.idea || '—'));
  ideaPanel.appendChild(el('div', 'stats-line', (p.lastCommit ? p.lastCommit + ' · ' : '') + p.commits + ' updates'));
  two.appendChild(ideaPanel);
  view.appendChild(two);

  var two2 = el('div', 'two');
  two2.style.marginTop = '16px';
  var reqPanel = el('div', 'panel');
  reqPanel.appendChild(el('h4', null, "🧭 what's planned (full scope)"));
  reqPanel.appendChild(el('div', 'doc', p.requirements || (p.building ? 'The plan document is being written — check back shortly.' : 'No plan document found.')));
  two2.appendChild(reqPanel);
  var asPanel = el('div', 'panel');
  asPanel.appendChild(el('h4', null, '🤔 decisions made for you'));
  asPanel.appendChild(el('div', 'doc', p.assumptions || 'No autonomous decisions recorded yet.'));
  two2.appendChild(asPanel);
  view.appendChild(two2);
}
function render() {
  var view = document.getElementById('view');
  view.textContent = '';
  var r = route();
  var p = r && products.find(function (x) { return x.name === r; });
  if (p) renderProduct(view, p); else renderGrid(view);
}
document.querySelectorAll('.chip').forEach(function (ch) {
  ch.onclick = function () { filter = ch.dataset.f; render(); };
});
document.getElementById('q').oninput = function (e) { q = e.target.value.toLowerCase(); render(); };
window.addEventListener('hashchange', render);

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
