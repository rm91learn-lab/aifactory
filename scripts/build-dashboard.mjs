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
const UI_VERSION = 7; // bump when the page's code changes; open tabs self-reload

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
    const ch = line.match(/^#{2,4}\s*change\b[:\s-]*(.*)/i);
    if (ch) {
      cur = { change: true, name: ('🔧 ' + ((ch[1] || '').replace(/[*_`]/g, '').trim() || 'Change')).trim(), tasks: [] };
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
    if (s.change) {
      board.push({ name: s.name, status: s.tasks.length && s.tasks.every(t => t.done) ? 'done' : 'dev', tasks: s.tasks, change: true });
      continue;
    }
    const dn = dirs[s.n];
    if (dn) seen.add(dn);
    const st = dn ? dirStatus(dn) : 'backlog';
    board.push({ name: s.name, status: st === 'planning' ? 'backlog' : st, tasks: s.tasks });
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
      runLabel: { build: 'building', change: 'applying change', qa: 'running QA', incident: 'fixing incident' }[a?.runKind] || (a?.runKind ? 'working' : null),
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
  const data = JSON.stringify({ generated: new Date().toISOString(), uiVersion: UI_VERSION, botUsername, products }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>AI-Factory</title>
<style>
  *{box-sizing:border-box;margin:0}
  body{background:#0a0d14;color:#e6edf3;font:15px/1.55 -apple-system,'Segoe UI',Roboto,sans-serif;padding:22px 18px;max-width:1180px;margin:0 auto}
  a{color:#5b8cff;text-decoration:none}
  header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  h1{font-size:21px;font-weight:600}
  #upd{color:#7c8aa0;font-size:13px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
  .pcard{background:#0f1623;border:0.5px solid #232f47;border-radius:14px;padding:16px;cursor:pointer;transition:border-color .15s}
  .pcard:hover{border-color:#3a4straight;border-color:#34507f}
  .pc-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}
  .pc-h .nm{font-size:16px;font-weight:600}
  .bdg{font-size:11px;padding:2px 9px;border-radius:20px;border:0.5px solid #2b3650;color:#8b97a8;white-space:nowrap}
  .bdg.build{color:#d29922;border-color:#7a5c1a;background:#1c1606}
  .bdg.live{color:#3fb950;border-color:#1f3d28;background:#0e1f14}
  .bdg.down{color:#f0716f;border-color:#5a2a2a;background:#1f1314}
  .bdg.ready{color:#3fb950;border-color:#1f3d28}
  .rail{display:flex;align-items:center;margin:4px 0 12px}
  .rn{width:18px;height:18px;border-radius:50%;border:2px solid #2b3650;background:#141b29;flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:9px;color:#56627a}
  .rl{height:2px;flex:1;background:#222c40}
  .rn.done{border-color:#3fb950;color:#3fb950;background:#0e1f14}
  .rn.active{border-color:#5b8cff;color:#5b8cff;background:#101a2e}
  .rl.fdone{background:#2f6f4d}
  .ctr{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:10px}
  .ctr div{font-size:12px;color:#7c8aa0}
  .ctr b{display:block;font-size:18px;font-weight:600;color:#e6edf3}
  .now{font-size:12.5px;color:#d29922;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .pc-f{font-size:11px;color:#56627a;margin-top:10px}
  /* detail */
  .back{color:#5b8cff;cursor:pointer;font-size:14px;display:inline-block;margin-bottom:12px}
  .dh{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}
  .dh .nm{font-size:20px;font-weight:600}
  .sub{color:#7c8aa0;font-size:13px;margin-bottom:12px}
  .acts{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
  .btn{font-size:13px;border:0.5px solid #2b3650;background:transparent;color:#9aa6b8;border-radius:8px;padding:7px 13px;cursor:pointer}
  .btn.go{color:#3fb950;border-color:#1f3d28}
  .btn.bl{color:#5b8cff;border-color:#23314f}
  .btn.on{color:#5b8cff;border-color:#34507f;background:#101a2e}
  /* live production line */
  .live{background:#0b0f18;border:0.5px solid #1e2738;border-radius:14px;padding:18px;margin-bottom:16px;display:none}
  .live.show{display:block}
  .bigrail{position:relative;height:54px;margin:6px 4px 16px}
  .bigtrack{position:absolute;top:12px;left:14px;right:14px;height:2px;background:#222c40}
  .bigfill{position:absolute;top:12px;left:14px;height:2px;background:#5b8cff;transition:width 1s}
  .bignodes{position:absolute;top:0;left:0;right:0;display:flex;justify-content:space-between}
  .bn{display:flex;flex-direction:column;align-items:center;width:54px}
  .bnc{width:26px;height:26px;border-radius:50%;border:2px solid #2b3650;background:#141b29;display:flex;align-items:center;justify-content:center;font-size:11px;color:#56627a}
  .bn.done .bnc{border-color:#3fb950;color:#3fb950;background:#0e1f14}
  .bn.active .bnc{border-color:#5b8cff;color:#5b8cff;background:#101a2e}
  .bn .bl2{font-size:10px;color:#56627a;margin-top:6px;white-space:nowrap}
  .bn.active .bl2{color:#5b8cff}.bn.done .bl2{color:#7c8aa0}
  .bn.active .bnc::after{content:"";position:absolute;width:26px;height:26px;border-radius:50%;border:2px solid #5b8cff;opacity:.5;animation:pr 1.7s ease-out infinite}
  @keyframes pr{0%{transform:scale(.85);opacity:.5}100%{transform:scale(1.6);opacity:0}}
  .agc{display:inline-flex;align-items:center;gap:7px;background:#141b29;border:0.5px solid #232f47;border-radius:20px;padding:5px 12px;font-size:12.5px;color:#c3cdda;margin:0 6px 6px 0}
  .agc .d{width:7px;height:7px;border-radius:50%;background:#d29922;animation:bp 1.3s ease-in-out infinite}
  @keyframes bp{0%,100%{opacity:1}50%{opacity:.25}}
  .feed{margin-top:10px;border-top:0.5px solid #1c2638;padding-top:10px}
  .feed .ln{display:flex;gap:10px;font-size:13px;color:#c3cdda;padding:4px 0;border-bottom:0.5px solid #141c2b}
  .feed .ln:last-child{border-bottom:none}
  .feed .t{font-family:ui-monospace,monospace;font-size:11px;color:#56627a;min-width:46px}
  .feed .a{color:#5b8cff}
  /* zig-zag roadmap */
  .road{position:relative;container-type:inline-size;padding:4px 0}
  .spine{position:absolute;left:50%;top:6px;width:2px;height:0;background:#222c40;transform:translateX(-50%);transition:height 1s}
  .stage{position:relative;display:grid;grid-template-columns:1fr 44px 1fr;align-items:start;margin-bottom:14px;opacity:0;transform:translateY(10px);animation:rise .5s forwards}
  @keyframes rise{to{opacity:1;transform:translateY(0)}}
  .node{grid-column:2;width:34px;height:34px;border-radius:50%;background:#141b29;border:2px solid #2b3650;display:flex;align-items:center;justify-content:center;font-size:13px;color:#7c8aa0;justify-self:center;z-index:2}
  .stage.done .node{border-color:#3fb950;color:#3fb950;background:#0e1f14}
  .stage.active .node{border-color:#5b8cff;color:#5b8cff;background:#101a2e}
  .scard{background:#0f1623;border:0.5px solid #232f47;border-radius:12px;overflow:hidden}
  .stage:nth-child(odd) .scard{grid-column:1}.stage:nth-child(even) .scard{grid-column:3}
  .stage.active .scard{border-color:#2d4373}.stage.done .scard{border-color:#1f3d28}
  .sh{display:flex;align-items:center;gap:8px;padding:11px 13px;cursor:pointer}
  .sh .tt{font-size:14px;font-weight:500;flex:1}
  .pill{font-size:11px;color:#7c8aa0;background:#141b29;border-radius:10px;padding:2px 8px;white-space:nowrap}
  .chev{font-size:15px;color:#56627a;transition:transform .3s}
  .sopen>.sh .chev,.topen>.trow .chev{transform:rotate(180deg)}
  .sbody{max-height:0;overflow:hidden;transition:max-height .35s}
  .tasks{list-style:none;margin:0;padding:2px 10px 10px}
  .trow{display:flex;align-items:center;gap:9px;font-size:13px;color:#8b97a8;padding:6px;cursor:pointer;border-radius:8px}
  .trow:hover{background:#131c2c}
  .task.t .ic{color:#3fb950}.task.now .trow{color:#e6edf3}.task.now .ic{color:#d29922}
  .ic{width:16px;flex:0 0 16px;font-size:15px}
  .tlbl{flex:1}
  .det{max-height:0;overflow:hidden;transition:max-height .3s}
  .detin{margin:2px 6px 8px 31px;padding:10px 12px;background:#0b1018;border:0.5px solid #1c2638;border-radius:8px;font-size:12.5px;color:#9aa6b8;line-height:1.55;white-space:pre-wrap}
  .ed{display:flex;align-items:center;gap:8px;background:#0f1623;border:0.5px solid #232f47;border-radius:9px;padding:7px 11px;margin:4px 10px;font-size:13px}
  .ed .x{margin-left:auto;color:#56627a;cursor:pointer}.ed .x:hover{color:#f0716f}
  .ed.new{border-color:#2d4373;background:#101a2e}.ed.rm{opacity:.5}.ed.rm .lt{text-decoration:line-through}
  .edadd{display:flex;gap:8px;margin:4px 10px}
  .edadd input{flex:1;background:#0b1018;border:0.5px solid #2b3650;border-radius:8px;color:#e6edf3;font-size:13px;padding:7px 10px;outline:none}
  .empty{color:#56627a;text-align:center;padding:70px 0}
  @container (max-width:520px){.stage{grid-template-columns:44px 1fr}.spine{left:22px}.node{grid-column:1}.stage .scard,.stage:nth-child(odd) .scard,.stage:nth-child(even) .scard{grid-column:2}}
</style></head><body>
<header><h1 onclick="location.hash=''" style="cursor:pointer">AI-Factory</h1><span id="upd"></span></header>
<div id="view"></div>
<script>
var DATA=${data},products=DATA.products,last=Date.now();
var ST=["Capture","Plan","Design","Build","QA","Release","Operate","Evolve"];
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function esc(s){return String(s==null?"":s);}
function ago(t){var s=Math.max(0,Math.round((Date.now()-new Date(t).getTime())/1000));return s<90?s+"s":s<5400?Math.round(s/60)+"m":Math.round(s/3600)+"h";}
function stageIdx(p){
  if(p.health&&!p.health.up)return 6;
  if(p.building)return /qa/i.test(p.runLabel||"")?4:3;
  if(p.pct>=100)return 6;
  if((p.board&&p.board.length)||(p.tasks&&p.tasks.length))return 3;
  if(p.requirements)return 1;
  return 0;
}
function rail(p,big){
  var idx=stageIdx(p);
  var wrap=el("div",big?"bigrail":"rail");
  if(big){
    wrap.appendChild(el("div","bigtrack"));
    var f=el("div","bigfill");f.style.width=(idx/(ST.length-1)*100)+"%";wrap.appendChild(f);
    var nodes=el("div","bignodes");
    ST.forEach(function(s,i){var n=el("div","bn "+(i<idx?"done":i===idx?"active":""));var c=el("div","bnc",i<idx?"✓":String(i+1));var l=el("div","bl2",s);n.appendChild(c);n.appendChild(l);nodes.appendChild(n);});
    wrap.appendChild(nodes);
  }else{
    ST.forEach(function(s,i){
      if(i)wrap.appendChild(el("div","rl"+(i<=idx?" fdone":"")));
      wrap.appendChild(el("div","rn "+(i<idx?"done":i===idx?"active":""),i<idx?"✓":String(i+1)));
    });
  }
  return wrap;
}
function badges(p){
  var f=document.createDocumentFragment();
  if(p.building)f.appendChild(el("span","bdg build","● "+(p.runLabel||"working")));
  else f.appendChild(el("span","bdg"+(p.stage==="ready"?" ready":""),p.stage+(p.version?" · v"+p.version:"")));
  if(p.health)f.appendChild(el("span","bdg "+(p.health.up?"live":"down"),p.health.up?"● live · "+p.health.ms+"ms":"● DOWN"));
  return f;
}
function pcard(p){
  var c=el("div","pcard");c.onclick=function(){location.hash="#p="+encodeURIComponent(p.name);};
  var h=el("div","pc-h");h.appendChild(el("span","nm",p.name));h.appendChild(badges(p));c.appendChild(h);
  c.appendChild(rail(p,false));
  var ct=el("div","ctr");var cn=(p.activity&&p.activity.counts)||{};
  function kpi(l,v){var d=el("div");d.appendChild(el("b",null,String(v)));d.appendChild(document.createTextNode(l));return d;}
  ct.appendChild(kpi(" files",cn.writes||0));
  ct.appendChild(kpi(" actions",cn.actions||0));
  ct.appendChild(kpi(" tasks",(p.checkboxes&&p.checkboxes.total)?(p.checkboxes.done+"/"+p.checkboxes.total):"—"));
  c.appendChild(ct);
  if(p.building&&p.activity&&p.activity.entries&&p.activity.entries.length)c.appendChild(el("div","now","now: "+p.activity.entries[p.activity.entries.length-1].s));
  c.appendChild(el("div","pc-f",(p.pct||0)+"% · "+(p.lastCommit||"no activity")));
  return c;
}
function renderGrid(v){
  if(!products.length){v.appendChild(el("div","empty","No products yet — text an idea to your factory bot."));return;}
  var g=el("div","grid");products.forEach(function(p){g.appendChild(pcard(p));});v.appendChild(g);
}
function liveView(p){
  var w=el("div","live show");
  w.appendChild(rail(p,true));
  if(p.building){
    var seen={},row=el("div");
    (p.activity&&p.activity.entries||[]).slice().reverse().forEach(function(e){var ag=(e.s.match(/^[^·:]*agent/i)||[""])[0]||"";if(ag&&!seen[ag]){seen[ag]=1;var c=el("span","agc");c.appendChild(el("span","d"));c.appendChild(el("b",null,ag.trim()));row.appendChild(c);}});
    w.appendChild(row);
  }
  var feed=el("div","feed");
  (p.activity&&p.activity.entries||[]).slice().reverse().slice(0,10).forEach(function(e){var ln=el("div","ln");ln.appendChild(el("span","t",new Date(e.t).toTimeString().slice(0,8)));ln.appendChild(el("span",null,e.s));feed.appendChild(ln);});
  if(!(p.activity&&p.activity.entries&&p.activity.entries.length))feed.appendChild(el("div","ln","No activity recorded yet."));
  w.appendChild(feed);
  return w;
}
function reqLines(p){
  var out=[];(esc(p.requirements).split("\\n")).forEach(function(l){var m=l.match(/^\\s*[-*]\\s*\\[( |x)\\]\\s*(.+)/i);if(m)out.push({s:m[2].trim(),done:m[1].toLowerCase()==="x"});});
  return out;
}
function evidence(p,key){
  if(key==="Capture")return p.idea||"—";
  if(key==="Plan"){var r="";if(p.requirements)r+="WHAT'S PLANNED:\\n"+p.requirements+"\\n\\n";if(p.assumptions)r+="DECISIONS MADE FOR YOU:\\n"+p.assumptions;return r||"Plan documents not written yet.";}
  if(key==="Design")return "Design system & screens (see live preview).";
  if(key==="Build"){var b=(p.board||[]).map(function(x){return (x.status==="done"?"✓ ":"○ ")+x.name;}).join("\\n");return b||"Build tasks in progress.";}
  if(key==="QA")return p.stateLine||"Independent QA: browser journeys, security, accessibility, showroom check.";
  if(key==="Release")return p.deployUrl?("Live: "+p.deployUrl):"Not yet promoted to production.";
  if(key==="Operate")return p.health?(p.health.up?("Healthy · "+p.health.ms+"ms"):"DOWN"):"Monitored 24/7 once live.";
  if(key==="Evolve")return (p.commits||0)+" updates · "+(p.lastCommit||"");
  return "";
}
function setH(e,o){e.style.maxHeight=o?e.scrollHeight+"px":"0";}
function sendReq(product,kind,text){
  fetch("/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({product:product,kind:kind,text:text})})
    .then(function(r){return r.json();}).then(function(){alert("Sent to the factory. Watch this product's activity.");})
    .catch(function(){alert("Could not reach the factory daemon.");});
}
function renderProduct(v,p){
  var back=el("span","back","← all products");back.onclick=function(){location.hash="";};v.appendChild(back);
  var h=el("div","dh");h.appendChild(el("span","nm",p.name));h.appendChild(badges(p));v.appendChild(h);
  v.appendChild(el("div","sub",(p.pct||0)+"% · "+(p.stateLine||p.stage||"")));
  var acts=el("div","acts");
  var demo=(p.health&&p.health.url)||p.deployUrl;
  if(demo){var a=el("a","btn go","▶ open demo");a.href=demo;a.target="_blank";acts.appendChild(a);}
  if(p.repoUrl){var rp=el("a","btn","code");rp.href=p.repoUrl;rp.target="_blank";acts.appendChild(rp);}
  var wl=el("button","btn bl","⚡ watch live");acts.appendChild(wl);
  var rc=el("button","btn bl","＋ request a change");rc.onclick=function(){var t=prompt("Describe the change or bug for "+p.name+":");if(t)sendReq(p.name,"change",t);};acts.appendChild(rc);
  v.appendChild(acts);
  var live=liveView(p);live.classList.remove("show");v.appendChild(live);
  wl.onclick=function(){live.classList.toggle("show");wl.classList.toggle("on");};
  if(p.building){live.classList.add("show");wl.classList.add("on");}
  // zig-zag roadmap
  var road=el("div","road");road.appendChild(el("div","spine"));
  var idx=stageIdx(p);
  ST.forEach(function(s,i){
    var cls=i<idx?"done":i===idx?"active":"todo";
    var st=el("div","stage "+cls);st.style.animationDelay=(0.12+i*0.1)+"s";
    st.appendChild(el("div","node",i<idx?"✓":String(i+1)));
    var card=el("div","scard");
    var sh=el("div","sh");sh.appendChild(el("span","tt",(i+1)+" · "+s));sh.appendChild(el("span","pill",cls==="done"?"done":cls==="active"?"active":"upcoming"));sh.appendChild(el("i","chev","▾"));
    card.appendChild(sh);
    var body=el("div","sbody");
    // tasks per stage
    var tlist=el("ul","tasks");
    var tasks=[];
    if(s==="Plan"){tasks=[["Requirements written",p.requirements],["Decisions logged",p.assumptions]];}
    else if(s==="Build"){tasks=(p.board||[]).map(function(b){return [b.name,(b.status==="done"?"Completed.":"In progress.")+(b.tasks&&b.tasks.length?" "+b.tasks.filter(function(t){return t.done;}).length+"/"+b.tasks.length+" tasks.":"")];});if(!tasks.length)tasks=[["Build","In progress."]];}
    else {tasks=[[s,evidence(p,s)]];}
    tasks.forEach(function(t){
      var tk=el("li","task "+(cls==="done"?"t":cls==="active"&&s==="Build"?"now":""));
      var tr=el("div","trow");tr.appendChild(el("i","ic",cls==="done"?"✓":"○"));tr.appendChild(el("span","tlbl",t[0]));tr.appendChild(el("i","chev","▾"));tr.style.fontSize="14px";
      tk.appendChild(tr);
      var det=el("div","det");det.appendChild(el("div","detin",esc(t[1])||"—"));tk.appendChild(det);
      tr.addEventListener("click",function(){var o=!tk.classList.contains("topen");tk.classList.toggle("topen",o);setH(det,o);});
      tlist.appendChild(tk);
    });
    body.appendChild(tlist);
    // editable scope inside Plan
    if(s==="Plan"){
      var items=reqLines(p);
      if(items.length){
        var hdr=el("div","detin","Edit scope — add or remove features; the factory re-plans:");hdr.style.margin="6px 10px";body.appendChild(hdr);
        var changes={add:[],rm:[]};
        items.slice(0,12).forEach(function(it){
          var row=el("div","ed");row.appendChild(el("span","lt",it.s));var x=el("span","x","✕");row.appendChild(x);
          x.onclick=function(){if(row.classList.contains("rm")){row.classList.remove("rm");changes.rm=changes.rm.filter(function(z){return z!==it.s;});}else{row.classList.add("rm");changes.rm.push(it.s);}};
          body.appendChild(row);
        });
        var add=el("div","edadd");var inp=document.createElement("input");inp.placeholder="add a feature…";var ab=el("button","btn bl","add");
        ab.onclick=function(){if(inp.value.trim()){changes.add.push(inp.value.trim());var row=el("div","ed new");row.appendChild(el("span","lt",inp.value.trim()));body.insertBefore(row,add);inp.value="";}};
        add.appendChild(inp);add.appendChild(ab);body.appendChild(add);
        var ap=el("button","btn bl","Apply to build →");ap.style.margin="4px 10px 10px";
        ap.onclick=function(){if(!changes.add.length&&!changes.rm.length){alert("No changes to apply.");return;}var txt="Scope edit. ADD: "+(changes.add.join("; ")||"none")+". REMOVE: "+(changes.rm.join("; ")||"none")+".";sendReq(p.name,"scope",txt);};
        body.appendChild(ap);
      }
    }
    card.appendChild(body);
    st.appendChild(card);
    sh.addEventListener("click",function(){var o=!st.classList.contains("sopen");st.classList.toggle("sopen",o);if(o){body.style.maxHeight=body.scrollHeight+"px";body.addEventListener("transitionend",function te(){if(st.classList.contains("sopen"))body.style.maxHeight="none";body.removeEventListener("transitionend",te);});}else{body.style.maxHeight=body.scrollHeight+"px";requestAnimationFrame(function(){body.style.maxHeight="0";});}});
    if(cls==="active"){st.classList.add("sopen");body.style.maxHeight="none";}
    road.appendChild(st);
  });
  v.appendChild(road);
  setTimeout(function(){var sp=v.querySelector(".spine");if(sp)sp.style.height=(road.scrollHeight-12)+"px";},250);
}
function render(){
  var v=document.getElementById("view");v.textContent="";
  var m=location.hash.match(/^#p=(.+)$/);
  var p=m&&products.find(function(x){return x.name===decodeURIComponent(m[1]);});
  if(p)renderProduct(v,p);else renderGrid(v);
}
window.addEventListener("hashchange",render);
function tick(){fetch("data.json?_="+Date.now(),{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){if(d.uiVersion&&d.uiVersion!==DATA.uiVersion){location.reload();return;}products=d.products;last=Date.now();render();}).catch(function(){});}
if(location.protocol==="file:")setTimeout(function(){location.reload();},60000);else setInterval(tick,15000);
setInterval(function(){document.getElementById("upd").textContent="updated "+Math.round((Date.now()-last)/1000)+"s ago";},1000);
render();
</script>
</body></html>`;
}

export function buildDashboard(root = ROOT) {
  const products = collectProducts(root);
  const out = path.join(root, 'dashboard');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify({ generated: new Date().toISOString(), uiVersion: UI_VERSION, products }, null, 2));
  fs.writeFileSync(path.join(out, 'index.html'), html(products));
  return products;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const products = buildDashboard();
  console.log(`dashboard/index.html written — ${products.length} product(s)`);
}
