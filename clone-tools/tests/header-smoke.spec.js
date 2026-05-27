const { test, expect } = require('@playwright/test');

const URLS = [
  { path: '/', expectCaptured: true,  expectInjected: false },
  { path: '/flights', expectCaptured: true, expectInjected: false },
  { path: '/flights/search?from=YYZ&to=CDG&depart=2026-08-01&adults=1&cabin=economy', expectCaptured: false, expectInjected: true },
  { path: '/trips', expectCaptured: false, expectInjected: true },
  { path: '/trips/fake', expectCaptured: false, expectInjected: true },
];

for (const t of URLS) {
  test(`header on ${t.path}`, async ({ page }) => {
    await page.goto('http://localhost:8088' + t.path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const counts = await page.evaluate(() => {
      const cap = document.querySelectorAll('#header[class*="GlobalHeader_headerDark"], header[class*="_Header_"], header[class*="GlobalHeader_"]').length;
      const inj = document.querySelectorAll('.sb-injected-header').length;
      let after = '';
      try {
        const logo = document.querySelector('[class*="bpk-logo_bpk-logo"]') || document.querySelector('.sb-injected-header [class*="brand"]');
        if (logo) after = getComputedStyle(logo, '::after').content;
      } catch (e) {}
      return { cap, inj, after };
    });
    console.log(`PATH=${t.path}  captured=${counts.cap}  injected=${counts.inj}  after=${counts.after}`);
    if (t.expectCaptured) expect(counts.cap, 'captured header should be present').toBeGreaterThanOrEqual(1);
    else expect(counts.cap, 'captured header should NOT be present').toBe(0);
    if (t.expectInjected) expect(counts.inj, 'injected header should be present').toBeGreaterThanOrEqual(1);
    else expect(counts.inj, 'injected header should NOT be present').toBe(0);
  });
}
