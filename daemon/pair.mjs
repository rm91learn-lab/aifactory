#!/usr/bin/env node
// One-time pairing: waits for the first Telegram message to the bot, authorizes
// that chat id in daemon/config.json, then exits 0 so a wrapper can start the daemon.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAEMON_DIR = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(DAEMON_DIR, '.env');
if (!process.env.TELEGRAM_BOT_TOKEN && fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) { console.error('TELEGRAM_BOT_TOKEN not set (daemon/.env)'); process.exit(1); }
const API = `https://api.telegram.org/bot${TOKEN}`;

const configFile = path.join(DAEMON_DIR, 'config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
if (config.allowedChatIds.length) {
  console.log('already paired:', config.allowedChatIds.join(', '));
  process.exit(0);
}

console.log('waiting for the first message to the bot (up to 15 minutes)…');
const deadline = Date.now() + 15 * 60_000;
while (Date.now() < deadline) {
  let res = null;
  try {
    res = await fetch(`${API}/getUpdates?timeout=50`, { signal: AbortSignal.timeout(60_000) }).then(r => r.json());
  } catch { /* network hiccup; retry */ }
  const msg = res?.result?.find(u => u.message?.chat?.id)?.message;
  if (msg) {
    config.allowedChatIds.push(msg.chat.id);
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    console.log(`paired chat ${msg.chat.id} (${msg.chat.first_name || msg.chat.username || 'user'})`);
    process.exit(0);
  }
}
console.error('timed out waiting — run again: node daemon/pair.mjs');
process.exit(1);
