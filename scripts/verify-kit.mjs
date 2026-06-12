#!/usr/bin/env node
// Deterministic integrity check of the factory's skill kit. Exit 0 = healthy.
// Run by the daemon after every self-upgrade; failure triggers automatic rollback.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const NON_SKILL_DIRS = new Set(['gstack-shared']);

// 1. Every skill directory carries a valid SKILL.md
const skillsDir = path.join(ROOT, '.claude', 'skills');
let skillCount = 0;
for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
  if (!d.isDirectory() || NON_SKILL_DIRS.has(d.name)) continue;
  const f = path.join(skillsDir, d.name, 'SKILL.md');
  if (!fs.existsSync(f)) { problems.push(`missing SKILL.md: ${d.name}`); continue; }
  if (!/^name:/m.test(fs.readFileSync(f, 'utf8').slice(0, 500))) problems.push(`no name: frontmatter: ${d.name}`);
  skillCount++;
}
if (skillCount < 80) problems.push(`only ${skillCount} skills present (expected >= 80)`);

// 2. No global-path leakage from a botched re-import
try {
  const hits = execFileSync('grep', ['-rl', '~/.claude/gsd-core', path.join(ROOT, '.claude')], { encoding: 'utf8' }).trim();
  if (hits) problems.push(`global gsd paths leaked into: ${hits.split('\n').slice(0, 3).join(', ')}`);
} catch { /* grep exit 1 = no matches = good */ }

// 3. GSD support structure intact
for (const p of ['gsd-core/workflows', 'gsd-core/references', 'commands/gsd']) {
  const full = path.join(ROOT, '.claude', p);
  if (!fs.existsSync(full) || fs.readdirSync(full).length < 5) problems.push(`gsd structure damaged: .claude/${p}`);
}
const gsdCmds = fs.readdirSync(path.join(ROOT, '.claude', 'commands', 'gsd')).filter(f => f.endsWith('.md')).length;
if (gsdCmds < 60) problems.push(`only ${gsdCmds} gsd commands (expected >= 60)`);

// 4. Custom factory skills must survive every upgrade
for (const s of ['fix-ci', 'deploy', 'release', 'post-deploy-monitor', 'handoff-product']) {
  if (!fs.existsSync(path.join(skillsDir, s, 'SKILL.md'))) problems.push(`custom skill lost: ${s}`);
}

if (problems.length) {
  console.error('KIT VERIFICATION FAILED:');
  problems.forEach(p => console.error('  -', p));
  process.exit(1);
}
console.log(`kit healthy: ${skillCount} skills, ${gsdCmds} gsd commands`);
