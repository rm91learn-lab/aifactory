#!/usr/bin/env node
// AI-Factory → Tolaria vault generator. Writes one markdown note per product
// (YAML frontmatter + lifecycle + links) into a Tolaria vault so every product
// the factory builds is recorded and browsable in Tolaria.app. Reuses the
// dashboard's collectProducts(). Pure generation — writing the git history is
// the caller's job (the daemon commits; backfill commits manually).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectProducts } from './build-dashboard.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function vaultDir(root = ROOT) {
  let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'daemon', 'config.json'), 'utf8')); } catch {}
  return cfg.vaultPath || path.join(os.homedir(), 'AI-Factory-Vault');
}

const STAGES = ['Idea', 'Strategy', 'PRD', 'Design', 'Build', 'QA', 'Live'];
function stageIndex(p) {
  if (p.gate) return { strategy: 1, prd: 2, design: 3 }[p.gate.stage] ?? 0;
  const rl = p.runLabel || '';
  if (p.building) {
    if (/strateg/i.test(rl)) return 1;
    if (/PRD/i.test(rl)) return 2;
    if (/design/i.test(rl)) return 3;
    if (/QA/i.test(rl)) return 5;
    return 4;
  }
  if ((p.health && p.health.url) || p.deployUrl) return 6;
  if (p.staged || p.qaVerdict) return 5;
  if ((p.board && p.board.length) || (p.tasks && p.tasks.length)) return 4;
  if (p.has && (p.has.design || p.has.designSkip)) return 3;
  if (p.has && p.has.prd) return 2;
  if (p.has && p.has.strategy) return 1;
  return 0;
}
function statusOf(p) {
  if (p.gate) return `awaiting-approval (${p.gate.stage})`;
  if (p.building) return `building (${p.runLabel || 'working'})`;
  if ((p.health && p.health.url) || p.deployUrl) return p.health && !p.health.up ? 'live (DOWN)' : 'live';
  if (p.staged || p.qaVerdict) return /^PASS/i.test(p.qaVerdict || '') ? 'qa-passed (staged)' : 'staged (awaiting QA)';
  return 'in progress';
}
const yamlEsc = (s) => `"${String(s || '').replace(/"/g, '\\"')}"`;

function noteFor(p) {
  const idx = stageIndex(p);
  const live = (p.health && p.health.url) || p.deployUrl || '';
  const fm = [
    '---',
    'type: Product',
    `status: ${yamlEsc(statusOf(p))}`,
    `stage: ${STAGES[idx]}`,
    `progress: ${p.pct || 0}`,
    `repo: ${yamlEsc(p.repoUrl || '')}`,
    `live: ${yamlEsc(live)}`,
    `staged: ${yamlEsc(p.staged || '')}`,
    `qa: ${yamlEsc((p.qaVerdict || '').split('\n')[0] || '—')}`,
    `version: ${yamlEsc(p.version || '')}`,
    `created: ${yamlEsc((p.createdAt || '').slice(0, 10))}`,
    `updated: ${yamlEsc(new Date().toISOString().slice(0, 10))}`,
    '---',
  ].join('\n');
  const lifecycle = STAGES.map((s, i) => `- [${i < idx ? 'x' : ' '}] ${s}${i === idx ? '  ← current' : ''}`).join('\n');
  const links = [
    p.repoUrl && `- Repo: ${p.repoUrl}`,
    live && `- Live: ${live}`,
    p.staged && `- Staging: ${p.staged}`,
    p.docs && /^https?:/.test(p.docs) && `- Docs: ${p.docs}`,
    p.has && p.has.strategy && '- Strategy: `STRATEGY.md` (in repo)',
    p.has && p.has.prd && '- PRD: `PRD.md` (in repo)',
    p.has && p.has.design && '- Wireframes: `design/` (in repo)',
  ].filter(Boolean).join('\n') || '- (no links yet)';
  return `${fm}

# ${p.name}

${p.idea ? p.idea.split('\n')[0].slice(0, 280) : '_No idea recorded._'}

## Lifecycle — ${STAGES[idx]} (${p.pct || 0}%)
${lifecycle}

## Links
${links}

## Latest
${p.stateLine || p.lastCommit || 'no activity yet'}

---
_Auto-recorded by the AI-Factory. Status reflects the last sync._
`;
}

const TYPE_NOTE = `---
type: Type
icon: package
color: blue
sidebar label: Products
---

# Product

Products built by the AI-Factory — one note per product, kept in sync with the factory pipeline (Idea → Strategy → PRD → Design → Build → QA → Live).
`;

export function buildVault(root = ROOT) {
  const dir = vaultDir(root);
  fs.mkdirSync(path.join(dir, 'type'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'type', 'product.md'), TYPE_NOTE);
  const products = collectProducts(root);
  for (const p of products) fs.writeFileSync(path.join(dir, `product-${p.name}.md`), noteFor(p));
  return { dir, count: products.length, names: products.map(p => p.name) };
}

// Mark a product's note decommissioned (called when a product is killed).
export function vaultDecommission(slug, root = ROOT) {
  const dir = vaultDir(root);
  const f = path.join(dir, `product-${slug}.md`);
  let body = '';
  try { body = fs.readFileSync(f, 'utf8').replace(/^status: .*$/m, `status: "decommissioned"`); } catch {
    body = `---\ntype: Product\nstatus: "decommissioned"\nstage: "—"\n---\n\n# ${slug}\n`;
  }
  if (!/decommissioned on/.test(body)) body += `\n> Decommissioned on ${new Date().toISOString().slice(0, 10)} — see docs/DECOMMISSIONS.md.\n`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, body);
  return f;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = buildVault();
  console.log(`vault written to ${r.dir} — ${r.count} product(s): ${r.names.join(', ')}`);
}
