const { test, expect } = require('@playwright/test');

test('home page hides "Our international sites" footer block', async ({ page }) => {
  await page.goto('http://localhost:8088/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const visible = await page.locator('#internationalSites-group:visible').count();
  expect(visible).toBe(0);
  const sitesContainer = await page.locator('[class*="InternationalSites_sitesContainer"]:visible').count();
  expect(sitesContainer).toBe(0);
});

test('home page hides "Start planning your adventure" internal-links block', async ({ page }) => {
  await page.goto('http://localhost:8088/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const links = await page.locator('[data-tracking-element-id="internal_links"]:visible').count();
  expect(links).toBe(0);
  const inner = await page.locator('[class*="_InternalLinks_"]:visible').count();
  expect(inner).toBe(0);
});

test('captured links to /car-rental-in/* and /flights-to/* are not visible', async ({ page }) => {
  await page.goto('http://localhost:8088/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // Anchors to car-rental-in must be hidden by our CSS
  const carRentalVisible = await page.locator('a[href^="/car-rental-in/"]:visible').count();
  expect(carRentalVisible).toBe(0);
});
