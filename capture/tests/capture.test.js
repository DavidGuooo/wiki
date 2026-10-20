import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'vault-test-'));
process.env.VAULT_DIR = tmp;
process.env.CAPTURE_STATE_DIR = path.join(tmp, '.state');
process.env.OPENAI_API_KEY = 'test-key';
const {normalizeLink, extractLinks} = await import('../lib/links.js');
const {parseMessage} = await import('../lib/telegram.js');
const v = await import('../lib/vault.js');
const {readItemImages} = await import('../lib/vision.js');
const {parseTopics, topicMembers, diffTopics} = await import('../lib/topics.js');

test('links are classified and canonicalized', () => {
  assert.deepEqual(normalizeLink('https://twitter.com/foo/status/123?s=20'), {url: 'https://x.com/i/web/status/123', platform: 'x', externalId: '123'});
  assert.equal(normalizeLink('https://www.xiaohongshu.com/explore/6ac84b0f000000001500280b?xsec_token=T').url,
    'https://www.xiaohongshu.com/explore/6ac84b0f000000001500280b?xsec_token=T');
  assert.equal(normalizeLink('https://xhslink.cn/o/2l6xesV8chW').externalId, null);
  assert.equal(normalizeLink('https://youtu.be/dQw4w9WgXcQ?t=5').externalId, 'dQw4w9WgXcQ');
  assert.equal(normalizeLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x').url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(normalizeLink('https://example.com/post#top').platform, 'web');
  assert.throws(() => normalizeLink('ftp://x'));
  assert.deepEqual(extractLinks('【标题】😆 http://xhslink.cn/o/abc 复制本条信息，'), ['http://xhslink.cn/o/abc']);
});

test('telegram grammar', () => {
  const bot = text => ({from: {is_bot: true}, text});
  assert.deepEqual(parseMessage({text: 'look https://x.com/a/status/1'}), {kind: 'capture', links: ['https://x.com/a/status/1']});
  assert.deepEqual(parseMessage({text: 'a thought', reply_to_message: bot('✅ Saved: T\n🗂 2026-10-11-x-1')}),
    {kind: 'note', id: '2026-10-11-x-1', text: 'a thought'});
  assert.equal(parseMessage({text: 'pasted', reply_to_message: bot('⚠️ Login wall\nhttps://xhslink.cn/o/abc\nReply…')}).url, 'https://xhslink.cn/o/abc');
  assert.equal(parseMessage({photo: [{file_id: 's'}, {file_id: 'L'}], caption: 'hm', media_group_id: 'g'}).photo.file_id, 'L');
  assert.equal(parseMessage({text: 'life is long'}).kind, 'daily');
  assert.equal(parseMessage({text: '/help'}).kind, 'help');
  assert.equal(parseMessage({text: 'reply to a normal message', reply_to_message: {from: {is_bot: false}, text: 'x'}}).kind, 'daily');
});

const item = {platform: 'xiaohongshu', externalId: 'abc', url: 'https://www.xiaohongshu.com/explore/abc', title: 'AI 算力 | 三个误区',
  author: '某人', parts: [{label: 'Post', author: '某人', text: '正文'}], images: [{file: '01.jpg', text: '图中文字'}],
  transcripts: [{label: 'Video', segments: [{start: 0, text: '你好'}, {start: 3660, text: '再见'}]}]};
const meta = {id: '2026-10-11-xiaohongshu-abc', captured: '2026-10-11T17:30', topics: ['investing']};

test('source.md rendering', () => {
  const md = v.renderSource(item, meta);
  assert.match(md, /^---\nid: 2026-10-11-xiaohongshu-abc\nurl: "https:\/\/www\.xiaohongshu\.com\/explore\/abc"\n/);
  assert.match(md, /^title: "AI 算力 \| 三个误区"$/m);
  assert.doesNotMatch(md, /^(inbox|outcome):/m);
  assert.match(md, /## Content\n\n正文/);
  assert.match(md, /## Images\n\n### Image 1\n\n!\[\[images\/01\.jpg\]\]\n\n## Transcription/);  // kept images carry no text
  assert.match(md, /## Transcription\n\n你好再见\n/);
  assert.equal(v.joinSegments(['所以我们', '继续。', 'And then we', 'moved on', '然后']), '所以我们继续。 And then we moved on 然后');
  const two = v.renderSource({...item, parts: [{label: 'Post', author: '@a', text: 'p'}, {label: 'Quoted post', author: '@b', text: 'q'}]}, meta);
  assert.match(two, /## Content\n\n### Post · @a\n\np\n\n### Quoted post · @b\n\nq/);
  assert.doesNotMatch(md, /\[Original\]/);
  assert.match(v.renderSource({...item, published: '2026-10-09T10:01'}, meta), /^published: 2026-10-09T10:01$/m);
});

test('text-in-image posts keep only the text', () => {
  const md = v.renderSource({...item, images: [], imageText: '第一段\n\n#第二段', imageCount: 2}, meta);
  assert.match(md, /## Image text\n\n第一段\n\n\\#第二段/);
  assert.doesNotMatch(md, /## Images/);
});

test('GPT-6-Luna decides between text post and illustrative', async t => {
  const dir = path.join(tmp, 'vision');
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, '01.jpg'), 'a');
  await writeFile(path.join(dir, '02.jpg'), 'b');
  const answer = body => t.mock.method(globalThis, 'fetch', async (url, req) => {
    const sent = JSON.parse(req.body);
    assert.equal(sent.model, 'gpt-6-luna');
    assert.equal(sent.messages[0].content.filter(c => c.type === 'image_url').length, 2);
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(body)}}]}));
  });

  answer({post_type: 'illustrative', text: '', images: [{keep: true}, {keep: false}]});
  const pic = {title: 't', parts: [], images: [{file: '01.jpg'}, {file: '02.jpg'}]};
  await readItemImages(pic, dir);
  assert.deepEqual(pic.images, [{file: '01.jpg'}]);  // the cover-like image is dropped, its file deleted
  assert.equal(existsSync(path.join(dir, '02.jpg')), false);
  await writeFile(path.join(dir, '02.jpg'), 'b');

  t.mock.restoreAll();
  answer({post_type: 'text_in_images', text: 'A continues across 2 images', images: []});
  const txt = {title: 't', parts: [], images: [{file: '01.jpg'}, {file: '02.jpg'}]};
  await readItemImages(txt, dir);
  assert.equal(txt.imageText, 'A continues across 2 images');
  assert.equal(txt.images.length, 0);

  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({error: {message: 'quota'}}), {status: 429}));
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, '01.jpg'), 'a');
  await assert.rejects(readItemImages({parts: [], images: [{file: '01.jpg'}]}, dir), /OpenAI 429\): quota/);
});

