# Wiki

A local personal knowledge system: plain Markdown in an Obsidian vault, captured from Telegram, extracted to text on this Mac, and worked on by Claude Code.

- **Stream**: every link or screenshot you send is turned into text in `vault/raw/` (post text, image text, local transcript). Every capture is also added to `vault/inbox.md`, your watch-later list, as a checkbox line with its title.
- **Topics**: `vault/topics/<name>/` holds a Claude-compiled wiki per topic (Karpathy-style), driven by that topic's `questions.md`. The current topics are agentic-coding, investing, product and jazz.
- **Learning**: your own notes in `vault/notes/` and Anki cards. `AGENTS.md` defines the agent workflows: **review**, **compile**, **lint** and **ask**. You write flashcards yourself.

Transcription runs locally on the shared Qwen3-ASR runtime. Network calls: fetching the sources, Telegram, and one GPT-6-Luna call per post with images. That call classifies the post: when the images only carry text (a typical xiaohongshu text card), the text is stored verbatim and the images are dropped; otherwise only images that add information beyond the post (charts, diagrams, screenshots) are kept, without extracted text, and covers or decorative images are dropped. If GPT-6-Luna fails, the capture fails with ⚠️ and there is no fallback.

## Layout

```
AGENTS.md       rules + workflows for agents, run from the repo root (CLAUDE.md just imports it)
capture/        capture worker (Node; npm deps: defuddle + linkedom, the Obsidian Web Clipper's extractor)
  worker.js     Telegram bot (run by the LaunchAgent)
  add.js        capture from the terminal
  delete.js     delete a capture (inbox line + raw folder)
  install.js    install + start the LaunchAgent
  lib/          pipeline: links → sources (extract) → vision (image text) + media (audio/ASR) → route (topics) → vault (write)
  tools/        non-JS helpers: asr.py (Qwen), xhs-bridge.py, setup-xhs.sh
  tests/
.tools/         git-ignored third-party installs (pinned XHS-Downloader)
vault/          symlink to the Obsidian vault in iCloud Drive (Documents/wiki), not tracked in git
  inbox.md      watch-later queue, newest first; tick the checkbox when done: it moves to the bottom and is deleted once it was captured 30+ days ago
  raw/<date>-<platform>-<id>/source.md + images/   machine-written, never hand-edited
  notes/<raw-id>.md, notes/daily/YYYY-MM-DD.md, notes/ideas.md   yours (ideas.md: excerpts and brief ideas)
  topics/<name>/{AGENTS.md, questions.md, wiki/, outputs/}
```

## Telegram

| Send | Result |
|---|---|
| `<link>` | Saved to `raw/` and added to `inbox.md` |
| Screenshots (with an optional caption) | One item per album, text read by GPT-6-Luna, added to the inbox |
| Reply to a ✅ message with text | Appended to that item's note `notes/<id>.md` |
| Reply to a ⚠️ message with text or screenshots | Saves the failed link from what you supply |
| Any other text | Appended to today's `notes/daily/` note |

Supported sources: X (posts, quoted posts, video audio; X Articles only expose a public preview), xiaohongshu (image notes, videos with transcript, `xhslink` share links), YouTube and other sites yt-dlp supports (audio transcribed, up to 4 h), and web pages (main text).

A line is added to `inbox.md` only after a capture has fully finished. Progress and errors are reported in Telegram.

## Topics: you route, the agent compiles

Captures never get topics automatically. Routing is your call: while going through the inbox, set the `topics` property on a source (or on one of your notes) in Obsidian, for example `topics: [product]`, even when the text never mentions the topic and only the underlying idea fits.

Every night at 03:00, the Claude Code desktop routine **Compile topics** (sidebar → Scheduled) runs `node capture/compile.js plan` to see which topics' routed files changed since their last compile. It compiles each one following `AGENTS.md`, writing only inside `topics/<t>/`, marks it compiled, and sends a Telegram summary. The changes are **not committed**, so review them with `git diff`. A failed topic is retried the next night. The routine runs while the desktop app is open; if the app was closed at 03:00, it runs on the next launch. Use **Run now** to compile immediately.

```sh
node capture/compile.js plan        # what the next compile will cover
```

Titles are not generated either: a post with no title of its own (for example an X post) is named `<platform> <id>`.

## Run

Requirements: Node 22.13+, `yt-dlp`, `ffmpeg`/`ffprobe` (Homebrew), `OPENAI_API_KEY` in `.env` (GPT-6-Luna; `VISION_MODEL` overrides), the Claude Code desktop app (the nightly compile routine), the shared Qwen runtime at `~/Library/Application Support/QwenASR` (`config.json` with `python`, `model`, `lock`; the lock is `QwenASR/gpu.lock`, also used by LingTok, so the two never load the model at the same time), and XHS-Downloader pinned at v2.8 in `.tools/` (`npm run setup-xhs`).

`.env` (private) needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` and `OPENAI_API_KEY`. Only that user's private messages are accepted. Optional settings: `SCRAPER_COOKIE_FILE` (a Netscape cookie file for yt-dlp, needed when YouTube asks for sign-in), `VAULT_DIR`, `CAPTURE_STATE_DIR`.

```sh
npm run setup-xhs               # one-time: pinned XHS-Downloader into .tools/
npm run install-worker          # install + start LaunchAgent com.guodawei.wiki-capture
npm run add -- <link>           # capture from the terminal
node capture/delete.js <id|link> # delete a capture: its inbox line and raw/<id>/ (permanent)
npm test
```

Restart after code changes with `launchctl kickstart -k gui/$(id -u)/com.guodawei.wiki-capture`. The log is at `~/Library/Logs/wiki-capture.log`.

## How it stays simple

- **No database.** The files are the store, and frontmatter is the index. Telegram holds unhandled messages for up to 24 hours, and the worker only advances its offset (`~/Library/Application Support/wiki-capture/state.json`) after a message is fully handled. Links sent while the Mac is off for more than 24 hours are lost, so resend them.
- **Atomic captures.** Each item is built in `vault/.capture-tmp/` and renamed into `raw/` in one step. A raw folder that already exists for the same post means "already saved".
- **Transcription** runs in batches of 10 one-minute chunks per process, holding the shared GPU lock only per batch, so neither app keeps a model resident.

## Git

The repo tracks the code, your notes and the topic wikis. `vault/raw/` is not tracked: it is machine-written and never edited, so git history adds little. It is also not reproducible (posts get deleted), so back the vault up, for example with Time Machine. The legacy ChatGPT-Site app, the cloud worker and their data were removed after migration, and remain in git history: the first three commits (the Site source is `site-legacy.bundle`, the cloud post export is `legacy-cloud-export.json`).
