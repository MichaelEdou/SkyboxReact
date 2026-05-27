require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Duffel } = require('@duffel/api');
const TOKEN = process.env.DUFFEL_API_KEY;
if (!TOKEN) { console.error('[duffel] DUFFEL_API_KEY missing in .env'); process.exit(1); }
const IS_LIVE = TOKEN.startsWith('duffel_live_');
if (IS_LIVE) console.warn('[duffel] *** LIVE mode *** — real bookings, real charges.');
const duffel = new Duffel({ token: TOKEN, debug: { verbose: false } });
module.exports = { duffel, IS_LIVE };
