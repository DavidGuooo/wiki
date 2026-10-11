// Capture from the command line: node capture/add.js <link>...
import {parseArgs} from 'node:util';
import {capture} from './lib/capture.js';

const {positionals} = parseArgs({allowPositionals: true});
if (!positionals.length) {
  console.error('usage: node capture/add.js <link>...');
  process.exit(2);
}
let failed = 0;
for (const url of positionals) {
  try {
    const r = await capture(url, {progress: m => console.log(m)});
    console.log(r.existed ? 'exists ' : 'saved  ', r.id, '·', r.title);
  } catch (e) {
    failed++;
    console.error('failed ', url, '·', e.message);
  }
}
process.exit(failed ? 1 : 0);
