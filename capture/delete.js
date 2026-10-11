// Delete captures: node capture/delete.js <id or link>...
// Removes each item's inbox line and its raw/<id>/ folder. Raw files are not in git, so this is permanent.
import {normalizeLink} from './lib/links.js';
import {deleteItem, findRaw} from './lib/vault.js';

if (!process.argv[2]) {
  console.error('usage: node capture/delete.js <id or link>...');
  process.exit(2);
}
let failed = 0;
for (const arg of process.argv.slice(2)) {
  try {
    const id = /^https?:/.test(arg) ? await findRaw(normalizeLink(arg).externalId) : arg;
    if (!id) throw Error('not captured (short links: use the id)');
    await deleteItem(id);
    console.log('deleted', id);
  } catch (e) {
    failed++;
    console.error('failed ', arg, '·', e.message);
  }
}
process.exit(failed ? 1 : 0);
