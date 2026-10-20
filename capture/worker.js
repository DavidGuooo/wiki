// Telegram long-poll worker. No database: Telegram holds unhandled messages (up to 24 h) and the offset
// only advances after a message is fully handled, so a crash or sleep replays it rather than losing it.
import {watch} from 'node:fs';
import {mkdir, readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import path from 'node:path';
import {capture, captureSupplied} from './lib/capture.js';
import {config} from './lib/config.js';
import {fetchBounded} from './lib/media.js';
import {HELP, parseMessage} from './lib/telegram.js';
import {appendDaily, appendNote, sortInbox} from './lib/vault.js';

const {token, user} = config.telegram;
if (!token || !user) throw Error('Set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID in .env');
const stateFile = path.join(config.state, 'state.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {method: 'POST', redirect: 'error',
    headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(60000)});
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw Error(`Telegram ${method} failed (${res.status})`);
  return data.result;
}

async function download(fileId, dir) {
  const {file_path} = await api('getFile', {file_id: fileId});
  const {data} = await fetchBounded(`https://api.telegram.org/file/bot${token}/${file_path}`, {limit: 20 * 1024 * 1024});
  const file = path.join(dir, `tg-${Date.now()}${path.extname(file_path) || '.jpg'}`);
  await writeFile(file, data);
  return file;
}

// Errors from our own code are shown; tool/process failures are summarized (details stay in the log).
const reason = e => (e.cmd || e.code ? 'Extraction failed on the Mac (see capture log).' : e.message);
const saved = r => r.existed ? `Already saved: ${r.title}\n🗂 ${r.id}`
  : `✅ Saved: ${r.title}\n🗂 ${r.id}`;

async function handle(msg) {
  if (!msg || String(msg.from?.id) !== String(user) || msg.chat?.type !== 'private') return;
  const send = text => api('sendMessage', {chat_id: msg.chat.id, text, reply_parameters: {message_id: msg.message_id, allow_sending_without_reply: true},
    link_preview_options: {is_disabled: true}});
  const m = parseMessage(msg);
  await api('sendChatAction', {chat_id: msg.chat.id, action: 'typing'}).catch(() => {});

  if (m.kind === 'help') return send(HELP);
  if (m.kind === 'daily') { await appendDaily(m.text); return send('📝 Added to today\'s note.'); }
  if (m.kind === 'note') { await appendNote(m.id, m.text); return send('📝 Added to the note.'); }
  if (m.kind === 'capture') {
    for (const url of m.links) {
      try {
        await send(saved(await capture(url, {progress: send})));
      } catch (e) {
        log('capture failed', e.stack || e);
        await send(`⚠️ ${reason(e)}\n${url}\nReply to this message with the text or screenshots to save it anyway.`);
      }
    }
    return;
  }
  // screenshot / recover: material you supply
  await mkdir(path.join(config.state, 'work'), {recursive: true});
  const dir = await mkdtemp(path.join(config.state, 'work', 'tg-'));
  try {
    const files = m.photo ? [await download(m.photo.file_id, dir)] : [];
    const r = m.kind === 'recover'
      ? await captureSupplied({url: m.url, text: m.text, files})
      : await captureSupplied({externalId: m.group || m.photo.file_unique_id, text: m.caption, files});
    if (!r.appended || m.kind === 'recover') await send(r.appended ? `➕ Added to ${r.title}\n🗂 ${r.id}` : saved(r));
  } catch (e) {
    log('supplied capture failed', e.stack || e);
    await send(`⚠️ ${reason(e)}`);
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

await mkdir(config.state, {recursive: true});
let {offset = 0} = JSON.parse(await readFile(stateFile, 'utf8').catch(() => '{}'));
const attempts = new Map();
log('capture worker started; vault', config.vault);

// Checking a box in Obsidian moves that item to the bottom. Watch the folder (editors save by replacing files)
// and wait until edits settle, so the file is never rewritten while you are typing.
let resort;
watch(config.vault, {recursive: true}, (event, file) => {
  if (file !== 'inbox.md' && !/^raw\/[^/]+\/source\.md$/.test(file || '')) return;
  clearTimeout(resort);
  resort = setTimeout(() => sortInbox().catch(e => log('inbox sort failed', e.message)), 3000);
});
await sortInbox();
// Hourly, so checked items expire even when the inbox is not being edited.
setInterval(() => sortInbox().catch(e => log('inbox sort failed', e.message)), 3600000);
while (true) {
  try {
    const updates = await api('getUpdates', {offset, timeout: 25, allowed_updates: ['message']});
    for (const u of updates) {
      try {
        await handle(u.message);
      } catch (e) {
        // Usually Telegram/network: retry the same update later. Give up after 3 tries so one bad message can't block the queue.
        const n = (attempts.get(u.update_id) || 0) + 1;
        attempts.set(u.update_id, n);
        log('update failed', u.update_id, n, e.stack || e);
        if (n < 3) { await sleep(5000); break; }
      }
      offset = u.update_id + 1;
      attempts.delete(u.update_id);
      await writeFile(stateFile, JSON.stringify({offset}));
    }
  } catch (e) {
    log('poll failed', e.message);
    await sleep(5000);
  }
}
