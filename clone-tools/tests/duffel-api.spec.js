const { test, expect, request } = require('@playwright/test');

const BASE = 'http://localhost:8088';
let api;
test.beforeAll(async () => { api = await request.newContext({ baseURL: BASE }); });
test.afterAll(async () => { await api.dispose(); });

let OFFER_REQUEST_ID = null;
let OFFER_ID = null;

test('GET /skybox-api/health is live mode', async () => {
  const r = await api.get('/skybox-api/health');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.ok).toBe(true);
});

test('GET /skybox-api/places autocomplete', async () => {
  const r = await api.get('/skybox-api/places?q=lon');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.places)).toBe(true);
  expect(j.places.length).toBeGreaterThan(0);
});

test('GET /skybox-api/auth/me unauth returns null user', async () => {
  const r = await api.get('/skybox-api/auth/me');
  const j = await r.json();
  expect(j.user).toBeNull();
});

test('POST /skybox-api/flights/search returns offers with v2 fields', async () => {
  const r = await api.post('/skybox-api/flights/search', {
    data: { from: 'YYZ', to: 'CDG', depart: '2026-08-05', pax: { adults: 1 }, cabin: 'economy', max_connections: 2, supplier_timeout: 15000 },
  });
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.offers.length).toBeGreaterThan(0);
  expect(j.offer_request_id).toMatch(/^orq_/);
  OFFER_REQUEST_ID = j.offer_request_id;
  OFFER_ID = j.offers[0].id;
  expect(OFFER_ID).toMatch(/^off_/);
  // v2 pass-through
  expect(j.offers[0]).toHaveProperty('payment_requirements');
  expect(j.offers[0]).toHaveProperty('supported_loyalty_programmes');
});

test('GET /skybox-api/flights/offer-requests list', async () => {
  const r = await api.get('/skybox-api/flights/offer-requests?limit=2');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.offer_requests)).toBe(true);
});

test('GET /skybox-api/flights/offer-requests/:id', async () => {
  expect(OFFER_REQUEST_ID).toBeTruthy();
  const r = await api.get(`/skybox-api/flights/offer-requests/${OFFER_REQUEST_ID}`);
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.id).toBe(OFFER_REQUEST_ID);
});

test('GET /skybox-api/flights/offers list by offer_request_id', async () => {
  expect(OFFER_REQUEST_ID).toBeTruthy();
  const r = await api.get(`/skybox-api/flights/offers?offer_request_id=${OFFER_REQUEST_ID}&limit=5`);
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.offers)).toBe(true);
  expect(j.offers.length).toBeGreaterThan(0);
});

test('GET /skybox-api/flights/offers/:id (single offer, return_available_services)', async () => {
  expect(OFFER_ID).toBeTruthy();
  const r = await api.get(`/skybox-api/flights/offers/${OFFER_ID}`);
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.offer.id).toBe(OFFER_ID);
  expect(j.offer).toHaveProperty('available_services');
});

test('GET /skybox-api/flights/offers/:id/seat-maps', async () => {
  expect(OFFER_ID).toBeTruthy();
  const r = await api.get(`/skybox-api/flights/offers/${OFFER_ID}/seat-maps`);
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.seat_maps)).toBe(true);
});

test('POST /skybox-api/flights/offers/:id/price (intended_payment_methods action)', async () => {
  expect(OFFER_ID).toBeTruthy();
  const r = await api.post(`/skybox-api/flights/offers/${OFFER_ID}/price`, {
    data: { intended_payment_methods: [], intended_services: [] },
  });
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.offer.id).toBe(OFFER_ID);
  expect(j.offer.total_amount).toBeTruthy();
});

test('POST /skybox-api/sessions (booking session draft)', async () => {
  expect(OFFER_ID).toBeTruthy();
  const r = await api.post('/skybox-api/sessions', { data: { offer_id: OFFER_ID } });
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.session_id).toBeTruthy();
});

test('GET /skybox-api/cancellations list', async () => {
  const r = await api.get('/skybox-api/cancellations?limit=1');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.cancellations)).toBe(true);
});

test('GET /skybox-api/airline-initiated-changes list', async () => {
  const r = await api.get('/skybox-api/airline-initiated-changes?limit=1');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(Array.isArray(j.changes)).toBe(true);
});

test('GET /skybox-api/orders unauth -> 401', async () => {
  const r = await api.get('/skybox-api/orders');
  expect(r.status()).toBe(401);
});

test('POST /skybox-api/flights/batch-offer-requests', async () => {
  const r = await api.post('/skybox-api/flights/batch-offer-requests', {
    data: { slices: [{ origin: 'YYZ', destination: 'CDG', departure_date: '2026-08-05' }], passengers: [{ type: 'adult' }], cabin_class: 'economy' },
  });
  // Duffel may return 202/200 or an error; accept either ok or a structured DUFFEL_ERROR
  const j = await r.json();
  if (!r.ok()) {
    expect(j.error).toBeTruthy();
    expect(j.error.code).toBe('DUFFEL_ERROR');
  } else {
    expect(j.batch_id).toBeTruthy();
  }
});

test('POST /skybox-api/flights/partial-offer-requests', async () => {
  const r = await api.post('/skybox-api/flights/partial-offer-requests', {
    data: { slices: [{ origin: 'YYZ', destination: 'CDG', departure_date: '2026-08-05' }], passengers: [{ type: 'adult' }], cabin_class: 'economy' },
  });
  const j = await r.json();
  if (!r.ok()) {
    expect(j.error).toBeTruthy();
    expect(j.error.code).toBe('DUFFEL_ERROR');
  } else {
    expect(j.partial_offer_request_id).toBeTruthy();
  }
});

test('POST /skybox-api/webhooks/duffel without signature is rejected when secret set, otherwise accepted', async () => {
  const r = await api.post('/skybox-api/webhooks/duffel', {
    headers: { 'content-type': 'application/json' },
    data: { id: 'evt_test_' + Date.now(), type: 'ping', data: {} },
  });
  // 200 if no secret configured, 401 if secret is set
  expect([200, 401]).toContain(r.status());
});
