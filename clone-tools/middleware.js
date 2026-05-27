// Request IDs, structured logging, rate limit, idempotency, security headers.
const crypto = require('crypto');

function log(level, msg, fields = {}) {
  const line = Object.assign({ ts: new Date().toISOString(), level, msg }, fields);
  try { process.stdout.write(JSON.stringify(line) + '\n'); } catch { console.log(level, msg, fields); }
}
const logger = { info: (m, f) => log('info', m, f), warn: (m, f) => log('warn', m, f), error: (m, f) => log('error', m, f) };

const RATE = new Map();
function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const arr = RATE.get(key) || [];
  while (arr.length && arr[0] < now - windowMs) arr.shift();
  if (arr.length >= limit) { RATE.set(key, arr); return { allowed: false, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) }; }
  arr.push(now); RATE.set(key, arr);
  return { allowed: true };
}
const RATE_RULES = [
  { match: /^\/skybox-api\/flights\/search$/, limit: 30, windowMs: 5 * 60 * 1000 },
  { match: /^\/skybox-api\/sessions\/[^/]+\/confirm$/, limit: 10, windowMs: 10 * 60 * 1000 },
  { match: /^\/skybox-api\/auth\/login$/, limit: 5, windowMs: 10 * 60 * 1000 },
];

const IDEM = new Map();
function idemGet(k) { const r = IDEM.get(k); if (!r || r.expiresAt < Date.now()) { IDEM.delete(k); return null; } return r; }
function idemSet(k, status, body) { IDEM.set(k, { status, body, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }); }
setInterval(() => { const now = Date.now(); for (const [k, v] of IDEM) if (v.expiresAt < now) IDEM.delete(k); }, 5 * 60 * 1000).unref?.();

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://js.skyscnr.com https://content.skyscnr.com https://js.duffel.com",
  "style-src 'self' 'unsafe-inline' https://js.skyscnr.com https://js.duffel.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://js.skyscnr.com",
  "connect-src 'self' https://api.duffel.com https://js.skyscnr.com https://content.skyscnr.com",
  "frame-src 'self' https://*.duffel.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

function wrap(handler) {
  return async function (req, res) {
    const start = Date.now();
    const requestId = crypto.randomBytes(8).toString('base64url');
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=(self)');
    if (req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    const u = new URL(req.url, 'http://localhost');
    const pathname = u.pathname;

    if (pathname.startsWith('/skybox-api/')) {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
      for (const rule of RATE_RULES) {
        if (!rule.match.test(pathname)) continue;
        const r = rateLimit(`${ip}:${pathname}`, rule.limit, rule.windowMs);
        if (!r.allowed) {
          res.setHeader('Retry-After', String(r.retryAfter));
          res.statusCode = 429;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'too many requests', details: { retry_after_s: r.retryAfter } } }));
          logger.warn('rate_limited', { requestId, ip, path: pathname });
          return;
        }
      }
    }

    const idemKey = req.headers['idempotency-key'];
    if (idemKey && req.method === 'POST' && pathname.startsWith('/skybox-api/')) {
      const cached = idemGet(idemKey);
      if (cached) {
        res.statusCode = cached.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('X-Idempotent-Replay', 'true');
        res.end(cached.body);
        return;
      }
      const origEnd = res.end.bind(res);
      let chunks = '';
      res.end = function (chunk) {
        if (chunk) chunks = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        if (res.statusCode >= 200 && res.statusCode < 300) idemSet(idemKey, res.statusCode, chunks);
        return origEnd(chunk);
      };
    }

    try { await handler(req, res); }
    catch (e) {
      logger.error('uncaught', { requestId, path: pathname, msg: e.message });
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'internal error', requestId } }));
      }
    } finally {
      const dur = Date.now() - start;
      const lvl = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      log(lvl, 'http', { requestId, method: req.method, path: pathname, status: res.statusCode, durationMs: dur });
    }
  };
}
module.exports = { wrap, logger };
