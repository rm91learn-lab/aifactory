#!/usr/bin/env node
// Translate a headless agent's stream-json output into human-readable activity
// and a live task list. Used by the daemon for the dashboard's live feed/board.
// CLI: node scripts/agent-stream.mjs replay <stream.log> <activity.json>
//      re-derives the task list from a raw log and merges it into the activity file.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

function short(s, n = 90) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function rel(p) {
  return String(p || '').replace(/^.*\/products\/[^/]+\//, '');
}

// One stream-json event -> { entries: [...], taskOps: [...] }
export function interpret(evt) {
  const entries = [];
  const taskOps = [];
  if (evt?.type !== 'assistant') return { entries, taskOps };
  for (const block of evt.message?.content || []) {
    if (block.type === 'text' && block.text?.trim()) {
      entries.push({ kind: 'thought', s: '💭 ' + short(block.text, 110) });
    } else if (block.type === 'tool_use') {
      const i = block.input || {};
      switch (block.name) {
        case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
          entries.push({ kind: 'write', s: '✏️ writing ' + short(rel(i.file_path), 70) }); break;
        case 'Read':
          entries.push({ kind: 'read', s: '📖 reading ' + short(rel(i.file_path), 70) }); break;
        case 'Bash':
          entries.push({ kind: 'command', s: '⚙️ ' + short(i.description || i.command, 90) }); break;
        case 'Glob': case 'Grep':
          entries.push({ kind: 'read', s: '🔍 searching ' + short(i.pattern || i.query, 60) }); break;
        case 'Task': case 'Agent':
          entries.push({ kind: 'agent', s: '🤖 sub-agent: ' + short(i.description || i.prompt, 80) }); break;
        case 'Skill':
          entries.push({ kind: 'agent', s: '🧩 using skill: ' + short(i.skill || i.command, 60) }); break;
        case 'WebFetch': case 'WebSearch':
          entries.push({ kind: 'read', s: '🌐 researching ' + short(i.url || i.query, 70) }); break;
        case 'TodoWrite': {
          const todos = (i.todos || []).map(t => ({ s: short(t.content, 80), status: t.status || 'pending' }));
          taskOps.push({ op: 'snapshot', todos });
          const active = todos.find(t => t.status === 'in_progress');
          entries.push({ kind: 'plan', s: active ? '📋 working on: ' + active.s : '📋 task list updated (' + todos.length + ' items)' });
          break;
        }
        case 'TaskCreate': {
          const s = short(i.subject || i.description || i.prompt, 80);
          taskOps.push({ op: 'create', s });
          entries.push({ kind: 'plan', s: '📋 new task: ' + s });
          break;
        }
        case 'TaskUpdate': {
          taskOps.push({ op: 'update', id: i.taskId, status: i.status, s: i.subject ? short(i.subject, 80) : undefined });
          if (i.status === 'completed') entries.push({ kind: 'plan', s: '✅ task ' + (i.taskId || '') + ' completed' });
          else if (i.status === 'in_progress') entries.push({ kind: 'plan', s: '▶️ task ' + (i.taskId || '') + ' started' });
          break;
        }
        case 'TaskList': case 'TaskGet': case 'TaskOutput': case 'TaskStop':
          break; // internal bookkeeping, not worth narrating
        default:
          entries.push({ kind: 'other', s: '🔧 ' + short(block.name, 40) });
      }
    }
  }
  return { entries, taskOps };
}

export function applyTaskOps(tasks, ops) {
  for (const ev of ops) {
    if (ev.op === 'snapshot') {
      tasks = ev.todos.slice(0, 60);
    } else if (ev.op === 'create') {
      tasks = tasks.concat({ s: ev.s, status: 'pending' }).slice(-60);
    } else if (ev.op === 'update') {
      const idx = Number(ev.id) - 1;
      if (Number.isInteger(idx) && tasks[idx]) {
        if (ev.status) tasks[idx] = { ...tasks[idx], status: ev.status };
        if (ev.s) tasks[idx] = { ...tasks[idx], s: ev.s };
      }
    }
  }
  return tasks;
}

// Chunk handler: buffers lines, parses events, emits entries and task ops.
export function makeLineParser(onEntry, onTaskOps) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let evt;
      try { evt = JSON.parse(line); } catch { continue; }
      const { entries, taskOps } = interpret(evt);
      for (const e of entries) onEntry({ t: new Date().toISOString(), ...e });
      if (taskOps.length && onTaskOps) onTaskOps(taskOps);
    }
  };
}

// CLI replay: rebuild the task list from a full raw log, merge into activity file.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'replay') {
  const [, , , logFile, actFile] = process.argv;
  let tasks = [];
  for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    tasks = applyTaskOps(tasks, interpret(evt).taskOps);
  }
  let act = {};
  try { act = JSON.parse(fs.readFileSync(actFile, 'utf8')); } catch {}
  act.tasks = tasks;
  fs.writeFileSync(actFile, JSON.stringify(act));
  console.log(`merged ${tasks.length} tasks into ${actFile}`);
}
