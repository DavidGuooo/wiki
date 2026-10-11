// Manual topic routing: you set `topics` on a source (or note) in Obsidian; the nightly compile
// diffs each topic's members against the last compiled snapshot.
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.js';

// `topics` from frontmatter, in either form Obsidian writes: `topics: [a, b]` or a `- a` list.
export function parseTopics(md) {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] || '';
  const m = fm.match(/^topics:[ \t]*(.*)$((?:\n[ \t]+- .*)*)/m);
  if (!m) return [];
  const items = m[1].trim() ? m[1].replace(/^\[|\]$/g, '').split(',') : m[2].split('\n').map(l => l.replace(/^\s*-\s*/, ''));
  return [...new Set(items.map(t => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean))];
}

// {topic: [member paths relative to the vault]} for raw sources and your notes.
export async function topicMembers() {
  const members = {};
  const add = (file, md) => { for (const t of parseTopics(md)) (members[t] ||= []).push(file); };
  for (const id of await readdir(path.join(config.vault, 'raw')).catch(() => [])) {
    const file = `raw/${id}/source.md`;
    const md = await readFile(path.join(config.vault, file), 'utf8').catch(() => null);
    if (md) add(file, md);
  }
  for (const name of await readdir(path.join(config.vault, 'notes')).catch(() => [])) {
    if (!name.endsWith('.md')) continue;
    add(`notes/${name}`, await readFile(path.join(config.vault, 'notes', name), 'utf8'));
  }
  for (const t in members) members[t].sort();
  return members;
}

export function diffTopics(before, now) {
  const changes = {};
  for (const t of new Set([...Object.keys(before), ...Object.keys(now)])) {
    const was = new Set(before[t] || []), is = new Set(now[t] || []);
    const added = [...is].filter(f => !was.has(f)), removed = [...was].filter(f => !is.has(f));
    if (added.length || removed.length) changes[t] = {added, removed};
  }
  return changes;
}
