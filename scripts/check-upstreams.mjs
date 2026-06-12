#!/usr/bin/env node
// Compare vendored skill sources (daemon/upstreams.json pins) against upstream HEAD.
// Used by the daemon's daily self-upgrade check; also runnable standalone.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ex = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function checkUpstreams(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'daemon', 'upstreams.json'), 'utf8'));
  const updates = [];
  for (const s of manifest.sources) {
    try {
      const head = (await ex('gh', ['api', `repos/${s.repo}/commits/HEAD`, '--jq', '.sha'])).stdout.trim();
      if (head.startsWith(s.pinned)) continue;
      const cmp = JSON.parse((await ex('gh', [
        'api', `repos/${s.repo}/compare/${s.pinned}...${head}`,
        '--jq', '{ahead: .ahead_by, msgs: [.commits[].commit.message]}',
      ])).stdout);
      updates.push({
        name: s.name,
        repo: s.repo,
        pinned: s.pinned,
        head: head.slice(0, 7),
        ahead: cmp.ahead,
        highlights: (cmp.msgs || []).slice(-5).map(m => m.split('\n')[0].slice(0, 90)),
      });
    } catch { /* offline, rate-limited, or repo gone — skip quietly */ }
  }
  return updates;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const updates = await checkUpstreams();
  if (!updates.length) { console.log('all sources current'); process.exit(0); }
  for (const u of updates) {
    console.log(`${u.name} (${u.repo}): ${u.ahead} commits ahead of ${u.pinned} -> ${u.head}`);
    u.highlights.forEach(h => console.log('   ', h));
  }
}
