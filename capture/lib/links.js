import {createHash} from 'node:crypto';

// Classify a link. `externalId` is null when it is only known after resolving (short links, generic pages).
export function normalizeLink(input) {
  let u;
  try { u = new URL(input); } catch { throw Error('Not a valid link.'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) throw Error('Use a plain web link.');
  const host = u.hostname.toLowerCase().replace(/^(www|mobile|m)\./, '');

  if (['x.com', 'twitter.com'].includes(host)) {
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9_]+|i\/web)\/status\/(\d+)/);
    if (!m) throw Error('Use a direct X post link.');
    return {url: `https://x.com/i/web/status/${m[1]}`, platform: 'x', externalId: m[1]};
  }
  if (host === 'xiaohongshu.com') {
    const m = u.pathname.match(/^\/(?:explore|discovery\/item)\/([a-f\d]{24})\/?$/i);
    if (!m) throw Error('Use a Xiaohongshu note link.');
    const canonical = new URL(`https://www.xiaohongshu.com/explore/${m[1]}`);
    for (const k of ['xsec_token', 'xsec_source']) if (u.searchParams.has(k)) canonical.searchParams.set(k, u.searchParams.get(k));
    return {url: canonical.href, platform: 'xiaohongshu', externalId: m[1]};
  }
  if (['xhslink.com', 'xhslink.cn'].includes(host)) return {url: `https://${host}${u.pathname}`, platform: 'xiaohongshu', externalId: null};
  if (host === 'youtu.be') return youtube(u.pathname.slice(1));
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const id = u.searchParams.get('v') || u.pathname.match(/^\/(?:shorts|live|embed)\/([\w-]{11})/)?.[1];
    if (id) return youtube(id);
  }
  // Anything else: media sites go through yt-dlp, other pages are read as web pages.
  u.hash = '';
  return {url: u.href, platform: 'web', externalId: null};
}

function youtube(id) {
  if (!/^[\w-]{11}$/.test(id)) throw Error('Use a YouTube video link.');
  return {url: `https://www.youtube.com/watch?v=${id}`, platform: 'youtube', externalId: id};
}

export const urlHash = url => createHash('sha1').update(url).digest('hex').slice(0, 12);

export function extractLinks(text = '') {
  return [...text.matchAll(/https?:\/\/[^\s<>"，。！）】]+/g)].map(m => m[0].replace(/[).,;!?]+$/, ''));
}

export function cleanText(text = '') {
  return text.replace(/https?:\/\/t\.co\/\w+/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
