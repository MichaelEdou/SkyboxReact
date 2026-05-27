// /skybox-api/* — Duffel-backed surface (flights only).
const crypto = require('crypto');
const { duffel, IS_LIVE } = require('./duffel');
const { prisma, SESSION_TTL_MS, LOGIN_TTL_MS, COOKIE_TTL_MS, newExpiry } = require('./db');
const { sendEmail } = require('./email');

const CABIN_MAP = { economy:'economy', premium:'premium_economy', premium_economy:'premium_economy', business:'business', first:'first' };

function send(res, status, body, extraHeaders) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, extraHeaders || {}));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
function err(res, status, code, message, details) { send(res, status, { error: { code, message, details: details || null } }); }
async function readJson(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 2e6) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
async function readRawBody(req) {
  return new Promise((res, rej) => { let d = ''; req.on('data', (c) => d += c); req.on('end', () => res(d)); req.on('error', rej); });
}

function parseCookies(req) {
  const out = {}; (req.headers.cookie || '').split(/;\s*/).forEach((p) => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); });
  return out;
}
function setCookie(name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  return parts.join('; ');
}
function clearCookie(name) { return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }
async function getCurrentUser(req) {
  const tok = parseCookies(req).sb_session;
  if (!tok) return null;
  const s = await prisma.session.findUnique({ where: { sessionToken: tok }, include: { user: true } });
  if (!s || s.expires < new Date()) return null;
  return s.user;
}

function segmentSummary(seg) {
  return {
    id: seg.id, origin: seg.origin.iata_code, destination: seg.destination.iata_code,
    departing_at: seg.departing_at, arriving_at: seg.arriving_at, duration: seg.duration,
    marketing_carrier: seg.marketing_carrier ? { name: seg.marketing_carrier.name, iata: seg.marketing_carrier.iata_code, logo: seg.marketing_carrier.logo_symbol_url || null } : null,
    flight_number: seg.marketing_carrier_flight_number || seg.operating_carrier_flight_number,
    aircraft: seg.aircraft?.name || null,
  };
}
function sliceSummary(s) {
  return {
    id: s.id,
    origin: { iata: s.origin.iata_code, name: s.origin.name, city: s.origin.city_name },
    destination: { iata: s.destination.iata_code, name: s.destination.name, city: s.destination.city_name },
    departing_at: s.segments[0]?.departing_at, arriving_at: s.segments[s.segments.length - 1]?.arriving_at,
    duration: s.duration, segments: s.segments.map(segmentSummary),
  };
}
function offerSummary(o, includeServices = false) {
  const base = {
    id: o.id, total_amount: o.total_amount, total_currency: o.total_currency,
    base_amount: o.base_amount, tax_amount: o.tax_amount, expires_at: o.expires_at,
    owner: o.owner ? { name: o.owner.name, iata: o.owner.iata_code, logo: o.owner.logo_symbol_url || null } : null,
    slices: o.slices.map(sliceSummary),
    passengers: (o.passengers || []).map((p) => ({ id: p.id, type: p.type, age: p.age, given_name: p.given_name || null, family_name: p.family_name || null })),
    conditions: o.conditions || null,
    payment_requirements: o.payment_requirements || null,
    supported_loyalty_programmes: o.supported_loyalty_programmes || [],
    supported_passenger_identity_document_types: o.supported_passenger_identity_document_types || [],
    available_airline_credit_ids: o.available_airline_credit_ids || [],
    private_fares: o.private_fares || [],
    total_emissions_kg: o.total_emissions_kg || null,
    partial: !!o.partial,
  };
  if (includeServices) base.available_services = (o.available_services || []).map((s) => ({
    id: s.id, type: s.type, total_amount: s.total_amount, total_currency: s.total_currency,
    maximum_quantity: s.maximum_quantity, metadata: s.metadata,
    passenger_ids: s.passenger_ids, segment_ids: s.segment_ids,
  }));
  return base;
}

// ---------- Auth ----------
async function handleAuthLogin(req, res) {
  const body = await readJson(req);
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) return err(res, 422, 'VALIDATION_ERROR', 'valid email required');
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) user = await prisma.user.create({ data: { email } });
  const token = crypto.randomBytes(24).toString('base64url');
  await prisma.loginToken.create({ data: { email, userId: user.id, token, expires: newExpiry(LOGIN_TTL_MS) } });
  const url = `${process.env.APP_URL || 'http://localhost:8088'}/auth/verify?token=${token}`;
  const sent = await sendEmail('magic-link', email, { url });
  if (!sent) console.log(`[skybox-auth] magic link for ${email}: ${url}`);
  return send(res, 200, { ok: true, message: sent ? 'Sign-in link sent.' : 'See server console for sign-in link (dev mode).' });
}
async function handleAuthVerify(req, res, query) {
  const token = query.token;
  if (!token) return err(res, 422, 'VALIDATION_ERROR', 'token required');
  const lt = await prisma.loginToken.findUnique({ where: { token } });
  if (!lt || lt.consumed || lt.expires < new Date()) return err(res, 400, 'INVALID_TOKEN', 'link invalid or expired');
  await prisma.loginToken.update({ where: { id: lt.id }, data: { consumed: true } });
  await prisma.user.update({ where: { id: lt.userId }, data: { emailVerified: new Date() } });
  const sessionToken = crypto.randomBytes(32).toString('base64url');
  const expires = newExpiry(COOKIE_TTL_MS);
  await prisma.session.create({ data: { sessionToken, userId: lt.userId, expires } });
  res.writeHead(302, { Location: '/trips', 'Set-Cookie': setCookie('sb_session', sessionToken, { expires }) });
  res.end();
}
async function handleAuthMe(req, res) {
  const u = await getCurrentUser(req);
  send(res, 200, { user: u ? { id: u.id, email: u.email, name: u.name } : null });
}
async function handleAuthLogout(req, res) {
  const tok = parseCookies(req).sb_session;
  if (tok) await prisma.session.deleteMany({ where: { sessionToken: tok } });
  send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie('sb_session') });
}

