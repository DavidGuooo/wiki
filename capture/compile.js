// Bookkeeping for the nightly "compile topics" routine (a Claude Code desktop scheduled task).
// The routine does the compiling itself; this script only tracks what was routed since the last compile.
//   node capture/compile.js plan             JSON: {topic: {added: [...], removed: [...]}} changed since last compile
//   node capture/compile.js mark <topic>     record <topic> as compiled (after its wiki is updated)
//   node capture/compile.js baseline         record everything routed now as compiled
//   node capture/compile.js notify <text>    send <text> to Telegram
import {existsSync} from 'node:fs';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './lib/config.js';
import {diffTopics, topicMembers} from './lib/topics.js';

const [command, ...args] = process.argv.slice(2);
const snapshotFile = path.join(config.state, 'compiled-topics.json');
await mkdir(config.state, {recursive: true});
const snapshot = existsSync(snapshotFile) ? JSON.parse(await readFile(snapshotFile, 'utf8')) : null;
const save = data => writeFile(snapshotFile, JSON.stringify(data, null, 1));

if (command === 'plan') {
  const now = await topicMembers();
  if (!snapshot) { await save(now); console.log('{}'); process.exit(0); } // first run: today's routing counts as compiled
  const plan = diffTopics(snapshot, now);
  for (const t of Object.keys(plan)) if (!existsSync(path.join(config.vault, 'topics', t, 'AGENTS.md'))) plan[t].missingTopicFolder = true;
  console.log(JSON.stringify(plan, null, 1));
} else if (command === 'mark' && args[0]) {
  const now = await topicMembers();
  await save({...snapshot, [args[0]]: now[args[0]] || []});
  console.log(`marked ${args[0]} as compiled`);
} else if (command === 'baseline') {
  await save(await topicMembers());
  console.log('baseline written');
} else if (command === 'notify' && args.length) {
  const {token, user} = config.telegram;
  if (!token || !user) throw Error('Telegram is not configured in .env');
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({chat_id: user, text: args.join(' ').slice(0, 4000), link_preview_options: {is_disabled: true}})});
  if (!res.ok) throw Error(`Telegram returned ${res.status}`);
} else {
  console.error('usage: node capture/compile.js plan | mark <topic> | baseline | notify <text>');
  process.exit(2);
}
