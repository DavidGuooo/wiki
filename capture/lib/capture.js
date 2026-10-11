// Capture = extract to text locally, route to topics, then publish to the vault in one step.
import {copyFile, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import path from 'node:path';
import {config} from './config.js';
import {normalizeLink, urlHash} from './links.js';
import {extract, identify} from './sources.js';
import {readImages, readItemImages} from './vision.js';
import {addToInbox, appendImages, appendImageText, appendSourceText, findRaw, fallbackTitle, inboxLine, localTime, publishRaw, rawId,
  renderSource} from './vault.js';

// A link. Returns {id, title, topics, existed}.
export async function capture(url, {progress} = {}) {
  const link = await identify(normalizeLink(url));
  const existing = await findRaw(link.externalId);
  if (existing) return {id: existing, title: await titleOf(existing), existed: true};
  return withWork(async work => publish(await extract(link, work, progress), work));
}

// Material you supply yourself: a screenshot, or text/photos recovering a link that failed.
// `files` are local image paths. Repeated calls for the same item append to it.
export async function captureSupplied({url, externalId, text = '', files = []}) {
  let link = {platform: 'screenshot', externalId, url: ''};
  if (url) {
    try { link = normalizeLink(url); } catch { link = {platform: 'web', url}; }
    link.externalId ||= urlHash(link.url);
  }
  return withWork(async work => {
    const images = [];
    await mkdir(path.join(work, 'images'), {recursive: true});
    for (const [i, f] of files.entries()) {
      const file = `${String(i + 1).padStart(2, '0')}${path.extname(f) || '.jpg'}`;
      await copyFile(f, path.join(work, 'images', file));
      images.push({file});
    }
    const existing = await findRaw(link.externalId);
    if (existing) {
      if (text) await appendSourceText(existing, text);
      if (images.length) {
        // Later photos of an album: read them on their own, then add text or images to the item.
        const r = await readImages(images.map(img => path.join(work, 'images', img.file)), text);
        if (r.textPost) await appendImageText(existing, r.text);
        else await appendImages(existing, images.filter((_, i) => r.keep[i]), path.join(work, 'images'));
      }
      return {id: existing, title: await titleOf(existing), appended: true};
    }
    const item = {platform: link.platform, externalId: link.externalId, url: link.url, title: '', author: '',
      parts: [{label: url ? 'Supplied text' : 'Caption', text}], images, transcripts: []};
    await readItemImages(item, path.join(work, 'images'));
    return publish(item, work);
  });
}

async function publish(item, work) {
  const id = rawId(item);
  item.title ||= fallbackTitle(item);
  const meta = {id, captured: localTime(), topics: []};
  await publishRaw(id, renderSource(item, meta), path.join(work, 'images'));
  await addToInbox(inboxLine(meta, item));
  return {id, title: item.title};
}

async function withWork(fn) {
  await mkdir(path.join(config.state, 'work'), {recursive: true});
  const work = await mkdtemp(path.join(config.state, 'work', 'job-'));
  try { return await fn(work); } finally { await rm(work, {recursive: true, force: true}); }
}

async function titleOf(id) {
  const md = await readFile(path.join(config.vault, 'raw', id, 'source.md'), 'utf8').catch(() => '');
  try { return JSON.parse(md.match(/^title: (.*)$/m)?.[1] || '""') || id; } catch { return id; }
}
