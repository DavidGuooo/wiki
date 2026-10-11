import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const capture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(capture);
try { process.loadEnvFile(path.join(repo, '.env')); } catch { /* No .env: Telegram stays disabled. */ }
const support = path.join(os.homedir(), 'Library/Application Support');

export const config = {
  repo,
  capture,
  tools: path.join(capture, 'tools'),
  vault: process.env.VAULT_DIR || path.join(repo, 'vault'),
  // Worker state (Telegram offset, scratch space) lives outside the vault.
  state: process.env.CAPTURE_STATE_DIR || path.join(support, 'wiki-capture'),
  // Shared Qwen3-ASR runtime + GPU lock (also used by LingTok).
  qwenConfig: path.join(support, 'QwenASR/config.json'),
  // Pinned copy owned by this repo; installed by `npm run setup-xhs`.
  xhsHome: process.env.XHS_DOWNLOADER_HOME || path.join(repo, '.tools/xhs-downloader'),
  cookieFile: process.env.SCRAPER_COOKIE_FILE,
  bin: {
    ytdlp: '/opt/homebrew/bin/yt-dlp',
    ffmpeg: '/opt/homebrew/bin/ffmpeg',
    ffprobe: '/opt/homebrew/bin/ffprobe',
  },
  // Image text (GPT-6-Luna). No fallback: captures with images fail when it is unavailable.
  openai: {key: process.env.OPENAI_API_KEY, baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    visionModel: process.env.VISION_MODEL || 'gpt-6-luna'},
  limits: {images: 20, mediaSeconds: 4 * 3600, mediaBytes: '500M'},
  telegram: {token: process.env.TELEGRAM_BOT_TOKEN, user: process.env.TELEGRAM_ALLOWED_USER_ID},
};
