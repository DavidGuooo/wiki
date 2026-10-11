// Telegram message grammar (pure, tested):
//   <link>                    → capture to raw/ + inbox.md
//   photo (album) [caption]   → screenshot item (text read by GPT-6-Luna) + inbox.md
//   reply to ✅ with text      → add to that item's note
//   reply to ⚠️ with text/photo → save the failed link from what you supply
//   any other text            → today's daily note
import {extractLinks} from './links.js';

export const HELP = `Send a link to save it to your inbox (X, xiaohongshu, YouTube, web pages).
• Send screenshots to save them as an item (their text is read).
• Reply to a ✅ message to add a note to that item.
• Reply to a ⚠️ message with text or screenshots to save it anyway.
• Any other text goes to today's daily note.`;

export function parseMessage(msg) {
  const text = (msg.text || msg.caption || '').trim();
  const photo = msg.photo?.at(-1) || (msg.document?.mime_type?.startsWith('image/') ? msg.document : null);
  const reply = msg.reply_to_message;

  if (reply?.from?.is_bot) {
    const said = reply.text || '';
    const url = extractLinks(said)[0];
    if (said.startsWith('⚠️') && url) return {kind: 'recover', url, text, photo};
    const id = said.match(/🗂 (\S+)/)?.[1];
    if (id && text) return {kind: 'note', id, text};
  }
  if (/^\/(start|help)\b/.test(text)) return {kind: 'help'};

  const body = text;
  const links = extractLinks(body);
  if (links.length) return {kind: 'capture', links};
  if (photo) return {kind: 'screenshot', photo, group: msg.media_group_id, caption: body};
  if (text && !text.startsWith('/')) return {kind: 'daily', text};
  return {kind: 'help'};
}
