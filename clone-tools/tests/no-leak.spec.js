const { test, expect } = require('@playwright/test');

const PAGES = ['/', '/flights', '/flights/search?from=YYZ&to=CDG&depart=2026-08-01&adults=1&cabin=economy', '/trips', '/trips/fake'];

for (const path of PAGES) {
  test(`no outbound skyscanner traffic from ${path}`, async ({ page }) => {
    const offenders = [];
    page.on('request', (req) => {
      const url = req.url();
      if (/(^|\/\/)([a-z0-9.-]*skyscanner|[a-z0-9.-]*\.skyscnr\.com|[a-z0-9.-]*tianxun\.com)/i.test(url)) {
        offenders.push(url);
      }
    });
    await page.goto('http://localhost:8088' + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    if (offenders.length) console.log(`OFFENDERS from ${path}:\n` + offenders.slice(0, 10).join('\n'));
    expect(offenders, `outbound skyscanner/skyscnr/tianxun requests detected on ${path}`).toEqual([]);
  });
}
