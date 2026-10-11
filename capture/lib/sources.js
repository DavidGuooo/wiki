// Per-platform extraction. Each returns an item:
// {platform, externalId, url, title, author, parts: [{label, author, text}], images: [{file, text}],
//  transcripts: [{label, segments: [{start, text}]}]}
// Images are written to `<work>/images/`; GPT-6-Luna reads them (see vision.js).
import {execFile} from 'node:child_process';
import {copyFile, mkdir, readdir, readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {config} from './config.js';
import {cleanText, normalizeLink, urlHash} from './links.js';
import {downloadAudio, duration, fetchBounded, mediaInfo, saveImage, transcribe} from './media.js';
import {readItemImages} from './vision.js';

const exec = promisify(execFile);
const pad = n => String(n).padStart(2, '0');

export async function extract(link, work, progress = () => {}) {
  const images = path.join(work, 'images');
  await mkdir(images, {recursive: true});
  const item = link.platform === 'x' ? await fromX(link, work)
    : link.platform === 'xiaohongshu' ? await fromXhs(link, work, progress)
    : await fromMedia(link, work, progress) || await fromWeb(link);
  item.images ||= [];
  item.transcripts ||= [];
  await readItemImages(item, images);
  return item;
}

// Identity is known before the expensive steps for X/XHS/YouTube; used for de-duplication.
export async function identify(link) {
  if (link.externalId) return link;
  if (link.platform === 'xiaohongshu') {
    let url = link.url;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(url, {redirect: 'manual', signal: AbortSignal.timeout(20000)});
      await res.body?.cancel();
      if (res.status < 300 || res.status >= 400) break;
      url = new URL(res.headers.get('location'), url).href;
      const next = normalizeLink(url);
      if (next.externalId) return {...next, shareUrl: link.url};
    }
    throw Error('Could not resolve this Xiaohongshu share link.');
  }
  return {...link, externalId: urlHash(link.url)};
}

