# Skybox Global — free deployment

The clone is a plain Node http server with a SQLite-backed Prisma layer, the
Duffel SDK, and a static page tree. The whole stack runs free on any host
that accepts a Node web service.

## Stack (all free tiers)

| Need | Service | Free tier |
|---|---|---|
| Hosting | **Fly.io** (3 shared-cpu VMs, always-on) or **Render** (web service, sleeps after 15 min) | $0 |
| Postgres | **Neon** | 0.5 GB |
| Email | **Resend** | 3,000/mo, 100/day |
| Errors | **Sentry** | 5,000 errors/mo |
| Analytics | **PostHog** | 1M events/mo |
| Background jobs | **Inngest** | 50K runs/mo |
| DNS + TLS + WAF | **Cloudflare** (free) | unlimited |
| Public hostname (if you don't own a domain) | **DuckDNS** | `skybox.duckdns.org` style, free, dynamic-DNS-capable |

## DuckDNS setup (if you don't have a domain yet)

1. Sign in at <https://www.duckdns.org> with GitHub / Google / Reddit / Twitter.
2. Pick a subdomain, e.g. `skybox-global.duckdns.org`.
3. Point it at your server's public IP (or use the DuckDNS auto-update script
   if your IP is dynamic — they provide a one-liner crontab entry).
4. Set `APP_URL=https://skybox-global.duckdns.org` in `.env`.
5. If you're behind Cloudflare proxy: add the DuckDNS hostname as an
   "Authoritative DNS" record, set `proxy=true`, terminate TLS at Cloudflare
   (free Universal SSL). Otherwise use Caddy / nginx + Let's Encrypt on the
   host directly.

DuckDNS works great for personal / staging deploys. For a launch-ready
public brand you'd still want a registered domain — Porkbun, Namecheap,
Cloudflare Registrar all sell `.com`s for ~$10/year.

## Required env vars (copy from `.env.example` to `.env`)

```
DUFFEL_API_KEY=duffel_live_xxx        # required
DUFFEL_LIVE_MODE=true
DUFFEL_WEBHOOK_SECRET=                 # set after creating webhook in Duffel dashboard
APP_PORT=8088
APP_URL=https://skybox-global.duckdns.org
DATABASE_URL=postgres://...neon...     # see Neon section
SESSION_SECRET=                        # `openssl rand -base64 32`
RESEND_API_KEY=                        # optional but recommended
EMAIL_FROM="Skybox Global <no-reply@yourdomain>"
ADMIN_TOKEN=                           # `openssl rand -base64 32`
SENTRY_DSN=                            # optional
```

## Steps

1. **Fork / clone the repo** to your machine.
2. **Create Neon project**, copy pooled + direct URLs into `.env`
   (`DATABASE_URL` + `DIRECT_URL`). Edit `prisma/schema.prisma`:
   `provider = "postgresql"`. Run `npx prisma migrate dev --name init-pg`.
3. **Bundle the card form** (already in the repo as `skybox-duffel-components.js`,
   but if you change it: `npx esbuild node_modules/@duffel/components/custom-elements.js
   --bundle --format=iife --global-name=DuffelComponents
   --outfile=../goClone/www.skyscanner.ca/skybox-duffel-components.js --minify --target=es2020`).
4. **Deploy** — Fly.io example:
   ```
   fly launch --no-deploy
   # set every env var in fly secrets set
   fly secrets set DUFFEL_API_KEY=... DATABASE_URL=... SESSION_SECRET=... ADMIN_TOKEN=...
   fly deploy
   ```
   Render example: connect GitHub repo, set build command
   `npm install && npx prisma generate && npx prisma migrate deploy`, start
   command `node serve.js ../goClone/www.skyscanner.ca`.
5. **Point DuckDNS at the deploy** — copy the deploy's public IP or
   `<app>.fly.dev` URL into the DuckDNS dashboard. If your host gives you a
   `.fly.dev` / `.onrender.com` URL directly, use that as `APP_URL` instead
   of DuckDNS.
6. **Register the Duffel webhook** in the Duffel dashboard:
   - URL: `https://your-host/skybox-api/webhooks/duffel`
   - Copy the signing secret → set `DUFFEL_WEBHOOK_SECRET`
   - Subscribe to `order.*`, `payment_intent.*`, `ping`
   - Hit "Send test event" and verify it shows up in `/admin/webhooks`
7. **Cloudflare** (recommended): add the DuckDNS or registered domain,
   enable proxy, configure WAF managed rules + a rate-limit rule on
   `POST /skybox-api/flights/search` (60/min/IP is a sensible start).

## Go-live checklist

- [ ] Books a test booking end-to-end on the live key
- [ ] Refund/cancel returns the right amount per fare rules
- [ ] Webhook arrives and updates the order within 60 s
- [ ] Magic-link sign-in email arrives via Resend
- [ ] Sentry receives a deliberate test error
- [ ] Privacy / Terms / Refunds / Accessibility / Cookies pages reviewed by counsel
- [ ] PCI SAQ-A questionnaire signed
- [ ] DPAs signed with Duffel, Neon, Resend, Sentry, PostHog, Inngest, Cloudflare/Fly/Render
