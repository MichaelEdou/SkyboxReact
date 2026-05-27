// Static + SPA fallback + Skyscanner telemetry stubs + Duffel API surface.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { wrap, logger } = require('./middleware');

let duffelRoutes = null;
try { duffelRoutes = require('./duffel-routes'); console.log('[serve] /skybox-api/* mounted'); }
catch (e) { console.warn('[serve] Duffel routes disabled:', e.message); }

const ROOT = process.argv[2] || path.resolve(__dirname, '..', 'goClone', 'www.skyscanner.ca');
const PORT = parseInt(process.argv[3] || process.env.APP_PORT || process.env.PORT || '8088', 10);

const MIME = {
  '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8',
  '.js':'application/javascript; charset=utf-8','.mjs':'application/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.gif':'image/gif','.webp':'image/webp','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.otf':'font/otf',
  '.eot':'application/vnd.ms-fontobject','.map':'application/json; charset=utf-8',
  '.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8',
};
const STUBS = ['/500.ashx','/g/','/wmd/','/sapi/','/slipstream','/api/','/rf8vapwA/','/wgam-collect','/_next/data/'];
const isStub = (p) => STUBS.some((x) => p.startsWith(x));

const ALIASES = [
  // Skybox custom pages — checked BEFORE vertical fallbacks.
  [/^\/flights\/search(\/|$|\?)/,        'skybox-flights-search.html'],
  [/^\/flights\/offer\/[^/]+(\/|$|\?)/,  'skybox-offer.html'],
  [/^\/flights\/confirmation\/[^/]+(\/|$|\?)/, 'skybox-confirmation.html'],
  [/^\/trips$/,                          'skybox-trips.html'],
  [/^\/trips\/[^/]+(\/|$|\?)/,           'skybox-trip.html'],
  // Vertical fallbacks for Skyscanner-style URLs.
  [/^\/carhire(\/|$)/,                   'car-rental/index.html'],
  [/^\/car-rental\/results(\/|$)/,       'car-rental/index.html'],
  [/^\/transport\/flights(\/|$)/,        'flights/index.html'],
  [/^\/flights-from(\/|$)/,              'flights/index.html'],
  [/^\/flights-to(\/|$)/,                'flights/index.html'],
  [/^\/hotels\/deals/,                   'hotels/index.html'],
  [/^\/hotels\/[a-z-]+(\/|$)/,           'hotels/index.html'],
  [/^\/help(\/|$)/,                      '_ext/help.skyscanner.net/hc/en-gb/index.html'],
  [/^\/explore-ai(\/|$)/,                'index.html'],
];
function resolveRoute(root, pathname) {
  for (const [re, target] of ALIASES) {
    if (re.test(pathname)) {
      const c = path.join(root, ...target.split('/'));
      if (fs.existsSync(c)) return c;
    }
  }
  return null;
}
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const full = path.normalize(path.join(root, decoded));
  if (!full.startsWith(path.normalize(root))) return null;
  return full;
}

const server = http.createServer(wrap(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const pathname = u.pathname;
  const query = Object.fromEntries(u.searchParams.entries());

  if (duffelRoutes && (pathname.startsWith('/skybox-api/') || pathname === '/auth/verify')) {
    const handled = await duffelRoutes.handle(req, res, pathname, query);
    if (handled) return;
  }

  // Skybox is flights-only. Any path under the deleted Hotels/Cars verticals
  // redirects to /flights so users can't get stuck on a 404.
  if (/^\/(hotels|car-rental|carhire|car-rental-in|transport\/(hotels|cars))(\/|$|\?)/.test(pathname)) {
    res.writeHead(302, { Location: '/flights', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (isStub(pathname)) {
    const body = pathname.endsWith('.js') ? '/* stubbed */' : '{}';
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.js') ? 'application/javascript' : 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
    return res.end(body);
  }

  let full = safeJoin(ROOT, req.url);
  if (!full) { res.writeHead(400); return res.end('bad path'); }

  fs.stat(full, (err, stat) => {
    if (!err && stat.isDirectory()) full = path.join(full, 'index.html');
    else if (err) {
      const ext = path.extname(pathname);
      if (!ext) {
        const aliased = resolveRoute(ROOT, pathname);
        if (aliased) full = aliased;
        else {
          let segs = pathname.split('/').filter(Boolean);
          let found = null;
          while (segs.length) {
            const c = path.join(ROOT, ...segs, 'index.html');
            if (fs.existsSync(c)) { found = c; break; }
            segs.pop();
          }
          full = found || path.join(ROOT, 'index.html');
        }
      }
    }
    fs.readFile(full, (e2, buf) => {
      if (e2) {
        const ext = path.extname(pathname).toLowerCase();
        if (['.png','.jpg','.jpeg','.gif','.webp','.bmp','.ico'].includes(ext)) {
          const px = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          return res.end(px);
        }
        if (ext === '.svg') { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end('<svg xmlns="http://www.w3.org/2000/svg"/>'); }
        if (ext === '.js' || ext === '.mjs') { res.writeHead(200, { 'Content-Type': 'application/javascript' }); return res.end('/* stubbed */'); }
        if (ext === '.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end('/* stubbed */'); }
        if (ext === '.json') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end('{}'); }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('not found: ' + req.url);
      }
      const mime = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      res.end(buf);
    });
  });
}));
server.listen(PORT, () => console.log(`[serve] http://localhost:${PORT}/  (root=${ROOT})`));