async function fromX(link, work) {
  const token = (Number(link.externalId) / 1e15 * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  const {data} = await fetchBounded(`https://cdn.syndication.twimg.com/tweet-result?id=${link.externalId}&lang=en&token=${token}`);
  const tweet = JSON.parse(data.toString());
  if (!tweet.text) throw Error('X did not expose this post (private, deleted, or restricted).');
  // The displayed name (e.g. "Kun Chen"), falling back to the @handle.
  const name = t => t.user?.name || (t.user?.screen_name ? '@' + t.user.screen_name : '');
  const hasVideo = t => Boolean(t.video || t.mediaDetails?.some(m => m.type === 'video'));
  const posts = [{label: 'Post', t: tweet, url: link.url}];
  if (tweet.quoted_tweet && /^\d+$/.test(tweet.quoted_tweet.id_str))
    posts.push({label: 'Quoted post', t: tweet.quoted_tweet, url: `https://x.com/i/web/status/${tweet.quoted_tweet.id_str}`});

  // Replace t.co links with their targets (article links are covered by the article part below).
  const expand = t => (Array.isArray(t.entities) ? t.entities : t.entities?.urls || [])
    .reduce((s, u) => s.replaceAll(u.url, u.expanded_url?.includes('/i/article/') ? '' : u.expanded_url || ''), t.text || '');
  // A quoted post's media is not fetched: it is marked with [Image] / [Video] placeholders in its text.
  const placeholders = t => [...(t.photos || []).map(() => '[Image]'), ...(hasVideo(t) ? ['[Video]'] : [])].join(' ');
  const text = p => [cleanText(expand(p.t)), p.label === 'Quoted post' ? placeholders(p.t) : ''].filter(Boolean).join('\n\n');
  const item = {platform: 'x', externalId: link.externalId, url: link.url, title: '', author: name(tweet),
    parts: posts.map(p => ({label: p.label, author: name(p.t), text: text(p)})), images: [], transcripts: []};
  if (tweet.article?.title) {
    item.title = tweet.article.title;
    item.parts.push({label: 'X Article', author: name(tweet),
      text: `_X Article: only the public preview is available; open the original for the full text._\n\n${tweet.article.preview_text || ''}`});
    const cover = tweet.article.cover_media?.media_info?.original_img_url;
    if (cover && new URL(cover).hostname === 'pbs.twimg.com') item.images.push({file: await saveImage(cover, path.join(work, 'images'), '01'), source: 'Article cover'});
  }
  for (const photo of tweet.photos || []) {
    if (item.images.length >= config.limits.images) break;
    if (new URL(photo.url).hostname !== 'pbs.twimg.com') continue;
    item.images.push({file: await saveImage(photo.url, path.join(work, 'images'), pad(item.images.length + 1))});
  }
  if (hasVideo(tweet)) {
    const dir = path.join(work, 'audio');
    await mkdir(dir, {recursive: true});
    item.transcripts.push({label: 'Video', segments: await transcribe(await downloadAudio(link.url, dir), dir)});
  }
  return item;
}

async function fromXhs(link, work, progress) {
  const dir = path.join(work, 'xhs');
  await mkdir(dir, {recursive: true});
  const result = path.join(dir, 'result.json');
  try {
    await exec(path.join(config.xhsHome, '.venv/bin/python'), [path.join(config.tools, 'xhs-bridge.py'), config.xhsHome, link.shareUrl || link.url, dir, result],
      {cwd: config.xhsHome, timeout: 600000, maxBuffer: 4 * 1024 * 1024});
  } catch {
    throw Error('Xiaohongshu did not return this note (login wall, expired share link, or removed).');
  }
  const d = JSON.parse(await readFile(result, 'utf8'));
  const id = d['作品ID'];
  if (!/^[a-f\d]{24}$/i.test(id)) throw Error('Unexpected Xiaohongshu note ID.');
  // 小红书 topics (#x[话题]#) are listed as plain `Tags: a, b` text so they never become Obsidian tags.
  const hashtags = [...new Set([...(d['作品描述'] || '').matchAll(/#([^#[]+)\[话题\]#/g)].map(m => m[1].trim())
    .concat(String(d['作品标签'] || '').split(/\s+/)).filter(Boolean))];
  const text = cleanText((d['作品描述'] || '').replace(/#([^#[]+)\[话题\]#/g, ''));
  const item = {platform: 'xiaohongshu', externalId: id, url: `https://www.xiaohongshu.com/explore/${id}`, title: d['作品标题'] || '',
    author: d['作者昵称'] || '', hashtags, published: (d['发布时间'] || '').replace('_', 'T').slice(0, 16), parts: [{label: 'Post', author: d['作者昵称'] || '', text}],
    images: [], transcripts: []};
  const files = await readdir(path.join(dir, 'Download')).catch(() => []);
  if (d['作品类型'] === '视频') {
    const video = path.join(dir, 'Download', id + '.mp4');
    if ((await stat(video)).size > 500 * 1024 * 1024) throw Error('Video exceeds 500 MB.');
    const seconds = await duration(video);
    if (seconds > config.limits.mediaSeconds) throw Error('Video is too long.');
    if (seconds > 300) await progress(`⏳ Transcribing ${Math.round(seconds / 60)} min of audio…`);
    item.transcripts.push({label: 'Video', segments: await transcribe(video, dir)});
  } else {
    const order = f => Number(f.match(/_(\d+)\./)?.[1] || 0);
    const pictures = files.filter(f => f.startsWith(id + '_') && /\.(jpe?g|png|webp|heic)$/i.test(f)).sort((a, b) => order(a) - order(b));
    for (const f of pictures.slice(0, config.limits.images)) {
      const file = `${pad(item.images.length + 1)}${path.extname(f).toLowerCase().replace('.jpeg', '.jpg')}`;
      await copyFile(path.join(dir, 'Download', f), path.join(work, 'images', file));
      item.images.push({file});
    }
  }
  return item;
}

async function fromMedia(link, work, progress) {
  const info = await mediaInfo(link.url, {required: link.platform !== 'web'});
  if (!info) return null;
  if (info.duration > config.limits.mediaSeconds) throw Error(`Media longer than ${config.limits.mediaSeconds / 3600} h.`);
  if (info.duration > 300) await progress(`⏳ Transcribing ${Math.round(info.duration / 60)} min of audio…`);
  const dir = path.join(work, 'audio');
  await mkdir(dir, {recursive: true});
  const segments = await transcribe(await downloadAudio(info.url, dir), dir);
  return {platform: link.platform === 'web' ? info.extractor.replace(/[^a-z0-9]/g, '') : link.platform,
    externalId: link.externalId,
    url: info.url, title: info.title, author: info.author, parts: [{label: 'Description', author: info.author, text: info.description.trim()}],
    transcripts: [{label: info.hasVideo ? 'Video' : 'Audio', segments}]};
}

async function fromWeb(link) {
  const {data, type, url} = await fetchBounded(link.url, {limit: 5 * 1024 * 1024});
  if (!/html|text\/plain/.test(type)) throw Error('This link is not a web page or supported media.');
  const html = data.toString();
  const meta = name => decode(html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)`, 'i'))?.[1] || '');
  const title = meta('og:title') || decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  const text = decode(body.replace(/<(script|style|nav|header|footer|aside|noscript|svg|form)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|h\d|li|blockquote|pre|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n');
  if (!text && !title) throw Error('Could not read text from this page.');
  return {platform: 'web', externalId: link.externalId, url: url || link.url, title, author: meta('author'),
    parts: [{label: 'Page text', author: meta('author'), text: [meta('og:description') || meta('description'), text].filter(Boolean).join('\n\n').slice(0, 200000)}]};
}

function decode(s) {
  const named = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === '#'
    ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : named[e.toLowerCase()] ?? m);
}