test('captured hashtags never become Obsidian tags', () => {
  assert.equal(v.noTags('#AI is big #大模型\n# heading kept\nissue#3 ok'), '\\#AI is big \\#大模型\n# heading kept\nissue#3 ok');
  const md = v.renderSource({...item, hashtags: ['marketing', '品牌出海']}, meta);
  assert.match(md, /^Tags: marketing, 品牌出海$/m);
  assert.doesNotMatch(md, /^hashtags:/m);
});

test('inbox line: platform · author · title', () => {
  assert.equal(v.inboxLine(meta, item), '- [ ] xiaohongshu · 某人 · [[raw/2026-10-11-xiaohongshu-abc/source|AI 算力 三个误区]] · topics: investing\n');
  const untitled = {platform: 'x', externalId: '9', title: '', parts: [{text: 'https://t.co/x  国内做出海的创业者真得学学 @boardyai 什么叫 AI Native 体验。就你们现在做的都是啥呀'}], images: [], transcripts: []};
  assert.equal(v.fallbackTitle(untitled), '国内做出海的创业者真得学学 @boardyai 什么叫 AI Native 体验…');
  assert.equal(v.fallbackTitle({...untitled, parts: []}), 'X 9');
});

test('publish, dedupe, notes', async () => {
  const imgs = path.join(tmp, 'work-images');
  await mkdir(imgs, {recursive: true});
  await writeFile(path.join(imgs, '01.jpg'), 'x');
  await v.publishRaw(meta.id, v.renderSource(item, meta), imgs);
  assert.equal(await v.findRaw('abc'), meta.id);
  assert.equal(await v.findRaw('zzz'), null);
  assert.equal(await readFile(path.join(tmp, 'raw', meta.id, 'images', '01.jpg'), 'utf8'), 'x');

  await v.appendNote(meta.id, 'first line\nsecond');
  await v.appendNote(meta.id, 'again');
  const note = await readFile(path.join(tmp, 'notes', `${meta.id}.md`), 'utf8');
  assert.match(note, /^---\nsource: "\[\[raw\/2026-10-11-xiaohongshu-abc\/source\]\]"\ntitle: "AI 算力 \| 三个误区"\ntopics: \[investing\]\n---\n\n- first line\n  second\n- again\n$/);

  await v.appendDaily('thought', '2026-10-11');
  assert.equal(await readFile(path.join(tmp, 'notes', 'daily', '2026-10-11.md'), 'utf8'), '---\ndate: 2026-10-11\n---\n\n- thought\n');

  const src = (id, at) => { const d = path.join(tmp, 'raw', id); return mkdir(d, {recursive: true}).then(() => writeFile(path.join(d, 'source.md'), `---\nid: ${id}\ncaptured: ${at}\n---\n`)); };
  await src('a', '2026-10-01T09:00'); await src('b', '2026-10-02T09:00'); await src('c', '2026-10-03T09:00');
  const line = (id, done = ' ') => `- [${done}] X · [[raw/${id}/source|${id}]]`;
  await writeFile(path.join(tmp, 'inbox.md'), '# Inbox\n\n');
  await v.addToInbox(line('a') + '\n');
  await v.addToInbox(line('c') + '\n');
  await v.addToInbox(line('b') + '\n');
  const read = () => readFile(path.join(tmp, 'inbox.md'), 'utf8');
  assert.equal(await read(), `# Inbox\n\n${line('c')}\n${line('b')}\n${line('a')}\n`);
  // Labels follow source routing, including Obsidian lists and removing all topics.
  const bSource = path.join(tmp, 'raw', 'b', 'source.md');
  const original = await readFile(bSource, 'utf8');
  await writeFile(bSource, original.replace('id: b', 'id: b\ntopics: [investing, product]'));
  await v.sortInbox();
  assert.ok((await read()).includes(line('b') + ' · topics: investing, product\n'));
  assert.equal(await v.sortInbox(), false);
  await writeFile(bSource, original.replace('id: b', 'id: b\ntopics:\n  - product'));
  await v.sortInbox();
  assert.ok((await read()).includes(line('b') + ' · topics: product\n'));
  await writeFile(bSource, original.replace('id: b', 'id: b\ntopics: []'));
  await v.sortInbox();
  assert.equal(await read(), `# Inbox\n\n${line('c')}\n${line('b')}\n${line('a')}\n`);
  // tick c: it moves below the unchecked ones; untick it: back to its captured-time place
  await writeFile(path.join(tmp, 'inbox.md'), (await read()).replace('- [ ] X · [[raw/c', '- [x] X · [[raw/c'));
  assert.equal(await v.sortInbox(), true);
  assert.equal(await read(), `# Inbox\n\n${line('b')}\n${line('a')}\n${line('c', 'x')}\n`);
  assert.equal(await v.sortInbox(), false);
  await writeFile(path.join(tmp, 'inbox.md'), (await read()).replace('- [x] X · [[raw/c', '- [ ] X · [[raw/c'));
  await v.sortInbox();
  assert.equal(await read(), `# Inbox\n\n${line('c')}\n${line('b')}\n${line('a')}\n`);
  // a checked item is deleted once its capture time is 30+ days ago; unchecked ones stay
  await writeFile(path.join(tmp, 'inbox.md'), (await read()).replace('- [ ] X · [[raw/a', '- [x] X · [[raw/a'));
  await v.sortInbox(new Date('2026-10-30T12:00'));
  assert.match(await read(), /raw\/a\//);
  await v.sortInbox(new Date('2026-10-31T09:00'));
  assert.doesNotMatch(await read(), /raw\/a\//);
  assert.match(await read(), /raw\/b\//);
  // delete: inbox line and raw folder go
  await v.deleteItem('b');
  assert.doesNotMatch(await read(), /raw\/b\//);
  assert.equal(await v.findRaw('b'), null);
  await assert.rejects(v.deleteItem('../notes'), /No capture/);
});

test('manual topic routing is read from frontmatter and diffed per topic', async () => {
  assert.deepEqual(parseTopics('---\nid: x\ntopics: [product, investing]\ninbox: true\n---\nbody topics: [no]'), ['product', 'investing']);
  assert.deepEqual(parseTopics('---\ntopics:\n  - product\n  - "jazz"\ninbox: true\n---\n'), ['product', 'jazz']);
  assert.deepEqual(parseTopics('---\ntopics: []\n---\n'), []);
  assert.deepEqual(parseTopics('---\ntopics:\ninbox: true\n---\n'), []);

  await mkdir(path.join(tmp, 'raw', 'r2'), {recursive: true});
  await writeFile(path.join(tmp, 'raw', 'r2', 'source.md'), '---\ntopics:\n  - jazz\n---\n');
  await writeFile(path.join(tmp, 'notes', 'idea.md'), '---\ntopics: [jazz, product]\n---\n- mine\n');
  const now = await topicMembers();
  assert.deepEqual(now.jazz, ['notes/idea.md', 'raw/r2/source.md']);
  assert.deepEqual(now.investing, ['notes/2026-10-11-xiaohongshu-abc.md', `raw/${meta.id}/source.md`]);

  assert.deepEqual(diffTopics({jazz: ['raw/r2/source.md', 'raw/gone/source.md'], product: ['notes/idea.md']}, {jazz: now.jazz, product: ['notes/idea.md']}),
    {jazz: {added: ['notes/idea.md'], removed: ['raw/gone/source.md']}});
});
