// Fetch a Skyscanner page from the Wayback Machine when live capture hits
// PerimeterX. Loads the snapshot in Playwright, waits for hydration, strips
// Wayback's toolbar/banner, rewrites Wayback-proxied asset URLs back to our
// local /_ext/ mirror, and writes the HTML.
//
// Usage: node wayback-fetch.js <outFile> <skyscannerUrl>

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.resolve(process.argv[2]);
const TARGET = process.argv[3];
if (!OUT_FILE || !TARGET) { console.error('usage: node wayback-fetch.js <outFile> <url>'); process.exit(1); }

(async () => {
  const wbUrl = 'https://web.archive.org/web/2026/' + TARGET;
  console.log('[wayback] loading', wbUrl);
  const b = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await b.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-CA',
  });
  const page = await ctx.newPage();
  await page.goto(wbUrl, { waitUntil: 'networkidle', timeout: 90000 }).catch((e) => console.log('[wayback] networkidle wait failed:', e.message));
  // Scroll to trigger any lazy content.
  await page.evaluate(async () => {
    await new Promise((r) => {
      let y = 0;
      const step = () => {
        window.scrollTo(0, y);
        y += 400;
        if (y < document.body.scrollHeight) setTimeout(step, 50); else r();
      };
      step();
    });
  }).catch(() => {});
  await page.waitForTimeout(8000);
  let html = await page.content();
  await b.close();

  // Strip Wayback's toolbar + injected scripts.
  html = html.replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/g, '');
  html = html.replace(/<script[^>]*\bsrc="https:\/\/web\.archive\.org\/static\/[^"]+"[^>]*><\/script>/g, '');
  html = html.replace(/<link[^>]*\bhref="https:\/\/web\.archive\.org\/static\/[^"]+"[^>]*\/?>/g, '');
  html = html.replace(/<div id="wm-ipp[^"]*"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/, '');
  html = html.replace(/__wb_pmw[\s\S]*?_____;/g, '');

  // Rewrite Wayback-proxied asset URLs back to our local mirror.
  //   https://web.archive.org/web/20260407072206im_/https://js.skyscnr.com/...   ->   /_ext/js.skyscnr.com/...
  //   https://web.archive.org/web/20260407072206/https://www.skyscanner.ca/...    ->   /...
  html = html.replace(/https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/https?:\/\/js\.skyscnr\.com/g, '/_ext/js.skyscnr.com');
  html = html.replace(/https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/https?:\/\/content\.skyscnr\.com/g, '/_ext/content.skyscnr.com');
  html = html.replace(/https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/https?:\/\/www\.skyscanner\.ca/g, '');
  html = html.replace(/https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//g, '/_ext/wayback/');

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, html);
  console.log('[wayback] wrote', OUT_FILE, '(' + html.length + ' bytes)');
})();
