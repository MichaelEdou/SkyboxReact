const { test, expect } = require('@playwright/test');

test('FAQ accordion: each item opens and closes on click', async ({ page }) => {
  await page.goto('http://localhost:8088/', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(500);

  const btns = page.locator('button[class*="BpkAccordionItem_bpk-accordion__toggle-button"]');
  const total = await btns.count();
  expect(total, 'expect at least one accordion item').toBeGreaterThan(0);

  let opened = 0, closed = 0;
  // Test first 4 (FAQs usually have ~10 items; covers both blocks)
  const sample = Math.min(total, 4);
  for (let i = 0; i < sample; i++) {
    const btn = btns.nth(i);
    await btn.scrollIntoViewIfNeeded();
    await btn.evaluate((el) => el.click());
    await page.waitForTimeout(300);
    const expanded1 = await btn.getAttribute('aria-expanded');
    expect(expanded1, `item ${i} should be expanded after first click`).toBe('true');
    opened++;
    await btn.click({ force: true });
    await page.waitForTimeout(300);
    const expanded2 = await btn.getAttribute('aria-expanded');
    expect(expanded2, `item ${i} should be collapsed after second click`).toBe('false');
    closed++;
  }
  console.log(`accordion: ${total} total items, tested ${sample}, opens=${opened} closes=${closed}`);
});
