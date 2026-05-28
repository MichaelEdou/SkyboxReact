const { test, expect } = require('@playwright/test');

const PAGES = ['/', '/flights', '/flights/search?from=YYZ&to=CDG&depart=2026-08-01&adults=1&cabin=economy', '/trips', '/trips/fake'];

for (const path of PAGES) {
  test(`Skyscanner Relative / Skybox Sans loaded on ${path}`, async ({ page }) => {
    await page.goto('http://localhost:8088' + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(async () => {
      // 1. Is one of the expected families in body font-family?
      const fam = getComputedStyle(document.body).fontFamily;
      // 2. Has any matching font actually been *loaded* by the browser?
      await document.fonts.ready;
      const loaded = [];
      document.fonts.forEach((f) => { if (/Skybox Sans|Skyscanner Relative/.test(f.family) && f.status === 'loaded') loaded.push(f.family + ':' + f.weight); });
      return { fam, loaded };
    });
    console.log(`PATH=${path} fam="${r.fam}" loaded=[${r.loaded.join(', ')}]`);
    expect(r.fam, 'body font-family must reference Skybox Sans or Skyscanner Relative').toMatch(/Skybox Sans|Skyscanner Relative/);
    expect(r.loaded.length, 'at least one Skybox/Skyscanner woff2 must be loaded').toBeGreaterThanOrEqual(1);
  });
}
