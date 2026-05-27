// Playwright-based "exact clone" recorder, multi-page edition.
// Opens each URL in a single real Chromium session, captures every response
// (cross-origin included), saves the rendered HTML for each page at its own
// path, and rewrites absolute URLs to local relative/absolute paths.
//
// Usage:
//   node clone.js <outDir> <waitMs> <url1> [<url2> ...]

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const argv = process.argv.slice(2);
if (argv.length < 3) {
  console.error('usage: node clone.js <outDir> <waitMs> <url1> [<url2> ...]');
  process.exit(1);
}
const OUT_DIR = path.resolve(argv[0]);
const WAIT_MS = parseInt(argv[1], 10) || 12000;
const URLS = argv.slice(2);
const PRIMARY_HOST = new URL(URLS[0]).host;

function ensureDirFor(filePath) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); }
function hashQuery(s) { return crypto.createHash('md5').update(s).digest('hex').slice(0, 8); }

function urlToLocalPath(urlStr) {
  let u;
  try { u = new URL(urlStr); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let p = u.pathname.replace(/[?#].*$/, '');
  if (p.endsWith('/') || p === '') p += 'index.html';
  else if (!path.extname(p)) p += '/index.html';
  if (u.search) {
    const hash = hashQuery(u.search);
    const ext = path.extname(p);
    p = ext ? p.slice(0, -ext.length) + '.' + hash + ext : p + '.' + hash;
  }
  if (u.host === PRIMARY_HOST) return p.replace(/^\//, '');
  return path.posix.join('_ext', u.host, p.replace(/^\//, ''));
}

function pageUrlToHtmlPath(urlStr) {
  const u = new URL(urlStr);
  let p = u.pathname.replace(/[?#].*$/, '');
  if (p === '' || p === '/') return u.host === PRIMARY_HOST ? 'index.html' : path.posix.join('_ext', u.host, 'index.html');
  p = p.replace(/\/$/, '');
  const filePart = p + '/index.html';
  if (u.host === PRIMARY_HOST) return filePart.replace(/^\//, '');
  return path.posix.join('_ext', u.host, filePart.replace(/^\//, ''));
}

const saved = new Map();
const skipped = [];

async function attachResponseRecorder(context) {
  context.on('response', async (resp) => {
    try {
      const req = resp.request();
      if (req.method() !== 'GET') return;
      const url = resp.url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return;
      const status = resp.status();
      if (status >= 300 && status < 400) return;
      if (status >= 400) { skipped.push([status, url]); return; }
      const local = urlToLocalPath(url);
      if (!local) return;
      if (saved.has(url)) return;
      const buf = await resp.body().catch(() => null);
      if (!buf) return;
      const full = path.join(OUT_DIR, local);
      ensureDirFor(full);
      fs.writeFileSync(full, buf);
      saved.set(url, local);
    } catch { /* ignore */ }
  });
}

async function recordPage(context, url) {
  console.log(`\n[clone] === ${url} ===`);
  let page;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => {
      console.log(`[clone]   networkidle wait failed (${e.message}); continuing`);
    });
    if (page.isClosed()) throw new Error('page closed after goto');
    await page.evaluate(async () => {
      await new Promise((res) => {
        let y = 0;
        const step = () => {
          window.scrollTo(0, y);
          y += 400;
          if (y < document.body.scrollHeight) setTimeout(step, 60);
          else res();
        };
        step();
      });
    }).catch(() => {});
    if (page.isClosed()) throw new Error('page closed after scroll');
    await page.waitForTimeout(WAIT_MS).catch(() => {});
    const htmlPath = pageUrlToHtmlPath(url);
    const finalHtml = await page.content();
    const fullHtmlPath = path.join(OUT_DIR, htmlPath);
    ensureDirFor(fullHtmlPath);
    fs.writeFileSync(fullHtmlPath, finalHtml);
    saved.set(url, htmlPath);
    console.log(`[clone]   wrote ${htmlPath} (${finalHtml.length} bytes)`);
  } finally {
    if (page && !page.isClosed()) await page.close().catch(() => {});
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[clone] outDir=${OUT_DIR}\n[clone] primaryHost=${PRIMARY_HOST}\n[clone] urls=${URLS.length}`);
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-CA',
    timezoneId: 'America/Toronto',
  });
  await attachResponseRecorder(context);
  for (const url of URLS) {
    try { await recordPage(context, url); }
    catch (e) { console.log(`[clone]   FAIL ${url}: ${e.message}`); }
  }
  await browser.close();
  console.log(`\n[clone] captured ${saved.size} files`);

  // URL rewrite pass: HTML -> absolute /paths, CSS/JS -> file-relative.
  console.log(`[clone] rewriting URLs in saved text files...`);
  const rewriteExts = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt']);
  const allFiles = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else allFiles.push(full);
    }
  })(OUT_DIR);
  const entries = [...saved.entries()].sort((a, b) => b[0].length - a[0].length);

  function localToReplacement(local, file, isHtml) {
    if (isHtml) return '/' + local.split(path.sep).join('/');
    const fileDir = path.dirname(file);
    const absTarget = path.join(OUT_DIR, local);
    let rel = path.relative(fileDir, absTarget).split(path.sep).join('/');
    if (!rel.startsWith('.') && !rel.startsWith('/')) rel = './' + rel;
    return rel;
  }

  const URL_BOUNDARY = '(?![A-Za-z0-9_./?#&%=:+-])';
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  let rewritten = 0;
  for (const file of allFiles) {
    const ext = path.extname(file).toLowerCase();
    if (!rewriteExts.has(ext)) continue;
    const isHtml = ext === '.html' || ext === '.htm';
    let content;
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    let changed = false;
    for (const [url, local] of entries) {
      if (!content.includes(url)) continue;
      const re = new RegExp(escapeRe(url) + URL_BOUNDARY, 'g');
      if (!re.test(content)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      content = content.replace(re, localToReplacement(local, file, isHtml));
      changed = true;
    }
    for (const [url, local] of entries) {
      const pr = url.replace(/^https?:/, '');
      if (!content.includes(pr)) continue;
      const re = new RegExp(escapeRe(pr) + URL_BOUNDARY, 'g');
      if (!re.test(content)) { re.lastIndex = 0; continue; }
      re.lastIndex = 0;
      content = content.replace(re, localToReplacement(local, file, isHtml));
      changed = true;
    }
    if (changed) { fs.writeFileSync(file, content); rewritten++; }
  }
  console.log(`[clone] rewrote ${rewritten} files`);
  if (skipped.length) {
    console.log(`[clone] ${skipped.length} non-2xx responses skipped (first 5):`);
    skipped.slice(0, 5).forEach(([s, u]) => console.log(`  ${s}  ${u}`));
  }
  console.log(`[clone] done.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