// ---------- Reference + health ----------
async function handleHealth(req, res) {
  try { const r = await duffel.airlines.list({ limit: 1 }); return send(res, 200, { ok: true, live_mode: IS_LIVE, sample_airline: r.data[0]?.iata_code }); }
  catch (e) { return send(res, 500, { ok: false, error: e.message }); }
}
async function handlePlaces(req, res, query) {
  const q = (query.q || '').trim();
  if (q.length < 2) return send(res, 200, { places: [] });
  try {
    const r = await duffel.suggestions.list({ query: q });
    const places = (r.data || []).slice(0, 12).map((p) => ({
      id: p.id, iata: p.iata_code, name: p.name, city: p.city_name || p.city?.name,
      country: p.iata_country_code, type: p.type, latitude: p.latitude, longitude: p.longitude,
    }));
    send(res, 200, { places });
  } catch { send(res, 200, { places: [] }); }
}

// ---------- Flights ----------
async function handleFlightsSearch(req, res) {
  const startedAt = Date.now();
  const body = await readJson(req);
  const { from, to, depart, ret, pax, cabin } = body;
  if (!from || !to || !depart) return err(res, 422, 'VALIDATION_ERROR', 'from, to, depart required');
  const adults = Math.max(1, Math.min(parseInt(pax?.adults ?? '1', 10), 9));
  const children = Math.max(0, Math.min(parseInt(pax?.children ?? '0', 10), 8));
  const infants = Math.max(0, Math.min(parseInt(pax?.infants ?? '0', 10), 4));
  const passengers = [
    ...Array.from({ length: adults }, () => ({ type: 'adult' })),
    ...Array.from({ length: children }, () => ({ type: 'child' })),
    ...Array.from({ length: infants }, () => ({ type: 'infant_without_seat' })),
  ];
  const cabinClass = CABIN_MAP[(cabin || 'economy').toLowerCase()] || 'economy';
  const slices = [{ origin: from.toUpperCase(), destination: to.toUpperCase(), departure_date: depart }];
  if (ret) slices.push({ origin: to.toUpperCase(), destination: from.toUpperCase(), departure_date: ret });
  // v2 extras (all optional)
  const payload = { slices, passengers, cabin_class: cabinClass, return_offers: true };
  if (Number.isInteger(body.max_connections)) payload.max_connections = Math.max(0, Math.min(body.max_connections, 3));
  if (body.private_fares && typeof body.private_fares === 'object') payload.private_fares = body.private_fares;
  if (Array.isArray(body.airline_credit_ids) && body.airline_credit_ids.length) payload.airline_credit_ids = body.airline_credit_ids;
  const opts = {};
  if (Number.isInteger(body.supplier_timeout)) opts.supplier_timeout = Math.max(2000, Math.min(body.supplier_timeout, 60000));
  try {
    const orq = await duffel.offerRequests.create(payload, opts.supplier_timeout ? { supplier_timeout: opts.supplier_timeout } : undefined);
    const offers = (orq.data.offers || []).slice(0, 50).map((o) => offerSummary(o, false));
    const u = await getCurrentUser(req);
    await prisma.search.create({ data: { userId: u?.id, type: 'flights', payload: JSON.stringify(body), resultCount: offers.length, durationMs: Date.now() - startedAt } }).catch(() => {});
    return send(res, 200, { offer_request_id: orq.data.id, live_mode: IS_LIVE, count: offers.length, offers });
  } catch (e) {
    const d = e?.errors?.[0] || { message: e.message };
    return err(res, 502, 'DUFFEL_ERROR', d.message || 'offer request failed', d);
  }
}
async function handleOfferRequestGet(req, res, id) {
  try {
    const r = await duffel.offerRequests.get(id);
    return send(res, 200, {
      id: r.data.id, created_at: r.data.created_at, live_mode: r.data.live_mode,
      cabin_class: r.data.cabin_class, slices: r.data.slices || [],
      passengers: r.data.passengers || [],
      offers: (r.data.offers || []).map((o) => offerSummary(o)),
    });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offer request fetch failed', e?.errors?.[0]);
  }
}
function clean(obj) { const o = {}; for (const k in obj) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') o[k] = obj[k]; return o; }
async function handleOfferRequestList(req, res, query) {
  try {
    const r = await duffel.offerRequests.list(clean({ limit: Math.min(parseInt(query.limit || '20', 10), 200), after: query.after, before: query.before }));
    return send(res, 200, {
      meta: r.meta,
      offer_requests: (r.data || []).map((x) => ({ id: x.id, created_at: x.created_at, cabin_class: x.cabin_class, slices: x.slices || [], live_mode: x.live_mode })),
    });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || e.message || 'offer requests list failed', e?.errors?.[0] || { message: e.message });
  }
}
async function handleOffersList(req, res, query) {
  const offerRequestId = query.offer_request_id;
  if (!offerRequestId) return err(res, 422, 'VALIDATION_ERROR', 'offer_request_id query required');
  try {
    const r = await duffel.offers.list(clean({
      offer_request_id: offerRequestId,
      limit: Math.min(parseInt(query.limit || '50', 10), 200),
      sort: query.sort || 'total_amount',
      max_connections: query.max_connections != null ? parseInt(query.max_connections, 10) : undefined,
      after: query.after, before: query.before,
    }));
    return send(res, 200, { meta: r.meta, offers: (r.data || []).map((o) => offerSummary(o)) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offers list failed', e?.errors?.[0]);
  }
}
async function handleOfferPrice(req, res, id) {
  // POST /air/offers/:id/actions/price — intended_payment_methods + intended_services
  const body = await readJson(req);
  try {
    const priced = await duffel.offers.getPriced(id, {
      intended_payment_methods: body.intended_payment_methods || [],
      intended_services: body.intended_services || [],
    });
    return send(res, 200, { offer: offerSummary(priced.data, true) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offer pricing failed', e?.errors?.[0]);
  }
}
async function handleOfferPassengerUpdate(req, res, offerId, passengerId) {
  const body = await readJson(req);
  try {
    const r = await duffel.offers.update(offerId, passengerId, body);
    return send(res, 200, { ok: true, offer: offerSummary(r.data, false) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offer passenger update failed', e?.errors?.[0]);
  }
}
async function handleOfferGet(req, res, id) {
  try {
    const o = await duffel.offers.get(id, { return_available_services: true });
    return send(res, 200, { offer: offerSummary(o.data, true) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offer fetch failed', e?.errors?.[0]);
  }
}
async function handleSeatMaps(req, res, offerId) {
  try { const r = await duffel.seatMaps.get({ offer_id: offerId }); return send(res, 200, { seat_maps: r.data || [] }); }
  catch (e) { return send(res, 200, { seat_maps: [], warn: e.message }); }
}

// ---------- Booking sessions ----------
async function handleSessionCreate(req, res) {
  const body = await readJson(req);
  const { offer_id } = body;
  if (!offer_id) return err(res, 422, 'VALIDATION_ERROR', 'offer_id required');
  try {
    const o = await duffel.offers.get(offer_id, { return_available_services: false });
    const u = await getCurrentUser(req);
    const s = await prisma.bookingSession.create({
      data: {
        userId: u?.id, type: 'flight', duffelOfferId: offer_id,
        totalAmount: o.data.total_amount, currency: o.data.total_currency,
        offerExpiresAt: new Date(o.data.expires_at),
        expiresAt: newExpiry(SESSION_TTL_MS), rawOffer: JSON.stringify(o.data),
        status: 'draft',
      },
    });
    return send(res, 200, { session_id: s.id, expires_at: s.expiresAt, offer_expires_at: s.offerExpiresAt });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'offer fetch failed', e?.errors?.[0]);
  }
}
async function handleSessionGet(req, res, id) {
  const s = await prisma.bookingSession.findUnique({ where: { id } });
  if (!s) return err(res, 404, 'NOT_FOUND', 'session not found');
  return send(res, 200, {
    id: s.id, type: s.type, duffel_offer_id: s.duffelOfferId,
    total_amount: s.totalAmount, currency: s.currency, status: s.status,
    offer_expires_at: s.offerExpiresAt, expires_at: s.expiresAt,
    passengers: s.passengers ? JSON.parse(s.passengers) : null,
    services: s.services ? JSON.parse(s.services) : null,
    contact: s.contact ? JSON.parse(s.contact) : null,
    payment_intent_id: s.paymentIntentId, payment_client_token: s.paymentClientToken,
  });
}
async function handleSessionPatch(req, res, id) {
  const body = await readJson(req);
  const s = await prisma.bookingSession.findUnique({ where: { id } });
  if (!s) return err(res, 404, 'NOT_FOUND', 'session not found');
  const patch = {};
  if (body.passengers) patch.passengers = JSON.stringify(body.passengers);
  if (body.services !== undefined) patch.services = JSON.stringify(body.services);
  if (body.contact) patch.contact = JSON.stringify(body.contact);
  await prisma.bookingSession.update({ where: { id }, data: patch });
  return send(res, 200, { ok: true });
}
async function handlePaymentIntentCreate(req, res, sessionId) {
  const s = await prisma.bookingSession.findUnique({ where: { id: sessionId } });
  if (!s) return err(res, 404, 'NOT_FOUND', 'session not found');
  if (!s.duffelOfferId) return err(res, 400, 'NO_OFFER', 'session has no offer');
  let amount = s.totalAmount, currency = s.currency;
  try {
    const fresh = await duffel.offers.get(s.duffelOfferId);
    amount = fresh.data.total_amount; currency = fresh.data.total_currency;
    if (amount !== s.totalAmount) await prisma.bookingSession.update({ where: { id: s.id }, data: { totalAmount: amount, currency } });
  } catch { return err(res, 409, 'OFFER_EXPIRED', 'offer can no longer be priced. please search again.'); }
  try {
    const pi = await duffel.paymentIntents.create({ amount, currency });
    await prisma.bookingSession.update({
      where: { id: s.id },
      data: { paymentIntentId: pi.data.id, paymentClientToken: pi.data.client_token, status: 'awaiting_payment' },
    });
    await prisma.payment.create({ data: { bookingSessionId: s.id, duffelPaymentIntentId: pi.data.id, amount, currency, status: 'requires_payment_method', raw: JSON.stringify(pi.data) } });
    return send(res, 200, { payment_intent_id: pi.data.id, client_token: pi.data.client_token, amount, currency, live_mode: IS_LIVE });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'payment intent failed', e?.errors?.[0]);
  }
}
async function handleSessionConfirm(req, res, sessionId) {
  const s = await prisma.bookingSession.findUnique({ where: { id: sessionId } });
  if (!s) return err(res, 404, 'NOT_FOUND', 'session not found');
  if (!s.paymentIntentId) return err(res, 400, 'NO_PAYMENT', 'create a payment intent first');
  if (!s.passengers) return err(res, 400, 'NO_PASSENGERS', 'passenger details required');
  const passengers = JSON.parse(s.passengers);
  const services = s.services ? JSON.parse(s.services) : [];
  const contact = s.contact ? JSON.parse(s.contact) : {};
  let intent;
  try { intent = await duffel.paymentIntents.get(s.paymentIntentId); }
  catch (e) { return err(res, 502, 'DUFFEL_ERROR', 'payment intent fetch failed', { message: e.message }); }
  const status = intent.data?.status;
  if (!['requires_confirmation', 'succeeded'].includes(status)) {
    return err(res, 400, 'PAYMENT_NOT_READY', `payment intent status is ${status}; complete card form first`);
  }
  if (status === 'requires_confirmation') {
    try { await duffel.paymentIntents.confirm(s.paymentIntentId); }
    catch (e) { return err(res, 402, 'PAYMENT_DECLINED', e?.errors?.[0]?.message || 'payment declined', e?.errors?.[0]); }
  }
  let fresh;
  try { fresh = await duffel.offers.get(s.duffelOfferId); }
  catch { return err(res, 409, 'OFFER_EXPIRED', 'offer expired'); }
  if (fresh.data.total_amount !== s.totalAmount) {
    return err(res, 409, 'PRICE_CHANGED', `price changed from ${s.totalAmount} to ${fresh.data.total_amount}`, { new_amount: fresh.data.total_amount, new_currency: fresh.data.total_currency });
  }
  const internalId = crypto.randomUUID();
  try {
    const u = await getCurrentUser(req);
    const r = await duffel.orders.create({
      type: 'instant', selected_offers: [s.duffelOfferId], passengers,
      services: Array.isArray(services) ? services : [],
      payments: [{ type: 'balance', currency: s.currency, amount: s.totalAmount }],
      metadata: { internal_order_id: internalId, booking_session_id: s.id, user_id: u?.id || null },
    });
    const ord = r.data;
    const dbOrder = await prisma.order.create({
      data: {
        id: internalId, userId: u?.id, bookingSessionId: s.id, type: 'flight',
        duffelOrderId: ord.id, bookingReference: ord.booking_reference, status: 'confirmed',
        totalAmount: ord.total_amount, currency: ord.total_currency,
        contactEmail: contact.email || '', contactPhone: contact.phone || null,
        rawSnapshot: JSON.stringify(ord),
        startsAt: ord.slices?.[0]?.segments?.[0]?.departing_at ? new Date(ord.slices[0].segments[0].departing_at) : null,
        endsAt: ord.slices?.[ord.slices.length - 1]?.segments?.slice(-1)?.[0]?.arriving_at ? new Date(ord.slices[ord.slices.length - 1].segments.slice(-1)[0].arriving_at) : null,
      },
    });
    await prisma.bookingSession.update({ where: { id: s.id }, data: { status: 'confirmed' } });
    await prisma.payment.updateMany({ where: { duffelPaymentIntentId: s.paymentIntentId }, data: { status: 'succeeded', orderId: dbOrder.id } });
    await prisma.orderEvent.create({ data: { orderId: dbOrder.id, source: 'system', type: 'order.created', payload: JSON.stringify({ duffel_order_id: ord.id }) } });
    if (contact.email) sendEmail('booking.confirmation.flight', contact.email, { order: { id: dbOrder.id, booking_reference: ord.booking_reference, total_amount: ord.total_amount, currency: ord.total_currency } }).catch(() => {});
    return send(res, 200, { order_id: dbOrder.id, booking_reference: ord.booking_reference, duffel_order_id: ord.id });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'order create failed', e?.errors?.[0]);
  }
}

// ---------- Orders ----------
async function handleOrdersList(req, res) {
  const u = await getCurrentUser(req);
  if (!u) return err(res, 401, 'UNAUTHORIZED', 'sign in to view trips');
  const orders = await prisma.order.findMany({ where: { userId: u.id }, orderBy: { createdAt: 'desc' }, take: 50 });
  return send(res, 200, { orders: orders.map((o) => ({ id: o.id, type: o.type, status: o.status, booking_reference: o.bookingReference, total_amount: o.totalAmount, currency: o.currency, starts_at: o.startsAt, ends_at: o.endsAt, created_at: o.createdAt })) });
}
async function handleOrderGet(req, res, id) {
  const o = await prisma.order.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'desc' }, take: 50 }, payments: true } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  const snap = JSON.parse(o.rawSnapshot);
  return send(res, 200, {
    id: o.id, status: o.status, type: o.type, booking_reference: o.bookingReference,
    total_amount: o.totalAmount, currency: o.currency, duffel_order_id: o.duffelOrderId,
    contact: { email: o.contactEmail, phone: o.contactPhone },
    slices: (snap.slices || []).map(sliceSummary),
    passengers: snap.passengers || [], documents: snap.documents || [],
    cancelled_at: o.cancelledAt,
    events: o.events.map((e) => ({ source: e.source, type: e.type, payload: e.payload ? JSON.parse(e.payload) : null, at: e.createdAt })),
    payments: o.payments.map((p) => ({ status: p.status, amount: p.amount, currency: p.currency })),
  });
}
// Legacy one-shot cancel (kept for compatibility): create + confirm immediately.
async function handleOrderCancel(req, res, id) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  try {
    const c = await duffel.orderCancellations.create({ order_id: o.duffelOrderId });
    const confirmed = await duffel.orderCancellations.confirm(c.data.id);
    await prisma.order.update({ where: { id: o.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
    await prisma.orderEvent.create({ data: { orderId: o.id, source: 'user', type: 'order.cancelled', payload: JSON.stringify({ cancellation_id: confirmed.data.id, refund_amount: confirmed.data.refund_amount, refund_currency: confirmed.data.refund_currency }) } });
    return send(res, 200, { ok: true, cancellation_id: confirmed.data.id, refund_amount: confirmed.data.refund_amount, refund_currency: confirmed.data.refund_currency });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'cancel failed', e?.errors?.[0]);
  }
}
// v2 two-step: quote (returns refund estimate) then confirm.
async function handleOrderCancellationQuote(req, res, id) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  try {
    const c = await duffel.orderCancellations.create({ order_id: o.duffelOrderId });
    await prisma.orderEvent.create({ data: { orderId: o.id, source: 'user', type: 'order.cancellation.quoted', payload: JSON.stringify({ cancellation_id: c.data.id, refund_amount: c.data.refund_amount, refund_currency: c.data.refund_currency }) } });
    return send(res, 200, {
      cancellation_id: c.data.id, expires_at: c.data.expires_at,
      refund_amount: c.data.refund_amount, refund_currency: c.data.refund_currency,
      refund_to: c.data.refund_to, refund_type: c.data.refund_type,
    });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'cancellation quote failed', e?.errors?.[0]);
  }
}
async function handleOrderCancellationConfirm(req, res, id, cancellationId) {
  const o = await prisma.order.findUnique({ where: { id } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  try {
    const confirmed = await duffel.orderCancellations.confirm(cancellationId);
    await prisma.order.update({ where: { id: o.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
    await prisma.orderEvent.create({ data: { orderId: o.id, source: 'user', type: 'order.cancelled', payload: JSON.stringify({ cancellation_id: confirmed.data.id, refund_amount: confirmed.data.refund_amount, refund_currency: confirmed.data.refund_currency }) } });
    return send(res, 200, { ok: true, cancellation_id: confirmed.data.id, refund_amount: confirmed.data.refund_amount, refund_currency: confirmed.data.refund_currency });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'cancellation confirm failed', e?.errors?.[0]);
  }
}
async function handleCancellationGet(req, res, cancellationId) {
  try {
    const r = await duffel.orderCancellations.get(cancellationId);
    return send(res, 200, {
      id: r.data.id, order_id: r.data.order_id, confirmed_at: r.data.confirmed_at,
      expires_at: r.data.expires_at, refund_amount: r.data.refund_amount,
      refund_currency: r.data.refund_currency, refund_to: r.data.refund_to, refund_type: r.data.refund_type,
      live_mode: r.data.live_mode,
    });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'cancellation fetch failed', e?.errors?.[0]);
  }
}
async function handleCancellationsList(req, res, query) {
  try {
    const r = await duffel.orderCancellations.list(clean({
      limit: Math.min(parseInt(query.limit || '50', 10), 200),
      after: query.after, before: query.before, order_id: query.order_id,
    }));
    return send(res, 200, { meta: r.meta, cancellations: (r.data || []).map((c) => ({
      id: c.id, order_id: c.order_id, confirmed_at: c.confirmed_at, expires_at: c.expires_at,
      refund_amount: c.refund_amount, refund_currency: c.refund_currency, refund_to: c.refund_to,
    })) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'cancellations list failed', e?.errors?.[0]);
  }
}
// ---------- Airline-Initiated Changes ----------
async function handleAircList(req, res, query) {
  try {
    const r = await duffel.airlineInitiatedChanges.list(clean({
      limit: Math.min(parseInt(query.limit || '50', 10), 200),
      order_id: query.order_id, after: query.after, before: query.before,
    }));
    return send(res, 200, { meta: r.meta, changes: r.data || [] });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'AIC list failed', e?.errors?.[0]);
  }
}
async function handleAircAccept(req, res, id) {
  try {
    const r = await duffel.airlineInitiatedChanges.accept(id);
    return send(res, 200, { ok: true, change: r.data });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'AIC accept failed', e?.errors?.[0]);
  }
}
async function handleAircUpdate(req, res, id) {
  const body = await readJson(req);
  try {
    const r = await duffel.airlineInitiatedChanges.update(id, body);
    return send(res, 200, { ok: true, change: r.data });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'AIC update failed', e?.errors?.[0]);
  }
}

// ---------- Order changes (post-booking) ----------
async function handleOrderChangeRequestCreate(req, res, orderId) {
  const body = await readJson(req);
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  const slices = body.slices;
  if (!Array.isArray(slices) || !slices.length) return err(res, 422, 'VALIDATION_ERROR', 'slices required');
  try {
    const r = await duffel.orderChangeRequests.create({ order_id: o.duffelOrderId, slices });
    return send(res, 200, { change_request_id: r.data.id, status: r.data.status || null });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'change request failed', e?.errors?.[0]);
  }
}
async function handleOrderChangeOffersList(req, res, orderId, query) {
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  const reqId = query.request_id || query.order_change_request_id;
  if (!reqId) return err(res, 422, 'VALIDATION_ERROR', 'request_id required');
  try {
    const r = await duffel.orderChangeOffers.list({ order_change_request_id: reqId, sort: 'total_amount' });
    const offers = (r.data || []).map((co) => ({
      id: co.id,
      change_total_amount: co.change_total_amount,
      change_total_currency: co.change_total_currency,
      new_total_amount: co.new_total_amount,
      new_total_currency: co.new_total_currency,
      penalty_amount: co.penalty_total_amount,
      penalty_currency: co.penalty_total_currency,
      refund_to: co.refund_to,
      expires_at: co.expires_at,
      slices: (co.slices && co.slices.add || []).map(sliceSummary),
    }));
    return send(res, 200, { offers });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'change offers list failed', e?.errors?.[0]);
  }
}
async function handleOrderChangeConfirm(req, res, orderId) {
  const body = await readJson(req);
  const o = await prisma.order.findUnique({ where: { id: orderId } });
  if (!o) return err(res, 404, 'NOT_FOUND', 'order not found');
  const u = await getCurrentUser(req);
  if (o.userId && (!u || u.id !== o.userId)) return err(res, 403, 'FORBIDDEN', 'not your order');
  const offerId = body.selected_order_change_offer || body.order_change_offer_id;
  if (!offerId) return err(res, 422, 'VALIDATION_ERROR', 'selected_order_change_offer required');
  try {
    const created = await duffel.orderChanges.create({ selected_order_change_offer: offerId });
    const confirmed = await duffel.orderChanges.confirm(created.data.id);
    await prisma.orderEvent.create({
      data: { orderId: o.id, source: 'user', type: 'order.changed', payload: JSON.stringify({ change_id: confirmed.data.id }) },
    });
    await prisma.order.update({ where: { id: o.id }, data: { status: 'changed', updatedAt: new Date() } });
    return send(res, 200, { ok: true, change_id: confirmed.data.id, status: confirmed.data.status });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'change confirm failed', e?.errors?.[0]);
  }
}

