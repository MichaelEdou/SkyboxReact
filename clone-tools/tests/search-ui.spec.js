const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8088';

test('search page shows airline checkbox filters', async ({ page }) => {
  await page.goto(BASE + '/flights/search?from=YYZ&to=CDG&depart=2026-08-05&adults=1&cabin=economy', { waitUntil: 'domcontentloaded' });
  // Wait for the offer search to come back from Duffel
  await page.waitForSelector('input.airline-filter', { timeout: 25000 });
  const filters = await page.$$eval('input.airline-filter', (els) => els.length);
  expect(filters).toBeGreaterThan(0);
  console.log('airline filters rendered:', filters);
});

test('flight details expand on click', async ({ page }) => {
  await page.goto(BASE + '/flights/search?from=YYZ&to=CDG&depart=2026-08-05&adults=1&cabin=economy', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sb-toggle-details', { timeout: 25000 });
  const tgl = page.locator('.sb-toggle-details').first();
  // First details panel should be hidden
  const initiallyVisible = await page.locator('.sb-offer').first().locator('.sb-details').evaluate((el) => el.style.display);
  expect(initiallyVisible).toBe('none');
  await tgl.click();
  await page.waitForTimeout(200);
  const afterClickVisible = await page.locator('.sb-offer').first().locator('.sb-details').evaluate((el) => el.style.display);
  expect(afterClickVisible).toBe('block');
});

test('airline "None" + "Select all" buttons toggle every checkbox', async ({ page }) => {
  await page.goto(BASE + '/flights/search?from=YYZ&to=CDG&depart=2026-08-05&adults=1&cabin=economy', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('input.airline-filter', { timeout: 25000 });
  await page.locator('#airlinesNone').click();
  await page.waitForTimeout(150);
  const noneChecked = await page.$$eval('input.airline-filter:checked', (els) => els.length);
  expect(noneChecked).toBe(0);
  await page.locator('#airlinesAll').click();
  await page.waitForTimeout(150);
  const totalChecked = await page.$$eval('input.airline-filter:checked', (els) => els.length);
  const total = await page.$$eval('input.airline-filter', (els) => els.length);
  expect(totalChecked).toBe(total);
});

test('sort select swaps offer order', async ({ page }) => {
  await page.goto(BASE + '/flights/search?from=YYZ&to=CDG&depart=2026-08-05&adults=1&cabin=economy', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sb-offer', { timeout: 25000 });
  const ascFirst = await page.locator('.sb-offer').first().getAttribute('data-offer-id');
  await page.selectOption('#sortBy', 'price-desc');
  await page.waitForTimeout(300);
  const descFirst = await page.locator('.sb-offer').first().getAttribute('data-offer-id');
  expect(descFirst).not.toBe(ascFirst);
});

test('no ad-tech CSP errors on homepage', async ({ page }) => {
  const cspErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy|csp/i.test(m.text())) cspErrors.push(m.text()); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  // Ad-tech CSP violations should be silently dropped by the JS blocker.
  const remaining = cspErrors.filter((e) => /gum\.criteo|js\.px-cloud|googletagmanager|newrelic|nr-spa/i.test(e));
  expect(remaining, 'ad-tech CSP errors still leaking: ' + remaining.join(' | ')).toEqual([]);
});
