#!/usr/bin/env node
// AI-Factory dashboard generator — zero dependencies.
// Overview = product cards only. Per-product page (#p=<name>): a DORA-style metrics
// strip (complete · features done · WIP · lead time · QA), a feature Kanban
// (Backlog · In development · In QA/review · Done), a release view (production /
// staging), a collapsible edit-scope section, and parallel scrollable
// Build-activity and QA-activity windows. Re-renders only when data changes (no
// flicker). Data from .factory-activity.json, QA-REPORT.md and git. Served at
// localhost:7717 by the daemon.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI_VERSION = 15; // bump when the page's code changes; open tabs self-reload

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
      building: active.includes(name) || (a && a.updatedAt && (Date.now() - new Date(a.updatedAt).getTime() < 180000)),
      pct: pctFinal,
      board,
      tasks,
      phases: board.map(p => ({ name: p.name, done: p.status === 'done' })),
      checkboxes: boxes,
      stateLine: parseStateLine(read(path.join(planning, 'STATE.md'))),
      version: parseVersion(dir),
      repoUrl: git(dir, 'remote', 'get-url', 'origin').replace(/\.git$/, ''),
      deployUrl: (() => { const d = readJson(path.join(dir, 'DEPLOY.json')); return d?.url || d?.live_url || ''; })(),
      createdAt: git(dir, 'log', '--max-parents=0', '--format=%cI').split('\n').pop() || '',
      liveAt: (() => { const d = readJson(path.join(dir, 'DEPLOY.json')); return d?.deployedAt || ''; })(),
      staged: (() => { const d = readJson(path.join(dir, 'DEPLOY-STAGED.json')); return d?.previewUrl || d?.url || ''; })(),
      lastCommit: git(dir, 'log', '-1', '--format=%cr · %s').slice(0, 100),
      commits: Number(git(dir, 'rev-list', '--count', 'HEAD')) || 0,
      stage: !hasPlanning && !tasks.length ? 'scaffolded' : pctFinal >= 100 ? 'ready' : (board.length || tasks.length) ? 'in progress' : 'planning',
      health: h ? { up: h.up, ms: h.ms, url: h.url, downSince: h.downSince } : null,
      activity: a ? { updatedAt: a.updatedAt, counts: a.counts, entries: (a.entries || []).slice(-40) } : null,
      commitLog: git(dir, 'log', '--format=%cr · %s', '-40').slice(0, 4000),
      runLabel: { strategy: 'drafting strategy', prd: 'writing PRD', design: 'designing screens', build: 'building', change: 'applying change', qa: 'running QA', incident: 'fixing incident' }[a?.runKind] || (a?.runKind ? 'working' : null),
      requirements: read(path.join(planning, 'REQUIREMENTS.md')).trim().slice(0, 6000),
      assumptions: read(path.join(planning, 'ASSUMPTIONS.md')).replace(/^# .*\n+/,'').replace(/^Each entry.*\n+/m,'').trim().slice(0, 4000),
      qaVerdict: read(path.join(dir, 'QA-VERDICT.txt')).trim().slice(0, 600),
      qaReport: read(path.join(dir, 'QA-REPORT.md')).trim().slice(0, 24000),
      has: {
        strategy: fs.existsSync(path.join(dir, 'STRATEGY.md')),
        prd: fs.existsSync(path.join(dir, 'PRD.md')),
        design: fs.existsSync(path.join(dir, 'design', 'index.html')),
        designSkip: fs.existsSync(path.join(dir, 'DESIGN-SKIP.txt')),
        roadmap: fs.existsSync(path.join(planning, 'ROADMAP.md')),
        requirements: fs.existsSync(path.join(planning, 'REQUIREMENTS.md')),
        finalReport: fs.existsSync(path.join(dir, 'FINAL-REPORT.md')),
      },
      gate: (() => {
        const g = readJson(path.join(dir, '.gate.json'));
        if (!g?.stage) return null;
        const f = { strategy: 'STRATEGY-SUMMARY.txt', prd: 'PRD-SUMMARY.txt', design: 'DESIGN-SUMMARY.txt' }[g.stage];
        return { stage: g.stage, summary: (f ? read(path.join(dir, f)) : '').trim().slice(0, 2000) };
      })(),
      docs: read(path.join(dir, 'DOCS.txt')).trim().split('\n')[0].slice(0, 300),
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
  .qpanel{background:#0f1623;border:0.5px solid #232f47;border-radius:14px;padding:14px 16px;margin-bottom:16px}
  .qh{font-size:14px;font-weight:600;margin-bottom:10px}
  .qsec{margin-bottom:9px}.qsec:last-child{margin-bottom:0}
  .ql{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#7c8aa0;margin-bottom:4px}
  .qitem{font-size:13px;color:#c3cdda;padding:3px 0 3px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qitem.b{color:#d29922}.qitem.dim{color:#56627a}
  .qa{background:#0f1623;border:0.5px solid #232f47;border-radius:14px;padding:16px;margin-bottom:16px}
  .qa-h{display:flex;align-items:center;gap:10px;font-size:15px;font-weight:600;margin-bottom:10px}
  .qv{font-size:11px;padding:2px 10px;border-radius:20px}
  .qv.pass{color:#3fb950;background:#0e1f14;border:0.5px solid #1f3d28}
  .qv.fail{color:#f0716f;background:#1f1314;border:0.5px solid #5a2a2a}
  .qv.run{color:#5b8cff;background:#101a2e;border:0.5px solid #2d4373}
  .qa-live{background:#101a2e;border:0.5px solid #2d4373;border-radius:8px;padding:10px;margin-bottom:10px}
  .qa-step{font-size:13px;color:#c3cdda;padding:2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .qa-verdict{font-size:13px;color:#c3cdda;white-space:pre-wrap;margin-bottom:10px;padding:9px 11px;background:#0b1018;border-radius:8px}
  .qa-report{max-height:360px;overflow-y:auto;font-family:ui-monospace,monospace;font-size:12px;color:#9aa6b8;white-space:pre-wrap;background:#0b1018;border:0.5px solid #1c2638;border-radius:8px;padding:12px;line-height:1.55}
  .windows{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px}
  .windows .qa{margin-bottom:0}
  @media(max-width:760px){.windows{grid-template-columns:1fr}}
  .mstrip{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px}
  @media(max-width:640px){.mstrip{grid-template-columns:repeat(2,1fr)}}
  .mcard{background:#0f1623;border:0.5px solid #232f47;border-radius:12px;padding:13px 14px}
  .mcard .mv{font-size:22px;font-weight:600;color:#e6edf3}
  .mcard .ml{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7c8aa0;margin-top:2px}
  .mcard.ok .mv{color:#3fb950}.mcard.bad .mv{color:#f0716f}.mcard.run .mv{color:#5b8cff}
  .kbwrap{background:#0f1623;border:0.5px solid #232f47;border-radius:14px;padding:16px;margin-bottom:16px}
  .kb{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;overflow-x:auto}
  @media(max-width:760px){.kb{grid-template-columns:repeat(4,minmax(150px,1fr))}}
  .kcol{background:#0b1018;border:0.5px solid #1c2638;border-radius:10px;padding:9px;min-height:80px}
  .kch{display:flex;justify-content:space-between;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7c8aa0;margin-bottom:8px;padding:0 2px}
  .kn{color:#e6edf3}
  .kcard{background:#141b29;border:0.5px solid #2b3650;border-radius:8px;padding:8px 10px;margin-bottom:7px;font-size:13px}
  .kcard.done{border-color:#1f3d28}.kcard.qa{border-color:#7a5c1a}.kcard.dev{border-color:#2d4373}
  .kt{color:#dbe3ee}
  .kcard.done .kt::before{content:"✓ ";color:#3fb950}
  .kp{font-size:11px;color:#7c8aa0;margin-top:3px}
  .rel{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
  @media(max-width:640px){.rel{grid-template-columns:1fr}}
  .relcard{background:#0f1623;border:0.5px solid #232f47;border-radius:12px;padding:13px 15px}
  .relcard.ok{border-color:#1f3d28}.relcard.bad{border-color:#5a2a2a}.relcard.stg{border-color:#7a5c1a}
  .rl2{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#7c8aa0}
  .rv{font-size:14px;color:#e6edf3;margin-top:3px}
  .relcard.ok .rv{color:#3fb950}.relcard.bad .rv{color:#f0716f}.relcard.stg .rv{color:#d29922}
  .rurl{display:block;font-size:12px;font-family:ui-monospace,monospace;color:#5b8cff;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sh2{cursor:pointer}
  .sbody2{max-height:0;overflow:hidden;transition:max-height .3s}
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
  .bdg.gate{color:#e8c061;border-color:#7a5c1a;background:#1c1606}
  .kill{margin-left:auto;color:#56627a;cursor:pointer;font-size:16px;border:0;background:transparent;padding:2px 7px;border-radius:6px;line-height:1}
  .kill:hover{color:#f0716f;background:#1f1314}
  .appr{background:#171206;border:0.5px solid #7a5c1a;border-radius:12px;padding:13px 15px;margin:4px 0 12px}
  .appr-h{font-size:13px;font-weight:600;color:#e8c061;margin-bottom:6px}
  .appr-s{font-size:12.5px;color:#c3cdda;white-space:pre-wrap;max-height:160px;overflow:auto;background:#0b1018;border-radius:8px;padding:9px 11px;margin:8px 0;line-height:1.5}
  .appr-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .fab{position:fixed;right:20px;bottom:20px;z-index:40;height:52px;border-radius:26px;border:0;background:#5b8cff;color:#fff;font-size:15px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.45);padding:0 20px;display:flex;align-items:center;gap:8px}
  .fab.hide{display:none}
  .drawer{position:fixed;right:0;top:0;bottom:0;width:410px;max-width:100vw;z-index:50;background:#0b0f18;border-left:0.5px solid #232f47;display:flex;flex-direction:column;transform:translateX(102%);transition:transform .25s;box-shadow:-8px 0 30px rgba(0,0,0,.4)}
  .drawer.open{transform:none}
  .dwh{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:0.5px solid #1c2638}
  .dwh b{font-size:15px;flex:1}
  .dwh .cl{cursor:pointer;color:#7c8aa0;font-size:22px;line-height:1}
  .msgs{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}
  .msg{max-width:86%;padding:9px 12px;border-radius:13px;font-size:13.5px;white-space:pre-wrap;line-height:1.5;word-break:break-word}
  .msg.f{background:#141b29;border:0.5px solid #232f47;align-self:flex-start;border-bottom-left-radius:3px}
  .msg.u{background:#1b3a6b;color:#eaf1ff;align-self:flex-end;border-bottom-right-radius:3px}
  .msg.sys{align-self:center;background:transparent;color:#56627a;font-size:12px;padding:2px}
  .chips{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 8px}
  .chip{font-size:12.5px;border:0.5px solid #34507f;background:#101a2e;color:#9fc0ff;border-radius:16px;padding:6px 12px;cursor:pointer}
  .chip:hover{background:#16243d}
  .cin{display:flex;gap:8px;padding:12px 14px;border-top:0.5px solid #1c2638}
  .cin textarea{flex:1;resize:none;background:#0f1623;border:0.5px solid #2b3650;border-radius:10px;color:#e6edf3;font:14px/1.4 -apple-system,'Segoe UI',Roboto,sans-serif;padding:9px 11px;outline:none;max-height:120px}
  .cin button{border:0;background:#5b8cff;color:#fff;border-radius:10px;padding:0 16px;font-size:14px;cursor:pointer}
  @media(max-width:480px){.drawer{width:100vw}.fab{right:14px;bottom:14px}}
</style></head><body>
<header><h1 onclick="location.hash=''" style="cursor:pointer">AI-Factory</h1><span id="upd"></span></header>
<div id="view"></div>
<button class="fab" id="fab">💬 Factory chat</button>
<div class="drawer" id="drawer">
  <div class="dwh"><b>Factory chat</b><span class="cl" id="chatcl">✕</span></div>
  <div class="msgs" id="msgs"></div>
  <div class="chips" id="chips"></div>
  <div class="cin"><textarea id="cinp" rows="1" placeholder="Describe a product to build, or ask a question…"></textarea><button id="csend">Send</button></div>
</div>
<script>
var DATA=${data},products=DATA.products,last=Date.now();
var ST=["Idea","Strategy","PRD","Design","Build","QA","Live"];
var GATE_IDX={strategy:1,prd:2,design:3};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function esc(s){return String(s==null?"":s);}
function ago(t){var s=Math.max(0,Math.round((Date.now()-new Date(t).getTime())/1000));return s<90?s+"s":s<5400?Math.round(s/60)+"m":Math.round(s/3600)+"h";}
function stageIdx(p){
  if(p.gate)return GATE_IDX[p.gate.stage]||0;
  var rl=p.runLabel||"";
  if(p.building){
    if(/strateg/i.test(rl))return 1;
    if(/PRD/i.test(rl))return 2;
    if(/design/i.test(rl))return 3;
    if(/QA/i.test(rl))return 5;
    return 4;
  }
  if((p.health&&p.health.url)||p.deployUrl)return 6;
  if(p.staged||p.qaVerdict)return 5;
  if((p.board&&p.board.length)||(p.tasks&&p.tasks.length))return 4;
  if(p.has&&(p.has.design||p.has.designSkip))return 3;
  if(p.has&&p.has.prd)return 2;
  if(p.has&&p.has.strategy)return 1;
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
  if(p.gate)f.appendChild(el("span","bdg gate","⏳ approve "+p.gate.stage));
  if(p.building)f.appendChild(el("span","bdg build","● "+(p.runLabel||"working")));
  else if(!p.gate)f.appendChild(el("span","bdg"+(p.stage==="ready"?" ready":""),p.stage+(p.version?" · v"+p.version:"")));
  if(p.health)f.appendChild(el("span","bdg "+(p.health.up?"live":"down"),p.health.up?"● live · "+p.health.ms+"ms":"● DOWN"));
  return f;
}
function approveAct(name,decision,feedback){
  fetch("/approve",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({product:name,decision:decision,feedback:feedback})})
    .then(function(r){return r.json();}).then(function(r){if(r&&r.ok===false)alert(r.message||"Could not apply that.");else tick();})
    .catch(function(){alert("Could not reach the factory daemon.");});
}
function killAct(name){
  if(!confirm("Remove \\""+name+"\\" from the factory?\\n\\nThis archives a restorable copy, keeps the GitHub repo, and deletes the local workspace and its card. Any running work for it stops."))return;
  fetch("/kill",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({product:name})})
    .then(function(r){return r.json();}).then(function(r){if(r&&r.ok===false)alert(r.message||"Could not remove it.");else{if(location.hash)location.hash="";tick();}})
    .catch(function(){alert("Could not reach the factory daemon.");});
}
function approvalBanner(p){
  if(!p.gate)return null;
  var names={strategy:"Strategy",prd:"PRD — Product Requirements",design:"Design / wireframes"};
  var w=el("div","appr");
  w.appendChild(el("div","appr-h","⏳ Awaiting your approval — "+(names[p.gate.stage]||p.gate.stage)));
  if(p.gate.stage==="design"){var a=el("a","btn bl","🎨 View wireframes");a.href="/preview/"+encodeURIComponent(p.name)+"/";a.target="_blank";a.onclick=function(e){e.stopPropagation();};w.appendChild(a);}
  else{var rf=el("a","btn bl","📖 Read the full "+p.gate.stage);rf.href="/doc/"+encodeURIComponent(p.name)+"/"+(p.gate.stage==="prd"?"PRD.md":"STRATEGY.md");rf.target="_blank";rf.onclick=function(e){e.stopPropagation();};w.appendChild(rf);}
  if(p.gate.summary)w.appendChild(el("div","appr-s",p.gate.summary));
  var row=el("div","appr-row");
  var ap=el("button","btn go","✅ Approve & continue");ap.onclick=function(e){e.stopPropagation();approveAct(p.name,"approve");};
  var rv=el("button","btn bl","✏️ Request changes");rv.onclick=function(e){e.stopPropagation();var t=prompt("What should change in the "+p.gate.stage+"?");if(t)approveAct(p.name,"revise",t);};
  var cn=el("button","btn","✕ Cancel");cn.onclick=function(e){e.stopPropagation();if(confirm("Cancel \\""+p.name+"\\" at the "+p.gate.stage+" stage?"))approveAct(p.name,"cancel");};
  row.appendChild(ap);row.appendChild(rv);row.appendChild(cn);w.appendChild(row);
  return w;
}
function pcard(p){
  var c=el("div","pcard");c.onclick=function(){location.hash="#p="+encodeURIComponent(p.name);};
  var h=el("div","pc-h");h.appendChild(el("span","nm",p.name));h.appendChild(badges(p));
  var k=el("button","kill","🗑");k.title="Remove product";k.onclick=function(e){e.stopPropagation();killAct(p.name);};h.appendChild(k);
  c.appendChild(h);
  c.appendChild(rail(p,false));
  var ab=approvalBanner(p);if(ab)c.appendChild(ab);
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
function setH(e,o){e.style.maxHeight=o?e.scrollHeight+"px":"0";}
function sendReq(product,kind,text){
  fetch("/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({product:product,kind:kind,text:text})})
    .then(function(r){return r.json();}).then(function(){alert("Sent to the factory. Watch this product's activity.");})
    .catch(function(){alert("Could not reach the factory daemon.");});
}
function buildPanel(p){
  var building=p.building&&!/qa/i.test(p.runLabel||"");
  var w=el("div","qa");
  var h=el("div","qa-h");h.appendChild(el("span",null,"🔨 Build activity"));
  if(building)h.appendChild(el("span","qv run","● building now"));
  w.appendChild(h);
  if(p.building){
    var lq=el("div","qa-live");lq.appendChild(el("div","ql","working now — live"));
    var es=(p.activity&&p.activity.entries||[]).slice().reverse().slice(0,7);
    if(es.length)es.forEach(function(e){lq.appendChild(el("div","qa-step",e.s));});
    else lq.appendChild(el("div","qa-step","starting…"));
    w.appendChild(lq);
  }
  w.appendChild(el("div","ql","build history — every step & decision (scroll)"));
  var rep=el("div","qa-report");var hist="";
  (p.activity&&p.activity.entries||[]).slice().reverse().forEach(function(e){hist+="• "+e.s+"\\n";});
  if(p.commitLog)hist+="\\n—— committed milestones ——\\n"+p.commitLog;
  rep.textContent=hist||"No build activity recorded yet.";
  w.appendChild(rep);
  return w;
}
function qaPanel(p){
  var qaRunning=p.building&&/qa/i.test(p.runLabel||"");
  var w=el("div","qa");
  var h=el("div","qa-h");h.appendChild(el("span",null,"🧪 QA — what's being validated"));
  if(qaRunning)h.appendChild(el("span","qv run","● validating now"));
  else if(p.qaVerdict){var pass=/^PASS/i.test(p.qaVerdict);h.appendChild(el("span","qv "+(pass?"pass":"fail"),pass?"PASS":"FAIL"));}
  w.appendChild(h);
  if(qaRunning){
    var lq=el("div","qa-live");lq.appendChild(el("div","ql","validating now — live"));
    var es=(p.activity&&p.activity.entries||[]).slice().reverse().slice(0,7);
    if(es.length)es.forEach(function(e){lq.appendChild(el("div","qa-step",e.s));});
    else lq.appendChild(el("div","qa-step","starting checks…"));
    w.appendChild(lq);
  }
  if(p.qaVerdict)w.appendChild(el("div","qa-verdict",p.qaVerdict));
  w.appendChild(el("div","ql","full QA history — every round, finding & expected result (scroll)"));
  var rep=el("div","qa-report");rep.textContent=p.qaReport||"No QA report yet. QA runs after each build: it logs in as a real user, checks every promised module against the requirements, and records what it tested, the expected result, and pass/fail here.";
  w.appendChild(rep);
  return w;
}
function docLink(slug,rel,label,icon){var a=el("a","btn",icon+" "+label);a.href="/doc/"+encodeURIComponent(slug)+"/"+rel;a.target="_blank";return a;}
function docsPanel(p){
  var w=el("div","qa");
  var h=el("div","qa-h");h.appendChild(el("span",null,"📂 Documents"));w.appendChild(h);
  w.appendChild(el("div","ql","what the factory decided at each gate — tap to read"));
  var row=el("div","acts");
  var hs=p.has||{};
  if(hs.strategy)row.appendChild(docLink(p.name,"STRATEGY.md","Strategy","📋"));
  if(hs.prd)row.appendChild(docLink(p.name,"PRD.md","PRD","📋"));
  if(hs.roadmap)row.appendChild(docLink(p.name,".planning/ROADMAP.md","Roadmap","🗺"));
  if(hs.requirements)row.appendChild(docLink(p.name,".planning/REQUIREMENTS.md","Requirements","✅"));
  if(hs.design){var wf=el("a","btn bl","🎨 Wireframes");wf.href="/preview/"+encodeURIComponent(p.name)+"/";wf.target="_blank";row.appendChild(wf);}
  if(hs.finalReport)row.appendChild(docLink(p.name,"FINAL-REPORT.md","Build report","📄"));
  if(p.docs&&/^https?:/.test(p.docs)){var d=el("a","btn","📘 Product docs");d.href=p.docs;d.target="_blank";row.appendChild(d);}
  if(!row.children.length)row.appendChild(el("div","qitem dim","Documents appear here as each approval gate completes (Strategy → PRD → Wireframes)."));
  w.appendChild(row);
  return w;
}
function renderProduct(v,p){
  var back=el("span","back","← all products");back.onclick=function(){location.hash="";};v.appendChild(back);
  var h=el("div","dh");h.appendChild(el("span","nm",p.name));h.appendChild(badges(p));v.appendChild(h);
  v.appendChild(el("div","sub",(p.pct||0)+"% · "+(p.stateLine||p.stage||"")));
  // lifecycle status (always visible): Idea → Strategy → PRD → Design → Build → QA → Live
  var lc=el("div","live show");lc.appendChild(rail(p,true));v.appendChild(lc);
  var ab=approvalBanner(p);if(ab)v.appendChild(ab);
  var acts=el("div","acts");
  var demo=(p.health&&p.health.url)||p.deployUrl;
  if(demo){var a=el("a","btn go","▶ open demo");a.href=demo;a.target="_blank";acts.appendChild(a);}
  if(p.repoUrl){var rp=el("a","btn","code");rp.href=p.repoUrl;rp.target="_blank";acts.appendChild(rp);}
  if(p.docs&&/^https?:/.test(p.docs)){var dc=el("a","btn","📄 docs");dc.href=p.docs;dc.target="_blank";acts.appendChild(dc);}
  var wl=el("button","btn bl","⚡ watch live");acts.appendChild(wl);
  var rc=el("button","btn bl","＋ request a change");rc.onclick=function(){var t=prompt("Describe the change or bug for "+p.name+":");if(t)sendReq(p.name,"change",t);};acts.appendChild(rc);
  var rm=el("button","btn","🗑 remove");rm.onclick=function(){killAct(p.name);};acts.appendChild(rm);
  v.appendChild(acts);
  v.appendChild(docsPanel(p));
  var live=liveView(p);live.classList.remove("show");v.appendChild(live);
  wl.onclick=function(){live.classList.toggle("show");wl.classList.toggle("on");};
  if(p.building){live.classList.add("show");wl.classList.add("on");}
  var windows=el("div","windows");windows.appendChild(buildPanel(p));windows.appendChild(qaPanel(p));v.appendChild(windows);
  // industry-standard delivery view: metrics strip + feature Kanban + release view
  v.appendChild(metricsStrip(p));
  v.appendChild(featureKanban(p));
  v.appendChild(releaseStrip(p));
  v.appendChild(scopeEditor(p));
}
var KCOLS=[["backlog","Backlog"],["dev","In development"],["qa","In QA / review"],["done","Done"]];
function daysSince(a,b){if(!a)return null;var d=((b?new Date(b):new Date())-new Date(a))/86400000;return d<0?0:d;}
function metricsStrip(p){
  var rows=(p.board||[]);
  var done=rows.filter(function(r){return r.status==="done";}).length;
  var wip=rows.filter(function(r){return r.status==="dev"||r.status==="qa";}).length;
  var qa=p.building&&/qa/i.test(p.runLabel||"")?"running":(p.qaVerdict?(/^PASS/i.test(p.qaVerdict)?"PASS":"FAIL"):"—");
  var lead=daysSince(p.createdAt,p.liveAt);
  var leadStr=lead==null?"—":(lead<1?"<1d":Math.round(lead)+"d")+(p.liveAt?"":" so far");
  var w=el("div","mstrip");
  function m(l,v,cls){var d=el("div","mcard"+(cls?" "+cls:""));d.appendChild(el("div","mv",v));d.appendChild(el("div","ml",l));return d;}
  w.appendChild(m("complete",p.pct+"%"));
  w.appendChild(m("features done",done+"/"+rows.length));
  w.appendChild(m("in progress",String(wip)));
  w.appendChild(m("lead time",leadStr));
  w.appendChild(m("QA",qa,qa==="PASS"?"ok":qa==="FAIL"?"bad":qa==="running"?"run":""));
  return w;
}
function featureKanban(p){
  var rows=(p.board||[]);
  var w=el("div","kbwrap");
  var h=el("div","qa-h");h.appendChild(el("span",null,"🗂 Features"));h.appendChild(el("span","pill",rows.length+" total"));
  w.appendChild(h);
  if(!rows.length){w.appendChild(el("div","qitem dim","Features appear here as the factory plans them."));return w;}
  var board=el("div","kb");
  KCOLS.forEach(function(c){
    var col=el("div","kcol");
    var items=rows.filter(function(r){return (r.status||"backlog")===c[0];});
    var ch=el("div","kch");ch.appendChild(el("span",null,c[1]));ch.appendChild(el("span","kn",String(items.length)));col.appendChild(ch);
    items.forEach(function(r){
      var card=el("div","kcard "+c[0]);
      card.appendChild(el("div","kt",(r.change?"🔧 ":"")+r.name));
      if(r.tasks&&r.tasks.length){var d=r.tasks.filter(function(t){return t.done;}).length;card.appendChild(el("div","kp",d+"/"+r.tasks.length+" tasks"));}
      col.appendChild(card);
    });
    board.appendChild(col);
  });
  w.appendChild(board);
  return w;
}
function releaseStrip(p){
  var w=el("div","rel");
  var live=(p.health&&p.health.url)||p.deployUrl;
  var prod=el("div","relcard "+(p.health?(p.health.up?"ok":"bad"):""));
  prod.appendChild(el("div","rl2","Production"));
  prod.appendChild(el("div","rv",live?(p.health?(p.health.up?"● live · "+p.health.ms+"ms":"● DOWN"):"deployed"):"not deployed yet"));
  if(live){var a=el("a","rurl",live.replace("https://","").replace("http://",""));a.href=live;a.target="_blank";prod.appendChild(a);}
  w.appendChild(prod);
  var st=el("div","relcard "+(p.staged?"stg":""));
  st.appendChild(el("div","rl2","Staging"));
  st.appendChild(el("div","rv",p.staged?"● awaiting QA / promotion":"nothing staged"));
  if(p.staged){var a2=el("a","rurl",p.staged.replace("https://","").replace("http://",""));a2.href=p.staged;a2.target="_blank";st.appendChild(a2);}
  w.appendChild(st);
  return w;
}
function scopeEditor(p){
  var items=reqLines(p);
  var w=el("div","qa");
  var h=el("div","qa-h sh2");h.appendChild(el("span",null,"✏️ Edit scope"));h.appendChild(el("i","chev","▾"));
  w.appendChild(h);
  var body=el("div","sbody2");
  if(!items.length){body.appendChild(el("div","qitem dim","No requirement list yet to edit."));}
  else{
    body.appendChild(el("div","ql","add or remove features — the factory re-plans the rest"));
    var changes={add:[],rm:[]};
    items.slice(0,40).forEach(function(it){
      var row=el("div","ed");row.appendChild(el("span","lt",it.s));var x=el("span","x","✕");row.appendChild(x);
      x.onclick=function(){if(row.classList.contains("rm")){row.classList.remove("rm");changes.rm=changes.rm.filter(function(z){return z!==it.s;});}else{row.classList.add("rm");changes.rm.push(it.s);}};
      body.appendChild(row);
    });
    var add=el("div","edadd");var inp=document.createElement("input");inp.placeholder="add a feature…";var ab=el("button","btn bl","add");
    ab.onclick=function(){if(inp.value.trim()){changes.add.push(inp.value.trim());var row=el("div","ed new");row.appendChild(el("span","lt",inp.value.trim()));body.insertBefore(row,add);inp.value="";}};
    add.appendChild(inp);add.appendChild(ab);body.appendChild(add);
    var ap=el("button","btn bl","Apply to build →");ap.style.margin="6px 0 2px";
    ap.onclick=function(){if(!changes.add.length&&!changes.rm.length){alert("No changes to apply.");return;}sendReq(p.name,"scope","Scope edit. ADD: "+(changes.add.join("; ")||"none")+". REMOVE: "+(changes.rm.join("; ")||"none")+".");};
    body.appendChild(ap);
  }
  w.appendChild(body);
  h.addEventListener("click",function(){var o=!w.classList.contains("sopen2");w.classList.toggle("sopen2",o);setH(body,o);});
  return w;
}
function render(){
  // preserve scroll position + scroll inside the build/QA report panels across re-render
  var sy=window.scrollY;
  var scrolls=[].map.call(document.querySelectorAll(".qa-report"),function(e){return e.scrollTop;});
  var v=document.getElementById("view");v.textContent="";
  var m=location.hash.match(/^#p=(.+)$/);
  var p=m&&products.find(function(x){return x.name===decodeURIComponent(m[1]);});
  if(p)renderProduct(v,p);else renderGrid(v);
  [].forEach.call(document.querySelectorAll(".qa-report"),function(e,i){if(scrolls[i]!=null)e.scrollTop=scrolls[i];});
  window.scrollTo(0,sy);
}
window.addEventListener("hashchange",render);
var lastSig="";
function tick(){fetch("data.json?_="+Date.now(),{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){
  if(d.uiVersion&&d.uiVersion!==DATA.uiVersion){location.reload();return;}
  var sig=JSON.stringify(d.products);
  last=Date.now();
  if(sig===lastSig)return;      // nothing changed → no re-render, no flicker
  lastSig=sig;products=d.products;render();
}).catch(function(){});}
if(location.protocol==="file:")setTimeout(function(){location.reload();},60000);else setInterval(tick,15000);
setInterval(function(){document.getElementById("upd").textContent="updated "+Math.round((Date.now()-last)/1000)+"s ago";},1000);
// ---- factory chat drawer ----
var CHAT_KEY="factoryChat_v1",CHAT_ID_KEY="factoryChatLastId_v1";
var chatLog=[];try{chatLog=JSON.parse(localStorage.getItem(CHAT_KEY)||"[]");}catch(e){}
var chatLastId=Number(localStorage.getItem(CHAT_ID_KEY)||0);
var chatOpen=false,chatUnread=false;
var fab=document.getElementById("fab"),drawer=document.getElementById("drawer"),msgsEl=document.getElementById("msgs"),chipsEl=document.getElementById("chips"),cinp=document.getElementById("cinp");
function saveChat(){try{localStorage.setItem(CHAT_KEY,JSON.stringify(chatLog.slice(-200)));localStorage.setItem(CHAT_ID_KEY,String(chatLastId));}catch(e){}}
function renderChat(){
  msgsEl.textContent="";
  if(!chatLog.length)msgsEl.appendChild(el("div","msg sys","Tell the factory what to build. Every product passes Strategy → PRD → Design approvals before any code is written."));
  chatLog.forEach(function(m){msgsEl.appendChild(el("div","msg "+(m.role==="u"?"u":"f"),m.text));});
  msgsEl.scrollTop=msgsEl.scrollHeight;
  chipsEl.textContent="";
  var lastF=null;for(var i=chatLog.length-1;i>=0;i--){if(chatLog[i].role!=="u"){lastF=chatLog[i];break;}}
  if(lastF&&lastF.buttons&&lastF.buttons.length)lastF.buttons.forEach(function(b){var c=el("div","chip",b);c.onclick=function(){sendChat(b);};chipsEl.appendChild(c);});
}
function updateFab(){fab.textContent=chatUnread?"💬 Factory chat ●":"💬 Factory chat";}
function openChat(){chatOpen=true;chatUnread=false;drawer.classList.add("open");fab.classList.add("hide");renderChat();cinp.focus();}
function closeChat(){chatOpen=false;drawer.classList.remove("open");fab.classList.remove("hide");updateFab();}
function sendChat(text){
  text=String(text||"").trim();if(!text)return;
  chatLog.push({role:"u",text:text});saveChat();renderChat();
  fetch("/chat",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:text})})
    .then(function(){setTimeout(pollChat,400);})
    .catch(function(){chatLog.push({text:"⚠️ Could not reach the factory daemon."});saveChat();renderChat();});
}
function pollChat(){
  fetch("/chat/poll?since="+chatLastId,{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){
    if(!d)return;
    if(d.lastId<chatLastId){chatLastId=0;saveChat();return pollChat();} // daemon restarted → seq reset
    if(d.messages&&d.messages.length){
      d.messages.forEach(function(m){chatLog.push({text:m.text,buttons:m.buttons});});
      chatLastId=d.lastId;saveChat();
      if(chatOpen)renderChat();else{chatUnread=true;updateFab();}
    }
  }).catch(function(){});
}
fab.onclick=openChat;document.getElementById("chatcl").onclick=closeChat;
document.getElementById("csend").onclick=function(){sendChat(cinp.value);cinp.value="";cinp.style.height="auto";};
cinp.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendChat(cinp.value);cinp.value="";cinp.style.height="auto";}});
cinp.addEventListener("input",function(){cinp.style.height="auto";cinp.style.height=Math.min(cinp.scrollHeight,120)+"px";});
updateFab();setInterval(pollChat,3000);pollChat();
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