// ---------- Partial Offer Requests ----------
// Lets the user pick flights slice-by-slice instead of seeing combined offers.
async function handlePartialOfferRequestCreate(req, res) {
  const body = await readJson(req);
  if (!body.slices || !body.passengers) return err(res, 422, 'VALIDATION_ERROR', 'slices, passengers required');
  try {
    const r = await duffel.partialOfferRequests.create({
      slices: body.slices,
      passengers: body.passengers,
      cabin_class: body.cabin_class || 'economy',
    });
    return send(res, 200, { partial_offer_request_id: r.data.id, slices: r.data.slices || [] });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'partial offer request failed', e?.errors?.[0]);
  }
}
async function handlePartialOfferRequestGet(req, res, id) {
  try {
    const r = await duffel.partialOfferRequests.get(id);
    return send(res, 200, { data: r.data });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'partial offer fetch failed', e?.errors?.[0]);
  }
}
async function handlePartialOfferFares(req, res, id) {
  const body = await readJson(req);
  const selected = body.selected_partial_offers || body.partial_offer_ids;
  if (!Array.isArray(selected) || !selected.length) return err(res, 422, 'VALIDATION_ERROR', 'selected_partial_offers (array) required');
  try {
    const r = await duffel.partialOfferRequests.getFaresById(id, { selected_partial_offer: selected });
    return send(res, 200, { offers: (r.data && r.data.offers || []).map((o) => offerSummary(o)) });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'partial fares failed', e?.errors?.[0]);
  }
}

