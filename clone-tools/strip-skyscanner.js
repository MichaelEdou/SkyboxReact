// Strip Skyscanner-specific identity from cloned HTML.
// Removes verification meta tags (yandex/naver/y_key), Skyscanner-branded
// og:image, manifest pointers to skyscanner files, and external pre-connect
// hints to telemetry/ad endpoints. We KEEP /_ext/ paths because those are
// our local mirror of captured assets.

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(process.argv[2] || path.resolve(__dirname, '..', 'goClone', 'www.skyscanner.ca'));

// Regexes (each anchored to a meta/link tag to avoid touching unrelated text).
const STRIPS = [
  /<meta\s+name="y_key"[^>]*>\s*/gi,
  /<meta\s+name="yandex-verification"[^>]*>\s*/gi,
  /<meta\s+name="naver-site-verification"[^>]*>\s*/gi,
  /<meta\s+name="apple-itunes-app"[^>]*>\s*/gi,
  /<meta\s+name="google-site-verification"[^>]*>\s*/gi,
  /<meta\s+name="msvalidate\.01"[^>]*>\s*/gi,
  // Pre-connect / dns-prefetch hints to external telemetry / ads.
  /<link\s+rel="(?:preconnect|dns-prefetch)"\s+href="[^"]*(?:googletagmanager|bam\.nr-data|gum\.criteo|criteo|js-agent\.newrelic|siteintercept\.qualtrics|sslwidget|google-analytics|googleadservices|doubleclick)[^"]*"[^>]*>\s*/gi,
];

// Replacements (preserve the tag, swap the Skyscanner-branded value).
const REPLACE = [
  // og:image -> generic Skybox sun mark inlined as data URI.
  [/<meta\s+property="og:image"\s+content="[^"]+"\s*\/?>/i, '<meta property="og:image" content="/skybox-og.svg" />'],
  // Apple touch icon / favicons that point at skyscanner branded assets -> our local icon.
  [/<link\s+rel="apple-touch-icon"[^>]*>/gi, '<link rel="apple-touch-icon" href="/skybox-icon.svg" />'],
  [/<link\s+rel="icon"[^>]*>/gi, '<link rel="icon" href="/skybox-icon.svg" type="image/svg+xml" />'],
  [/<link\s+rel="shortcut icon"[^>]*>/gi, ''],
];

let filesChanged = 0, totalStripped = 0;

function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full);
    else if (/\.html?$/i.test(name)) processFile(full);
  }
}
function processFile(file) {
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  for (const re of STRIPS) html = html.replace(re, () => { totalStripped++; return ''; });
  for (const [re, rep] of REPLACE) html = html.replace(re, rep);
  if (html !== before) { fs.writeFileSync(file, html); filesChanged++; }
}

walk(OUT_DIR);

// Drop in a neutral Skybox icon + og image (single sun-mark SVG).
const ICON_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#05203c"/>
  <path d="M32 18a14 14 0 0 1 14 14H18a14 14 0 0 1 14-14z" fill="#fff"/>
  <circle cx="32" cy="34" r="6" fill="#05203c"/>
</svg>`;
fs.writeFileSync(path.join(OUT_DIR, 'skybox-icon.svg'), ICON_SVG);

const OG_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#05203c"/>
  <g transform="translate(420 230)">
    <rect width="80" height="80" rx="12" fill="#fff"/>
    <path d="M40 26a26 26 0 0 1 26 26H14a26 26 0 0 1 26-26z" fill="#05203c"/>
    <circle cx="40" cy="56" r="10" fill="#fff"/>
  </g>
  <text x="535" y="320" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="72" font-weight="900" fill="#fff">Skybox Global</text>
  <text x="535" y="370" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="28" fill="#a8c9ed">Search every flight in one place.</text>
</svg>`;
fs.writeFileSync(path.join(OUT_DIR, 'skybox-og.svg'), OG_SVG);

// Minimal web-app manifest in our brand colors.
fs.writeFileSync(path.join(OUT_DIR, 'android-chrome-manifest.json'), JSON.stringify({
  name: 'Skybox Global',
  short_name: 'Skybox Global',
  start_url: '/',
  display: 'standalone',
  background_color: '#05203c',
  theme_color: '#05203c',
  icons: [{ src: '/skybox-icon.svg', sizes: 'any', type: 'image/svg+xml' }],
}, null, 2));

console.log(`[strip-skyscanner] HTML files changed: ${filesChanged}`);
console.log(`[strip-skyscanner] tags stripped: ${totalStripped}`);
console.log(`[strip-skyscanner] wrote skybox-icon.svg, skybox-og.svg, android-chrome-manifest.json`);
