// Rewrite absolute skyscanner.ca / help.skyscanner.net URLs in cloned HTML
// files into local server-absolute paths so internal navigation stays inside
// the local clone. Idempotent.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(process.argv[2] || path.resolve(__dirname, '..', 'goClone', 'www.skyscanner.ca'));

const REWRITES = [
  [/https?:\/\/www\.skyscanner\.ca(?=[\/"'?#)\s]|$)/g, ''],
  [/https?:\/\/help\.skyscanner\.net(?=[\/"'?#)\s]|$)/g,        '/_ext/help.skyscanner.net'],
  [/https?:\/\/hotelshelp\.skyscanner\.net(?=[\/"'?#)\s]|$)/g,  '/_ext/help.skyscanner.net'],
  [/https?:\/\/carhirehelp\.skyscanner\.net(?=[\/"'?#)\s]|$)/g, '/_ext/help.skyscanner.net'],
];

let filesChanged = 0, occChanged = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.(html?|htm)$/i.test(name)) {
      const before = fs.readFileSync(full, 'utf8');
      let after = before;
      for (const [re, rep] of REWRITES) after = after.replace(re, () => { occChanged++; return rep; });
      if (after !== before) { fs.writeFileSync(full, after); filesChanged++; }
    }
  }
}
walk(OUT_DIR);
console.log(`[fix-links] files changed: ${filesChanged}`);
console.log(`[fix-links] URL occurrences rewritten: ${occChanged}`);