// ---------- Batch Offer Requests ----------
// Async variant of offerRequests.create — useful for very wide date matrices.
// Returns a request ID immediately; client polls /batch/:id until ready.
async function handleBatchOfferRequestCreate(req, res) {
  const body = await readJson(req);
  if (!body.slices || !body.passengers) return err(res, 422, 'VALIDATION_ERROR', 'slices, passengers required');
  try {
    const r = await duffel.batchOfferRequests.create({
      slices: body.slices,
      passengers: body.passengers,
      cabin_class: body.cabin_class || 'economy',
    });
    return send(res, 200, { batch_id: r.data.id, status: r.data.status });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'batch offer request failed', e?.errors?.[0]);
  }
}
async function handleBatchOfferRequestGet(req, res, id) {
  try {
    const r = await duffel.batchOfferRequests.get(id);
    const offers = (r.data && r.data.offers || []).slice(0, 50).map((o) => offerSummary(o));
    return send(res, 200, {
      batch_id: r.data.id, status: r.data.status,
      count: offers.length, offers,
    });
  } catch (e) {
    return err(res, 502, 'DUFFEL_ERROR', e?.errors?.[0]?.message || 'batch fetch failed', e?.errors?.[0]);
  }
}

// ---------- Webhooks ----------
function verifyDuffelSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const parts = header.split(',').reduce((a, p) => { const [k, v] = p.split('='); if (k && v) a[k.trim()] = v.trim(); return a; }, {});
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  if (expected.length !== parts.v1.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}
async function handleWebhook(req, res) {
  const raw = await readRawBody(req);
  const sig = req.headers['duffel-signature'] || req.headers['x-duffel-signature'];
  const secret = process.env.DUFFEL_WEBHOOK_SECRET;
  if (secret && !verifyDuffelSignature(raw, sig, secret)) return err(res, 401, 'INVALID_SIGNATURE', 'bad signature');
  let event;
  try { event = JSON.parse(raw); } catch { return err(res, 400, 'BAD_BODY', 'invalid JSON'); }
  await prisma.webhookEvent.upsert({
    where: { duffelEventId: event.id },
    create: { duffelEventId: event.id, type: event.type, liveMode: !!event.live_mode, payload: raw, receivedAt: new Date() },
    update: {},
  });
  await processWebhookEvent(event).catch((e) => console.error('[webhook]', e.message));
  return send(res, 200, { ok: true });
}
async function processWebhookEvent(event) {
  const meta = event?.data?.object?.metadata || event?.data?.metadata;
  const internalId = meta?.internal_order_id;
  if (!internalId) return;
  const handlers = {
    'order.created': async () => { await prisma.order.update({ where: { id: internalId }, data: { status: 'confirmed' } }).catch(() => {}); },
    'order.updated': async () => { const snap = event.data?.object; if (snap) await prisma.order.update({ where: { id: internalId }, data: { rawSnapshot: JSON.stringify(snap) } }).catch(() => {}); },
    'order.airline_initiated_change_detected': async () => { await prisma.order.update({ where: { id: internalId }, data: { status: 'schedule_changed' } }).catch(() => {}); },
    'order.cancelled': async () => { await prisma.order.update({ where: { id: internalId }, data: { status: 'cancelled', cancelledAt: new Date() } }).catch(() => {}); },
  };
  if (handlers[event.type]) await handlers[event.type]();
  await prisma.webhookEvent.updateMany({ where: { duffelEventId: event.id }, data: { processedAt: new Date() } });
  await prisma.orderEvent.create({ data: { orderId: internalId, source: 'webhook', type: event.type, payload: JSON.stringify(event) } }).catch(() => {});
}

