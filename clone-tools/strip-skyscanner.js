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
  // Ad-tech scripts and frames — these fail CSP at runtime and contribute
  // zero functional value. Strip from the captured HTML before serving.
  /<script[^>]*src=["'][^"']*googletagmanager\.com[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*js-agent\.newrelic\.com[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*bam\.nr-data\.net[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*gum\.criteo\.com[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*onetrust[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*siteintercept\.qualtrics[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*static\.adsafeprotected[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*sslwidget\.criteo[^"']*["'][^>]*>\s*<\/script>/gi,
  /<iframe[^>]*src=["'][^"']*gum\.criteo\.com[^"']*["'][^>]*>\s*<\/iframe>/gi,
  /<iframe[^>]*src=["'][^"']*js\.px-cloud\.net[^"']*["'][^>]*>\s*<\/iframe>/gi,
  /<iframe[^>]*src=["'][^"']*criteo-partners[^"']*["'][^>]*>\s*<\/iframe>/gi,
  /<iframe[^>]*src=["'][^"']*doubleclick\.net[^"']*["'][^>]*>\s*<\/iframe>/gi,
  /<img[^>]*src=["'][^"']*\/g\/aps\/public\/api\/v1\/pixel\/view[^"']*["'][^>]*>/gi,
  // The captured /g/tagging/gtag/js endpoint returns JSON, not JS — strip the
  // <script> that tries to execute it as JS.
  /<script[^>]*src=["'][^"']*\/g\/tagging\/gtag\/js[^"']*["'][^>]*>\s*<\/script>/gi,
  /<script[^>]*src=["'][^"']*\/g\/tagging\/gtm[^"']*["'][^>]*>\s*<\/script>/gi,
  /<meta\s+name="y_key"[^>]*>\s*/gi,
  /<meta\s+name="yandex-verification"[^>]*>\s*/gi,
  /<meta\s+name="naver-site-verification"[^>]*>\s*/gi,
  /<meta\s+name="apple-itunes-app"[^>]*>\s*/gi,
  /<meta\s+name="google-site-verification"[^>]*>\s*/gi,
  /<meta\s+name="msvalidate\.01"[^>]*>\s*/gi,
  // Pre-connect / dns-prefetch hints to external telemetry / ads.
  /<link\s+rel="(?:preconnect|dns-prefetch)"\s+href="[^"]*(?:googletagmanager|bam\.nr-data|gum\.criteo|criteo|js-agent\.newrelic|siteintercept\.qualtrics|sslwidget|google-analytics|googleadservices|doubleclick)[^"]*"[^>]*>\s*/gi,
  // Pre-connect / dns-prefetch to Skyscanner CDNs (we serve those locally via /_ext/).
  /<link\s+rel="(?:preconnect|dns-prefetch)"\s+href="https?:\/\/(?:js|css|content|images|logos|hotelscdn|help)\.skyscnr\.com[^"]*"[^>]*>\s*/gi,
  /<link\s+rel="(?:preconnect|dns-prefetch)"\s+href="https?:\/\/(?:[a-z0-9.-]+\.)?skyscanner\.[a-z.]+[^"]*"[^>]*>\s*/gi,
  // hreflang alternates that link to other Skyscanner regional sites — leak our origin.
  /<link\s+rel="alternate"\s+href="https?:\/\/(?:[a-z0-9.-]+\.)?(?:skyscanner|tianxun)\.[a-z.]+\/[^"]*"\s+hreflang="[^"]*"\s*\/?>/gi,
  // Canonical pointing at skyscanner.* — strip; we'll let our own host be canonical.
  /<link\s+rel="canonical"\s+href="https?:\/\/(?:[a-z0-9.-]+\.)?skyscanner\.[a-z.]+[^"]*"[^>]*>\s*/gi,
  // og:url to skyscanner.*
  /<meta\s+property="og:url"\s+content="https?:\/\/(?:[a-z0-9.-]+\.)?skyscanner\.[a-z.]+[^"]*"\s*\/?>/gi,
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

// Tiny ad-tech blocker + runtime URL rewriter injected at the TOP of every
// <head> so it runs before any async/inline script (including the captured
// criteo/perimeter loaders and React-chunk lazy loaders).
// - BLOCK regex: silently dropped (no CSP error, no network request).
// - REWRITE regex: protocol-relative / absolute skyscnr CDN URLs are remapped
//   to local /_ext/<host>/... so they hit our mirror instead of the network.
const BLOCKER_INLINE = `<script>(function(){
var B=/googletagmanager\\.com|js-agent\\.newrelic|bam\\.nr-data|gum\\.criteo|sslwidget\\.criteo|js\\.px-cloud|criteo-partners|doubleclick\\.net|adsafeprotected|onetrust|qualtrics|hotjar|tealiumiq|adservice|adsystem|skyscanner-cdn\\.relevant-digital|\\/g\\/aps\\/public\\/api\\/v1\\/pixel|\\/g\\/tagging\\/gtag\\/js|\\/g\\/tagging\\/gtm/i;
var CDN_HOSTS=['js.skyscnr.com','css.skyscnr.com','content.skyscnr.com','images.skyscnr.com','logos.skyscnr.com','hotelscdn.skyscnr.com','help.skyscanner.net'];
function rewrite(u){
  if(typeof u!=='string') return u;
  for(var i=0;i<CDN_HOSTS.length;i++){
    var h=CDN_HOSTS[i];
    if(u.indexOf('/_ext/'+h)>=0) continue;
    var rxAbs=new RegExp('^https?:\\\\/\\\\/'+h.replace(/\\./g,'\\\\.'),'i');
    if(rxAbs.test(u)) return u.replace(rxAbs,'/_ext/'+h);
    var rxProto=new RegExp('^\\\\/\\\\/'+h.replace(/\\./g,'\\\\.'),'i');
    if(rxProto.test(u)) return u.replace(rxProto,'/_ext/'+h);
  }
  return u;
}
function P(p){
  try{var d=Object.getOwnPropertyDescriptor(p,'src');if(!d||!d.set)return;
  Object.defineProperty(p,'src',{configurable:true,enumerable:d.enumerable,
    get:function(){return d.get.call(this)},
    set:function(v){if(typeof v==='string'&&B.test(v))return;return d.set.call(this,rewrite(v))}});}catch(e){}
}
P(HTMLScriptElement.prototype);P(HTMLIFrameElement.prototype);P(HTMLImageElement.prototype);
var oSet=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){
  if((n==='src'||n==='href')&&typeof v==='string'){
    if(B.test(v))return;
    v=rewrite(v);
    arguments[1]=v;
  }
  return oSet.apply(this,arguments);
};
var oF=window.fetch&&window.fetch.bind(window);
if(oF){window.fetch=function(i,o){
  var u=typeof i==='string'?i:(i&&i.url)||'';
  if(B.test(u))return Promise.resolve(new Response('',{status:204}));
  if(typeof i==='string') i=rewrite(i);
  return oF(i,o);
};}
var oOpen=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){
  if(typeof u==='string'){
    if(B.test(u))arguments[1]='/_ad_blocked';
    else arguments[1]=rewrite(u);
  }
  return oOpen.apply(this,arguments);
};
})();</script>`;

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
  // Inject (or replace) the blocker as the first thing inside <head>.
  if (/<head[^>]*>/i.test(html)) {
    // Remove existing copy first.
    html = html.replace(/<script id="skybox-blocker-inline">[\s\S]*?<\/script>/g, '');
    const inner = BLOCKER_INLINE.replace(/^<script>|<\/script>$/g, '');
    html = html.replace(/<head([^>]*)>/i, '<head$1><script id="skybox-blocker-inline">' + inner + '</script>');
  }
  if (html !== before) { fs.writeFileSync(file, html); filesChanged++; }
}

walk(OUT_DIR);

// Wipe Skyscanner's third-party tracking IDs from every text file. These
// are baked into the captured JS bundles / inline init scripts and would
// otherwise send your traffic to their analytics accounts.
const TRACKER_PATTERNS = [
  // New Relic init block.
  /;?\s*window\.NREUM\|\|\(NREUM=\{\}\);?\s*NREUM\.init=\{[\s\S]*?\};?\s*NREUM\.loader_config=\{[\s\S]*?\};?\s*NREUM\.info=\{[\s\S]*?\};?/g,
  // Bare NREUM key/value occurrences.
  /licenseKey\s*:\s*["']NRJS-[A-Za-z0-9]+["']/g,
  /accountID\s*:\s*["']3117610["']/g,
  /trustKey\s*:\s*["']3117593["']/g,
  /agentID\s*:\s*["']473224290["']/g,
  /applicationID\s*:\s*["']473224290["']/g,
  // GTM container id.
  /GTM-W8ZST32/g,
  /UA-\d{5,}-\d+/g,
  /G-XEEM7L2YCB/g,
  // PerimeterX captcha endpoint hint.
  /NRJS-8ee30fb60b5d38aac95/g,
];
let trackersWiped = 0;
function walkAll(dir, fn) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walkAll(full, fn);
    else fn(full);
  }
}
walkAll(OUT_DIR, (file) => {
  if (!/\.(html?|js|mjs|json|css|txt|xml|svg)$/i.test(file)) return;
  let s; try { s = fs.readFileSync(file, 'utf8'); } catch { return; }
  const before = s;
  for (const re of TRACKER_PATTERNS) s = s.replace(re, () => { trackersWiped++; return ''; });
  if (s !== before) fs.writeFileSync(file, s);
});
console.log(`[strip-skyscanner] tracking ID occurrences wiped: ${trackersWiped}`);

// Rewrite any remaining outbound URLs to Skyscanner CDNs into local /_ext/ paths
// so the browser never reaches out to skyscanner.* / skyscnr.com.
// Hosts we mirror under /_ext/<host>/...:
const CDN_HOSTS = ['js.skyscnr.com', 'css.skyscnr.com', 'content.skyscnr.com', 'images.skyscnr.com', 'logos.skyscnr.com', 'hotelscdn.skyscnr.com', 'help.skyscanner.net'];
let outboundRewrites = 0, outboundStripped = 0;
function rewriteOutbound(s) {
  // 1. https://<known-cdn>/<path>  ->  /_ext/<host>/<path>
  //    AND protocol-relative //<known-cdn>/<path> (JS string literals)
  //    AND JSON-escaped //<host> or \/\/<host>
  for (const host of CDN_HOSTS) {
    const hostEsc = host.replace(/\./g, '\\.');
    const reAbs = new RegExp('https?:\\/\\/' + hostEsc + '(?![a-zA-Z0-9.-])', 'g');
    s = s.replace(reAbs, () => { outboundRewrites++; return '/_ext/' + host; });
    const reProto = new RegExp('\\/\\/' + hostEsc + '(?![a-zA-Z0-9.-])', 'g');
    s = s.replace(reProto, () => { outboundRewrites++; return '/_ext/' + host; });
    // //<host> -> /_ext/<host>
    const reUni = new RegExp('\\\\u002F\\\\u002F' + hostEsc, 'g');
    s = s.replace(reUni, () => { outboundRewrites++; return '\\u002F_ext\\u002F' + host; });
    // \/\/<host> -> \/_ext\/<host>
    const reJson = new RegExp('\\\\\\/\\\\\\/' + hostEsc, 'g');
    s = s.replace(reJson, () => { outboundRewrites++; return '\\/_ext\\/' + host; });
  }
  // 1b. Any other host with "skyscanner" in the name (e.g. skyscanner-cdn.relevant-digital.com)
  // gets routed through our local /_ext/<host>/ stub.
  s = s.replace(/https?:\/\/([a-z0-9.-]*skyscanner[a-z0-9.-]*)(?=[\/"'\s])/gi, (m, host) => {
    outboundRewrites++; return '/_ext/' + host.toLowerCase();
  });
  // 2. Anchor hrefs / src to skyscanner.* (regional homepages, /book/, /book-with/) -> '/'
  s = s.replace(/href="https?:\/\/(?:[a-z0-9.-]+\.)?skyscanner\.[a-z.]+(?:\/[^"]*)?"/gi, () => { outboundStripped++; return 'href="/"'; });
  s = s.replace(/href="https?:\/\/(?:[a-z0-9.-]+\.)?tianxun\.com(?:\/[^"]*)?"/gi, () => { outboundStripped++; return 'href="/"'; });
  // 3. Any remaining skyscanner.* / tianxun.com URL in JSON / JS strings -> our APP_URL host.
  const APP_HOST = (process.env.APP_URL || 'http://localhost:8088').replace(/\/$/, '');
  s = s.replace(/https?:\/\/(?:[a-z0-9.-]+\.)?skyscanner\.[a-z.]+/gi, () => { outboundStripped++; return APP_HOST; });
  s = s.replace(/https?:\/\/(?:[a-z0-9.-]+\.)?tianxun\.com/gi, () => { outboundStripped++; return APP_HOST; });
  return s;
}
walkAll(OUT_DIR, (file) => {
  if (!/\.(html?|js|mjs|json|css|xml|svg|txt)$/i.test(file)) return;
  // Don't touch our own custom Skybox files (they don't contain Skyscanner URLs anyway).
  if (/skybox-(app|home|icon|og|trip|trips|offer|flights-search|confirmation)/i.test(file)) return;
  let s; try { s = fs.readFileSync(file, 'utf8'); } catch { return; }
  const before = s;
  s = rewriteOutbound(s);
  if (s !== before) fs.writeFileSync(file, s);
});
console.log(`[strip-skyscanner] outbound CDN URLs rewritten to /_ext/: ${outboundRewrites}`);
console.log(`[strip-skyscanner] other skyscanner.* URLs stripped/rewritten: ${outboundStripped}`);

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
