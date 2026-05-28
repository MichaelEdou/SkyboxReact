// Verifies every interactive button on Skybox-built pages either navigates,
// opens a modal, or fires the EXPECTED /skybox-api endpoint when clicked.
const { test, expect, request } = require('@playwright/test');

const BASE = 'http://localhost:8088';

async function captureApiCalls(page, fn) {
  const calls = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/skybox-api/')) calls.push(`${req.method()} ${u.replace(BASE, '')}`);
  });
  await fn();
  return calls;
}

test.describe('Skybox custom pages — every button wired to an API call', () => {
  test('trips page: sign-in form posts to /skybox-api/auth/login', async ({ page }) => {
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/trips', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      // Unauthed view shows the sign-in form
      await page.fill('input#email', 'test+e2e@example.com').catch(() => {});
      await page.locator('form#f button[type="submit"]').click().catch(() => {});
      await page.waitForTimeout(800);
    });
    expect(calls.some((c) => c.includes('GET /skybox-api/auth/me'))).toBe(true);
    expect(calls.some((c) => c.includes('POST /skybox-api/auth/login'))).toBe(true);
  });

  test('flights-search page: form submit posts /skybox-api/flights/search', async ({ page }) => {
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/flights/search?from=YYZ&to=CDG&depart=2026-08-05&adults=1&cabin=economy', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
    });
    expect(calls.some((c) => c.includes('POST /skybox-api/flights/search'))).toBe(true);
  });

  test('offer page: hits /skybox-api/flights/offers/:id and creates a session', async ({ page }) => {
    // First grab a real offer
    const api = await request.newContext({ baseURL: BASE });
    const r = await api.post('/skybox-api/flights/search', { data: { from: 'YYZ', to: 'CDG', depart: '2026-08-05', pax: { adults: 1 }, cabin: 'economy' } });
    const j = await r.json();
    const offerId = j.offers && j.offers[0] && j.offers[0].id;
    if (!offerId) test.skip(true, 'no live offers');
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/flights/offer/' + encodeURIComponent(offerId), { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
    });
    expect(calls.some((c) => c.startsWith('GET /skybox-api/flights/offers/'))).toBe(true);
    expect(calls.some((c) => c.startsWith('POST /skybox-api/sessions'))).toBe(true);
  });

  test('offer page: "Select seats" button hits /seat-maps', async ({ page }) => {
    const api = await request.newContext({ baseURL: BASE });
    const r = await api.post('/skybox-api/flights/search', { data: { from: 'YYZ', to: 'CDG', depart: '2026-08-05', pax: { adults: 1 }, cabin: 'economy' } });
    const j = await r.json();
    const offerId = j.offers && j.offers[0] && j.offers[0].id;
    if (!offerId) test.skip(true, 'no live offers');
    await page.goto(BASE + '/flights/offer/' + encodeURIComponent(offerId), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const calls = await captureApiCalls(page, async () => {
      await page.click('#openSeatsBtn').catch(() => {});
      await page.waitForTimeout(2000);
    });
    expect(calls.some((c) => c.includes('/seat-maps'))).toBe(true);
  });

  test('trip-detail page: loads order via /skybox-api/orders/:id', async ({ page }) => {
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/trips/fake-id-12345', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
    });
    expect(calls.some((c) => c.startsWith('GET /skybox-api/orders/'))).toBe(true);
  });

  test('confirmation page: loads order via /skybox-api/orders/:id', async ({ page }) => {
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/flights/confirmation/fake-id-12345', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
    });
    expect(calls.some((c) => c.startsWith('GET /skybox-api/orders/'))).toBe(true);
  });

  test('home page: From-field click triggers /skybox-api/places autocomplete', async ({ page }) => {
    const calls = await captureApiCalls(page, async () => {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      // Dispatch a DOM click on the captured From input — the skybox-app.js
      // shim intercepts at document capture phase and opens its own popover.
      await page.evaluate(() => { const el = document.getElementById('originInput-input'); if (el) el.click(); });
      await page.waitForTimeout(500);
      // Type into the popover's input (skybox-app injects an input inside .sb-pop).
      await page.locator('.sb-pop input').first().fill('Toronto').catch(() => {});
      await page.waitForTimeout(1200);
    });
    expect(calls.some((c) => c.includes('/skybox-api/places'))).toBe(true);
  });
});
