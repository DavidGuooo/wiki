// Everything the worker writes into the Obsidian vault.
import {appendFile, cp, mkdir, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {config} from './config.js';
import {parseTopics} from './topics.js';

const vault = (...p) => path.join(config.vault, ...p);
export const localTime = (d = new Date()) => d.toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'); // 2026-10-11T17:30
export const today = (d = new Date()) => localTime(d).slice(0, 10);
const q = s => JSON.stringify(String(s ?? ''));
const linkSafe = s => String(s).replace(/[[\]|#^\n]/g, ' ').replace(/\s+/g, ' ').trim();
export const PLATFORM_NAMES = {x: 'X', xiaohongshu: 'xiaohongshu', youtube: 'YouTube', web: 'Web', screenshot: 'Screenshot'};

export function rawId(item, date = today()) {
  return `${date}-${item.platform}-${item.externalId}`.replace(/[^\w.-]/g, '');
}

export async function findRaw(externalId) {
  const names = await readdir(vault('raw')).catch(() => []);
  return names.find(n => n.endsWith(`-${externalId}`)) || null;
}

// Deletes a capture: its inbox line and its raw/<id>/ folder (source.md and assets). Your notes are kept.
export async function deleteItem(id) {
  if (!/^[\w.-]+$/.test(id) || !existsSync(vault('raw', id))) throw Error(`No capture with id ${id}`);
  const text = await readFile(vault('inbox.md'), 'utf8').catch(() => null);
  if (text !== null) await writeFile(vault('inbox.md'), text.split('\n').filter(l => !l.includes(`[[raw/${id}/source`)).join('\n'));
  await rm(vault('raw', id), {recursive: true, force: true});
}

// ASR chunks are cut every 60 s, often mid-sentence: join them without a break
// (no space between two CJK characters, a space otherwise).
export function joinSegments(texts) {
  const cjk = /[　-〿㐀-鿿＀-￯]/;
  return texts.filter(Boolean).reduce((all, t) => !all ? t : all + (cjk.test(all.at(-1)) && cjk.test(t[0]) ? '' : ' ') + t, '');
}

export function renderSource(item, meta) {
  const lines = ['---', `id: ${meta.id}`, `url: ${q(item.url)}`, `platform: ${item.platform}`, `author: ${q(item.author)}`,
    `title: ${q(item.title)}`];
  // Unquoted ISO date-times so Obsidian shows `published` and `captured` as the same Date & time property.
  if (item.published) lines.push(`published: ${/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(item.published) ? item.published : q(item.published)}`);
  lines.push(`captured: ${meta.captured}`, `topics: [${meta.topics.join(', ')}]`);
  lines.push('---', '', `# ${item.title || 'Untitled'}`);

  const parts = item.parts.filter(p => p.text);
  if (parts.length) {
    lines.push('', '## Content');
    for (const p of parts) {
      if (parts.length > 1) lines.push('', `### ${p.label}${p.author ? ` · ${p.author}` : ''}`);
      lines.push('', noTags(p.text));
    }
    if (item.hashtags?.length) lines.push('', `Tags: ${item.hashtags.join(', ')}`);
  }
  // Text-in-image posts keep only the text; other images are kept only when they add information.
  if (item.imageText) lines.push('', '## Image text', '', noTags(item.imageText));
  if (item.images.length) {
    lines.push('', '## Images');
    item.images.forEach((img, i) => lines.push(...imageSection(img, i + 1)));
  }
  if (item.transcripts.length) lines.push('', '## Transcription');
  for (const t of item.transcripts) {
    if (item.transcripts.length > 1) lines.push('', `### ${t.label}`);
    lines.push('', noTags(joinSegments(t.segments.map(s => s.text))) || '(no speech recognized)');
  }
  return lines.join('\n') + '\n';
}

const imageSection = (img, n) => ['', `### Image ${n}${img.source ? ` · ${img.source}` : ''}`, '', `![[images/${img.file}]]`];

// Captured text is not yours: escape `#word` so Obsidian does not turn it into tags.
export const noTags = (text = '') => text.replace(/(^|\s)#(?=[^\s#])/g, '$1\\#');

const topicSuffix = topics => topics?.length ? ` · topics: ${topics.map(linkSafe).join(', ')}` : '';

// Platform · author · title, followed by topics when routed.
export function inboxLine(meta, item) {
  const who = [PLATFORM_NAMES[item.platform] || item.platform, item.author].filter(Boolean).map(linkSafe).join(' · ');
  let line = `- [ ] ${who} · [[raw/${meta.id}/source|${linkSafe(item.title || fallbackTitle(item))}]]`;
  return line + topicSuffix(meta.topics) + '\n';
}

// Posts without a title of their own (e.g. X) are named by the start of their text.
export function fallbackTitle(item, length = 40) {
  const text = [...item.parts.map(p => p.text), item.imageText, ...(item.images || []).map(i => i.text),
    ...(item.transcripts || []).flatMap(t => t.segments.map(s => s.text))].find(t => t?.trim()) || '';
  const flat = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!flat) return `${PLATFORM_NAMES[item.platform] || item.platform} ${item.externalId}`;
  return [...flat].length > length ? [...flat].slice(0, length).join('').trimEnd() + '…' : flat;
}

// Atomic publish: build in vault/.capture-tmp (hidden from Obsidian), then rename into raw/.
export async function publishRaw(id, markdown, imagesDir) {
  const staging = vault('.capture-tmp', id);
  await rm(staging, {recursive: true, force: true});
  await mkdir(staging, {recursive: true});
  const images = imagesDir && existsSync(imagesDir) ? await readdir(imagesDir) : [];
  if (images.length) await cp(imagesDir, path.join(staging, 'images'), {recursive: true});
  await writeFile(path.join(staging, 'source.md'), markdown);
  await mkdir(vault('raw'), {recursive: true});
  await rename(staging, vault('raw', id));
}

// inbox.md: unchecked items first, then checked; each group newest first by the source's `captured` time.
// Checked items are deleted once they were captured 30 or more days ago.
const itemId = line => line.match(/\[\[raw\/([^/\]|]+)\/source/)?.[1];
const isDone = line => /^- \[[xX]\] /.test(line);

export async function addToInbox(line) {
  const text = existsSync(vault('inbox.md')) ? await readFile(vault('inbox.md'), 'utf8') : '# Inbox\n\n';
  const {head, items} = inboxItems(text);
  await writeFile(vault('inbox.md'), `${head}\n\n${[line.trimEnd(), ...items].join('\n')}\n`);
  await sortInbox();
}

// Re-sorts and prunes; returns whether the file changed.
export async function sortInbox(now = new Date()) {
  const text = await readFile(vault('inbox.md'), 'utf8').catch(() => null);
  if (text === null) return false;
  const {head, items} = inboxItems(text);
  const captured = {};
  const topics = {};
  for (const id of items.map(itemId).filter(Boolean)) {
    const md = await readFile(vault('raw', id, 'source.md'), 'utf8').catch(() => '');
    if (md) topics[id] = parseTopics(md);
    captured[id] = md.match(/^captured: (.*)$/m)?.[1] || '';
  }
  const old = line => captured[itemId(line)] && now - new Date(captured[itemId(line)]) >= 30 * 864e5;
  const refreshed = items.map(line => topics[itemId(line)]
    ? line.replace(/ · topics: .*$/, '') + topicSuffix(topics[itemId(line)]) : line);
  const sorted = renderInbox(head, refreshed.filter(line => !(isDone(line) && old(line))), captured);
  if (sorted === text) return false;
  await writeFile(vault('inbox.md'), sorted);
  return true;
}

export function inboxItems(text) {
  const lines = text.replace(/\n+$/, '').split('\n');
  const first = lines.findIndex(l => /^- \[[ xX]\] /.test(l));
  if (first < 0) return {head: lines.join('\n').trimEnd(), items: []};
  return {head: lines.slice(0, first).join('\n').trimEnd(), items: lines.slice(first).filter(l => l.trim())};
}

export function renderInbox(head, items, captured = {}) {
  const at = i => captured[itemId(i)] || '';
  const sorted = [...items].sort((a, b) => isDone(a) - isDone(b) || at(b).localeCompare(at(a)));
  return `${head}\n\n${sorted.join('\n')}\n`;
}

// Your own notes: one file per source, plus a daily file for thoughts without a source.
export async function appendNote(id, text) {
  const file = vault('notes', `${id}.md`);
  await mkdir(vault('notes'), {recursive: true});
  if (!existsSync(file)) {
    const source = await readFile(vault('raw', id, 'source.md'), 'utf8').catch(() => '');
    const title = source.match(/^title: (.*)$/m)?.[1] || '""';
    const topics = source.match(/^topics: (.*)$/m)?.[1] || '[]';
    await writeFile(file, `---\nsource: "[[raw/${id}/source]]"\ntitle: ${title}\ntopics: ${topics}\n---\n\n`);
  }
  await appendFile(file, bullets(text));
}

export async function appendDaily(text, date = today()) {
  const file = vault('notes', 'daily', `${date}.md`);
  await mkdir(path.dirname(file), {recursive: true});
  if (!existsSync(file)) await writeFile(file, `---\ndate: ${date}\n---\n\n`);
  await appendFile(file, bullets(text));
}

const bullets = text => text.trim().split('\n').map((l, i) => (i ? '  ' : '- ') + l).join('\n') + '\n';

export async function appendSourceText(id, text) {
  const file = vault('raw', id, 'source.md');
  const md = await readFile(file, 'utf8');
  await writeFile(file, md.trimEnd() + `\n\n## Supplied text\n\n${noTags(text.trim())}\n`);
}

export async function appendImageText(id, text) {
  const file = vault('raw', id, 'source.md');
  const md = (await readFile(file, 'utf8')).trimEnd();
  const last = [...md.matchAll(/^## .*$/gm)].at(-1)?.[0];
  await writeFile(file, md + (last === '## Image text' ? '' : '\n\n## Image text') + `\n\n${noTags(text)}\n`);
}

// Recovery albums: later photos are appended to the item created by the first one.
export async function appendImages(id, images, sourceDir) {
  const dir = vault('raw', id);
  await mkdir(path.join(dir, 'images'), {recursive: true});
  let md = await readFile(path.join(dir, 'source.md'), 'utf8');
  let n = (md.match(/^### Image \d+/gm) || []).length;
  if (!md.includes('\n## Images\n')) md = md.trimEnd() + '\n\n## Images\n';
  for (const img of images) {
    n++;
    const file = `${String(n).padStart(2, '0')}${path.extname(img.file)}`;
    await cp(path.join(sourceDir, img.file), path.join(dir, 'images', file));
    md = md.trimEnd() + '\n' + imageSection({...img, file}, n).join('\n') + '\n';
  }
  await writeFile(path.join(dir, 'source.md'), md);
}
