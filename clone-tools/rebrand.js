// Rebrand "Skyscanner" -> "Skybox Global" in cloned text content.
// Skips the font name "Skyscanner Relative" so type loading still works.
// Also injects a CSS patch that hides the inline-SVG wordmark and renders
// "Skybox Global" via ::after on the logo containers. Idempotent.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(process.argv[2] || path.resolve(__dirname, '..', 'goClone', 'www.skyscanner.ca'));

const REWRITES = [
  [/\bSkyscanner\b(?! Relative)/g, 'Skybox Global'],
  [/\bSKYSCANNER\b(?! RELATIVE)/g, 'SKYBOX GLOBAL'],
];
const TEXT_EXTS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt']);

let filesChanged = 0, totalReplacements = 0;
function walk(dir, fn) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, fn);
    else fn(full);
  }
}
walk(OUT_DIR, (file) => {
  if (!TEXT_EXTS.has(path.extname(file).toLowerCase())) return;
  let content;
  try { content = fs.readFileSync(file, 'utf8'); } catch { return; }
  const before = content;
  let local = 0;
  for (const [re, rep] of REWRITES) content = content.replace(re, () => { local++; return rep; });
  if (content !== before) { fs.writeFileSync(file, content); filesChanged++; totalReplacements += local; }
});
console.log(`[rebrand] files changed: ${filesChanged}`);
console.log(`[rebrand] occurrences rewritten: ${totalReplacements}`);

// Logo patch.
const MARKER = '<!-- skybox-logo-patch -->';
const PATCH = MARKER + `
<style>
svg[class*="bpk-logo_bpk-logo"] { display: none !important; }
#header-logo-link,
a[aria-label="Skybox Global home"],
[class*="Header__logo-wrapper"] > a,
[class*="_Logo_"] {
  display: inline-flex !important;
  align-items: center !important;
  gap: 8px !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  text-indent: 0 !important;
  background: none !important;
  font-family: "Skyscanner Relative", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
  font-weight: 900 !important;
  font-size: 22px !important;
  color: #ffffff !important;
  text-decoration: none !important;
  line-height: 1 !important;
  white-space: nowrap !important;
  overflow: visible !important;
}
#header-logo-link::after,
a[aria-label="Skybox Global home"]::after,
[class*="Header__logo-wrapper"] > a::after,
[class*="_Logo_"]::after {
  content: "Skybox Global";
  letter-spacing: -0.5px;
}
#header-logo-link::before,
a[aria-label="Skybox Global home"]::before,
[class*="Header__logo-wrapper"] > a::before,
[class*="_Logo_"]::before {
  content: "";
  display: inline-block;
  width: 22px;
  height: 22px;
  background: currentColor;
  -webkit-mask: radial-gradient(circle at 50% 100%, #000 9px, transparent 10px) no-repeat,
                conic-gradient(from 200deg at 50% 100%, #000 0 140deg, transparent 0) no-repeat;
          mask: radial-gradient(circle at 50% 100%, #000 9px, transparent 10px) no-repeat,
                conic-gradient(from 200deg at 50% 100%, #000 0 140deg, transparent 0) no-repeat;
}
/* Section nav demote + pointer-events restore. */
[class*="HorizontalNavigation_HorizontalNavigation__container__"] {
  position: sticky !important; top: 0 !important; z-index: 50 !important;
}
[class*="HorizontalNavigation_HorizontalNavigation__height_holder__"] { display: none !important; }
button:not([aria-disabled="true"]):not(:disabled),
[role="button"]:not([aria-disabled="true"]),
a[href] { pointer-events: auto !important; }
</style>
`;

let patched = 0;
walk(OUT_DIR, (file) => {
  if (!/\.html?$/i.test(file)) return;
  let html = fs.readFileSync(file, 'utf8');
  if (!html.includes('bpk-logo_bpk-logo')) return;
  if (html.includes(MARKER)) {
    const re = new RegExp(MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '[\\s\\S]*?<\\/style>\\s*', 'g');
    html = html.replace(re, '');
  }
  const idx = html.indexOf('</head>');
  if (idx < 0) return;
  html = html.slice(0, idx) + PATCH + html.slice(idx);
  // Inject the Skybox client shim.
  const SHIM = '<script src="/skybox-app.js" defer></script>';
  if (!html.includes('/skybox-app.js')) {
    const be = html.lastIndexOf('</body>');
    if (be >= 0) html = html.slice(0, be) + SHIM + html.slice(be);
    else html += SHIM;
  }
  fs.writeFileSync(file, html);
  patched++;
});
console.log(`[rebrand] HTML files patched with logo CSS + shim: ${patched}`);
