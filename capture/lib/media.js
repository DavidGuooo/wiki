import {execFile} from 'node:child_process';
import {mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';
import {config} from './config.js';

const exec = promisify(execFile);
const CHUNK_SECONDS = 60, CHUNKS_PER_RUN = 10;

export async function fetchBounded(url, {limit = 8 * 1024 * 1024, headers = {}} = {}) {
  const res = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0', ...headers}, signal: AbortSignal.timeout(30000)});
  if (!res.ok) throw Error(`Source returned HTTP ${res.status}.`);
  let size = 0;
  const chunks = [];
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > limit) throw Error('Source exceeds size limit.');
    chunks.push(chunk);
  }
  return {data: Buffer.concat(chunks), type: res.headers.get('content-type') || '', url: res.url};
}

// Download an image to `dir/<name>.<ext>`; returns the file name.
export async function saveImage(url, dir, name) {
  const {data, type} = await fetchBounded(url);
  if (!/^image\/(jpeg|png|webp)/.test(type)) throw Error('Unsupported image format.');
  const file = `${name}.${type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg'}`;
  await writeFile(path.join(dir, file), data);
  return file;
}

// yt-dlp metadata, or null when yt-dlp does not recognize the page as media.
// With `required` (known media sites) a failure is reported instead.
export async function mediaInfo(url, {required = false} = {}) {
  const args = ['-J', '--no-playlist', '--no-warnings', '--socket-timeout', '20', ...cookies(), '--', url];
  try {
    const {stdout} = await exec(config.bin.ytdlp, args, {timeout: 120000, maxBuffer: 64 * 1024 * 1024});
    const d = JSON.parse(stdout);
    if (!d.duration && !d.formats?.some(f => f.acodec && f.acodec !== 'none')) return null;
    return {id: String(d.id), extractor: String(d.extractor_key || 'media').toLowerCase(), title: d.title || '',
      author: d.uploader || d.channel || d.creator || '', description: d.description || '', duration: d.duration || 0,
      url: d.webpage_url || url, hasVideo: Boolean(d.vcodec && d.vcodec !== 'none' || d.formats?.some(f => f.vcodec && f.vcodec !== 'none'))};
  } catch (e) {
    if (!required) return null;
    const msg = String(e.stderr || '').match(/ERROR: (.*)/)?.[1] || 'yt-dlp could not read this media.';
    throw Error(/sign in to confirm|not a bot/i.test(msg)
      ? 'YouTube asked for sign-in (bot check). Configure SCRAPER_COOKIE_FILE for yt-dlp, then resend.'
      : msg.replace(/\s+See\s+https?:\S+.*$/, '').slice(0, 300));
  }
}

export async function downloadAudio(url, dir) {
  const args = ['--no-playlist', '--no-warnings', '--max-filesize', config.limits.mediaBytes, '--socket-timeout', '20',
    '--retries', '2', '--match-filter', `duration <= ${config.limits.mediaSeconds}`, '-f', 'bestaudio/best',
    '-o', path.join(dir, 'source.%(ext)s'), ...cookies(), '--', url];
  await exec(config.bin.ytdlp, args, {timeout: 1800000, maxBuffer: 4 * 1024 * 1024});
  const file = (await readdir(dir)).find(f => f.startsWith('source.') && !f.endsWith('.part'));
  if (!file) throw Error(`No audio downloaded (limit ${config.limits.mediaSeconds / 3600} h).`);
  return path.join(dir, file);
}

export async function duration(file) {
  const {stdout} = await exec(config.bin.ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], {timeout: 30000});
  return Number(JSON.parse(stdout).format.duration) || 0;
}

// Local Qwen3-ASR over 60 s chunks. Returns [{start, text}] with start in seconds.
export async function transcribe(file, workDir) {
  const dir = path.join(workDir, 'chunks');
  await rm(dir, {recursive: true, force: true});
  await mkdir(dir, {recursive: true});
  await exec(config.bin.ffmpeg, ['-nostdin', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k',
    '-f', 'segment', '-segment_time', String(CHUNK_SECONDS), path.join(dir, 'chunk-%04d.mp3')], {timeout: 1800000, maxBuffer: 4 * 1024 * 1024});
  const chunks = (await readdir(dir)).filter(f => /^chunk-\d+\.mp3$/.test(f)).sort().map(f => path.join(dir, f));
  if (!chunks.length) throw Error('No audio in this media.');
  const qwen = JSON.parse(await readFile(config.qwenConfig, 'utf8'));
  const texts = [];
  // Batches release the shared GPU lock between runs so other Qwen users can interleave.
  for (let i = 0; i < chunks.length; i += CHUNKS_PER_RUN) {
    const out = path.join(dir, `batch-${i}.json`);
    await exec(qwen.python, [path.join(config.tools, 'asr.py'), config.qwenConfig, out, ...chunks.slice(i, i + CHUNKS_PER_RUN)],
      {timeout: 3600000, maxBuffer: 4 * 1024 * 1024});
    texts.push(...JSON.parse(await readFile(out, 'utf8')));
  }
  await rm(dir, {recursive: true, force: true});
  return texts.map((text, i) => ({start: i * CHUNK_SECONDS, text})).filter(t => t.text);
}

const cookies = () => config.cookieFile ? ['--cookies', config.cookieFile] : [];