// ---------- Router ----------
async function handle(req, res, urlPath, urlQuery) {
  try {
    if (urlPath === '/skybox-api/health' && req.method === 'GET') return await handleHealth(req, res), true;
    if (urlPath === '/skybox-api/places' && req.method === 'GET') return await handlePlaces(req, res, urlQuery), true;

    if (urlPath === '/skybox-api/auth/login' && req.method === 'POST') return await handleAuthLogin(req, res), true;
    if (urlPath === '/skybox-api/auth/me' && req.method === 'GET') return await handleAuthMe(req, res), true;
    if (urlPath === '/skybox-api/auth/logout' && req.method === 'POST') return await handleAuthLogout(req, res), true;
    if (urlPath === '/auth/verify' && req.method === 'GET') return await handleAuthVerify(req, res, urlQuery), true;

    if (urlPath === '/skybox-api/flights/search' && req.method === 'POST') return await handleFlightsSearch(req, res), true;
    if (urlPath === '/skybox-api/flights/offer-requests' && req.method === 'GET') return await handleOfferRequestList(req, res, urlQuery), true;
    const orqM = urlPath.match(/^\/skybox-api\/flights\/offer-requests\/([^/]+)$/);
    if (orqM && req.method === 'GET') return await handleOfferRequestGet(req, res, orqM[1]), true;
    if (urlPath === '/skybox-api/flights/offers' && req.method === 'GET') return await handleOffersList(req, res, urlQuery), true;
    const offerM = urlPath.match(/^\/skybox-api\/flights\/offers\/([^/]+)$/);
    if (offerM && req.method === 'GET') return await handleOfferGet(req, res, offerM[1]), true;
    const offerPriceM = urlPath.match(/^\/skybox-api\/flights\/offers\/([^/]+)\/price$/);
    if (offerPriceM && req.method === 'POST') return await handleOfferPrice(req, res, offerPriceM[1]), true;
    const offerPaxM = urlPath.match(/^\/skybox-api\/flights\/offers\/([^/]+)\/passengers\/([^/]+)$/);
    if (offerPaxM && req.method === 'PATCH') return await handleOfferPassengerUpdate(req, res, offerPaxM[1], offerPaxM[2]), true;
    const seatM = urlPath.match(/^\/skybox-api\/flights\/offers\/([^/]+)\/seat-maps$/);
    if (seatM && req.method === 'GET') return await handleSeatMaps(req, res, seatM[1]), true;

    if (urlPath === '/skybox-api/sessions' && req.method === 'POST') return await handleSessionCreate(req, res), true;
    const sM = urlPath.match(/^\/skybox-api\/sessions\/([^/]+)$/);
    if (sM && req.method === 'GET') return await handleSessionGet(req, res, sM[1]), true;
    if (sM && req.method === 'PATCH') return await handleSessionPatch(req, res, sM[1]), true;
    const piM = urlPath.match(/^\/skybox-api\/sessions\/([^/]+)\/payment-intent$/);
    if (piM && req.method === 'POST') return await handlePaymentIntentCreate(req, res, piM[1]), true;
    const cM = urlPath.match(/^\/skybox-api\/sessions\/([^/]+)\/confirm$/);
    if (cM && req.method === 'POST') return await handleSessionConfirm(req, res, cM[1]), true;

    if (urlPath === '/skybox-api/orders' && req.method === 'GET') return await handleOrdersList(req, res), true;
    const oM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)$/);
    if (oM && req.method === 'GET') return await handleOrderGet(req, res, oM[1]), true;
    const ocM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/cancel$/);
    if (ocM && req.method === 'POST') return await handleOrderCancel(req, res, ocM[1]), true;
    // v2 split cancellation: quote → confirm
    const ocqM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/cancellation$/);
    if (ocqM && req.method === 'POST') return await handleOrderCancellationQuote(req, res, ocqM[1]), true;
    const occM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/cancellation\/([^/]+)\/confirm$/);
    if (occM && req.method === 'POST') return await handleOrderCancellationConfirm(req, res, occM[1], occM[2]), true;
    if (urlPath === '/skybox-api/cancellations' && req.method === 'GET') return await handleCancellationsList(req, res, urlQuery), true;
    const ocgM = urlPath.match(/^\/skybox-api\/cancellations\/([^/]+)$/);
    if (ocgM && req.method === 'GET') return await handleCancellationGet(req, res, ocgM[1]), true;
    // Airline-initiated changes
    if (urlPath === '/skybox-api/airline-initiated-changes' && req.method === 'GET') return await handleAircList(req, res, urlQuery), true;
    const aicAccM = urlPath.match(/^\/skybox-api\/airline-initiated-changes\/([^/]+)\/accept$/);
    if (aicAccM && req.method === 'POST') return await handleAircAccept(req, res, aicAccM[1]), true;
    const aicUpdM = urlPath.match(/^\/skybox-api\/airline-initiated-changes\/([^/]+)$/);
    if (aicUpdM && req.method === 'PATCH') return await handleAircUpdate(req, res, aicUpdM[1]), true;

    // Order changes
    const cgM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/changes$/);
    if (cgM && req.method === 'POST') return await handleOrderChangeRequestCreate(req, res, cgM[1]), true;
    const cgOffersM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/change-offers$/);
    if (cgOffersM && req.method === 'GET') return await handleOrderChangeOffersList(req, res, cgOffersM[1], urlQuery), true;
    const cgConfirmM = urlPath.match(/^\/skybox-api\/orders\/([^/]+)\/changes\/confirm$/);
    if (cgConfirmM && req.method === 'POST') return await handleOrderChangeConfirm(req, res, cgConfirmM[1]), true;

    // Partial Offer Requests
    if (urlPath === '/skybox-api/flights/partial-offer-requests' && req.method === 'POST') return await handlePartialOfferRequestCreate(req, res), true;
    const porGetM = urlPath.match(/^\/skybox-api\/flights\/partial-offer-requests\/([^/]+)$/);
    if (porGetM && req.method === 'GET') return await handlePartialOfferRequestGet(req, res, porGetM[1]), true;
    const porFaresM = urlPath.match(/^\/skybox-api\/flights\/partial-offer-requests\/([^/]+)\/fares$/);
    if (porFaresM && req.method === 'POST') return await handlePartialOfferFares(req, res, porFaresM[1]), true;

    // Batch Offer Requests
    if (urlPath === '/skybox-api/flights/batch-offer-requests' && req.method === 'POST') return await handleBatchOfferRequestCreate(req, res), true;
    const borM = urlPath.match(/^\/skybox-api\/flights\/batch-offer-requests\/([^/]+)$/);
    if (borM && req.method === 'GET') return await handleBatchOfferRequestGet(req, res, borM[1]), true;

    if (urlPath === '/skybox-api/webhooks/duffel' && req.method === 'POST') return await handleWebhook(req, res), true;

    return false;
  } catch (e) {
    console.error('[duffel-routes] uncaught:', e);
    err(res, 500, 'INTERNAL', e.message);
    return true;
  }
}
module.exports = { handle };
