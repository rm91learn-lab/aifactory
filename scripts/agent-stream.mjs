#!/usr/bin/env node
// Translate a headless agent's stream-json output into human-readable activity.
// Used by the daemon to power the dashboard's live activity feed.

function short(s, n = 90) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function rel(p) {
  return String(p || '').replace(/^.*\/products\/[^/]+\//, '');
}

// One stream-json event -> zero or more feed lines.
export function humanize(evt) {
  const out = [];
  if (evt?.type !== 'assistant') return out;
  for (const block of evt.message?.content || []) {
    if (block.type === 'text' && block.text?.trim()) {
      out.push({ kind: 'thought', s: '💭 ' + short(block.text, 110) });
    } else if (block.type === 'tool_use') {
      const i = block.input || {};
      switch (block.name) {
        case 'Write': case 'Edit': case 'MultiEdit': case 'NotebookEdit':
          out.push({ kind: 'write', s: '✏️ writing ' + short(rel(i.file_path), 70) }); break;
        case 'Read':
          out.push({ kind: 'read', s: '📖 reading ' + short(rel(i.file_path), 70) }); break;
        case 'Bash':
          out.push({ kind: 'command', s: '⚙️ ' + short(i.description || i.command, 90) }); break;
        case 'Glob': case 'Grep':
          out.push({ kind: 'read', s: '🔍 searching ' + short(i.pattern || i.query, 60) }); break;
        case 'Task': case 'Agent':
          out.push({ kind: 'agent', s: '🤖 sub-agent: ' + short(i.description || i.prompt, 80) }); break;
        case 'Skill':
          out.push({ kind: 'agent', s: '🧩 using skill: ' + short(i.skill || i.command, 60) }); break;
        case 'TodoWrite':
          out.push({ kind: 'plan', s: '📋 updating the task list' }); break;
        case 'WebFetch': case 'WebSearch':
          out.push({ kind: 'read', s: '🌐 researching ' + short(i.url || i.query, 70) }); break;
        default:
          out.push({ kind: 'other', s: '🔧 ' + short(block.name, 40) });
      }
    }
  }
  return out;
}

// Returns a chunk handler that buffers partial lines, parses JSON events, and
// calls onEntry({t, kind, s}) for each humanized activity line.
export function makeLineParser(onEntry) {
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
      for (const entry of humanize(evt)) {
        onEntry({ t: new Date().toISOString(), ...entry });
      }
    }
  };
}
