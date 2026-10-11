# Knowledge vault

A personal knowledge system with two parts:

1. **Captures**: everything the owner saves (X, xiaohongshu, YouTube, web pages) is extracted to text in `raw/` and listed in `inbox.md` (watch-later).
2. **Topics**: one compiled wiki per topic in `topics/<name>/`, Karpathy-style, driven by that topic's `questions.md`.

The goal is understanding and remembering, not collecting. Learning happens in the owner's own notes and in Anki. The topic wikis and Q&A exist to support that.

**Before working on a topic, read `topics/<t>/AGENTS.md`**: each topic has its own rules.

## Ownership

| Path | Owner | Rule |
|---|---|---|
| `raw/<id>/` | capture worker | **Never edit** `source.md` or its related assets. |
| `inbox.md` | capture worker + owner | The checkbox is the only state: `- [x]` means processed. The worker keeps unchecked items first and checked items last, each newest first, and deletes checked items captured 30 or more days ago. Never delete lines yourself. |
| `notes/` | **the owner** | Never rewrite their words or edit anything else unless asked. |
| `topics/<t>/` | **you (the agent)** | You write and maintain `wiki/` and `outputs/`. `questions.md` is shared: you may propose and add questions, but the owner's own questions stay as written. |

**Only the owner sets `topics`**, the frontmatter property that routes a raw source or a note to a topic. Never add, change or suggest topics unless asked.

## File formats

`raw/<date>-<platform>-<id>/source.md` has frontmatter, then these sections:
- `## Content` (the post or page text; `### Post` / `### Quoted post` when a post quotes another. A quoted post's media is not fetched: `[Image]` / `[Video]` mark where it was)
- `## Image text` (for posts whose images only carry text: the text, transcribed verbatim; the images are not kept) or `## Images` (only images that add information beyond the content, such as charts or screenshots; embedded, without text; covers and decorative images are not kept)
- `## Transcription` (speech from the video or audio, as continuous text)
- `## Supplied text` (text the owner sent by hand for a link that could not be fetched)

Image text (GPT-6-Luna) and transcripts (local Qwen ASR) are machine-generated and may contain errors. Say so when it matters.

`notes/<raw-id>.md` is the owner's note on that item; `notes/daily/YYYY-MM-DD.md` holds thoughts that have no source.

The frontmatter is the index; there is no index file. Find things with grep, for example `grep -l "topics: \[.*investing" raw/*/source.md`. Topic lists are bracketed and unquoted (`topics: [agentic-coding, product]`), or a `- item` list after Obsidian edits them.

## Workflows

The owner invokes these by name ("review my inbox", "compile investing", …).

### review
Walk through the unchecked (`- [ ]`) lines of `inbox.md` with the owner, one item at a time: show the title and a 2–3 line gist of `source.md`. Do what they ask, such as appending their dictated lines to `notes/<id>.md` (creating it like the worker does if it is missing). Then check the box (`- [x]`).

### compile `<topic>`
Runs every night through the "Compile topics" routine for each topic whose routing changed (`node ../capture/compile.js plan` lists them); the owner can also ask for it. A topic's sources are the raw items and notes whose `topics` include it (`grep -l` the frontmatter); the nightly run lists exactly what was routed and un-routed. The owner routes by the underlying idea, which may not be explicit in the text: work out the connection and state it on the page. Read `topics/<t>/AGENTS.md` (topic rules) and `questions.md`, then update `topics/<t>/wiki/`:
- `index.md`: a map of pages, each with a one-line summary, plus "Sources absorbed" with wikilinks.
- Concept pages: one per concept, entity, or claim cluster, written in your own words, citing sources as `[[raw/<id>/source]]` and marking the owner's notes as theirs.
- Link pages to each other with `[[ ]]`. Prefer updating an existing page to creating a near-duplicate.

Do not pad: thin evidence means a short page.

### lint `<topic>` (or `lint` for the whole vault)
Health check, written to `topics/<t>/outputs/lint-YYYY-MM-DD.md`:
- contradictions between sources, or between a source and the owner's notes or wiki pages;
- claims that are stale (dated, superseded);
- connections worth a new page;
- open questions to add to `questions.md`.

The vault-wide variant also asks: "how do this week's captures (`captured` in the last 7 days) relate to existing topics and notes?" and "is a theme recurring that deserves its own topic?"

### ask `<question>`
Answer from the vault first (topic wiki → raw → notes), citing files. Say clearly when the vault does not contain the answer, and only then use outside knowledge, labelled as such. Only when the owner says so ("file this"), save the answer to `topics/<t>/outputs/YYYY-MM-DD-<slug>.md` and add its useful findings back into the wiki, so explorations add up.

### delete `<item>`
Deletes a capture for good: its line in `inbox.md` and its `raw/<id>/` folder (`source.md` and assets). Find the id from the title, link or inbox line, confirm with the owner which item you mean, then run `node ../capture/delete.js <id>` (it also accepts the item's link). Raw files are not in git, so this cannot be undone. The owner's notes on the item are kept. If the item was routed to a topic, the next compile removes what the wiki took from it.

## Capturing from here

`node ../capture/add.js <link>` captures a link exactly like the Telegram bot does.
