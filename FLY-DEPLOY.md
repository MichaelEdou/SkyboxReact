# Deploy Skybox Global to Fly.io

This repo is wired for one-command Fly deploys. The Node server, captured
site assets, Prisma + SQLite, and the Duffel live integration all run as a
single container with a persistent volume.

## One-time setup (5 minutes)

```bash
# 1. Install the Fly CLI.
#    Windows (PowerShell):
iwr https://fly.io/install.ps1 -useb | iex
#    macOS / Linux:
curl -L https://fly.io/install.sh | sh

# 2. Sign up + log in (browser opens).
fly auth signup     # or `fly auth login` if you already have an account

# 3. Create the app (skip if you've already run `fly launch`).
#    Pick a unique name — replace `skybox-global` everywhere if it's taken.
fly apps create skybox-global

# 4. Create a 1 GB volume for the SQLite database.
fly volumes create skybox_data --size 1 --region yyz --app skybox-global

# 5. Set production secrets. The Duffel key MUST be live mode.
#    Use the value from your local .env (clone-tools/.env, DUFFEL_API_KEY=...).
fly secrets set --app skybox-global \
  DUFFEL_API_KEY="$(grep -E '^DUFFEL_API_KEY=' clone-tools/.env | cut -d= -f2-)" \
  DUFFEL_LIVE_MODE=true \
  DATABASE_URL=file:/data/skybox.db \
  APP_URL=https://skybox-global.fly.dev \
  SESSION_SECRET=$(openssl rand -hex 32) \
  ADMIN_TOKEN=$(openssl rand -hex 24)

# (Optional) Email via Resend so booking-confirmation mails actually send:
# fly secrets set --app skybox-global RESEND_API_KEY=re_xxx FROM_EMAIL=noreply@yourdomain.com

# (Optional) Duffel webhooks: paste the secret you got when registering the webhook in Duffel.
# fly secrets set --app skybox-global DUFFEL_WEBHOOK_SECRET=whsec_xxx
```

## Deploy

```bash
fly deploy --app skybox-global
```

That builds the Dockerfile, pushes the image to Fly's registry, runs
`prisma migrate deploy` on boot, and starts `node serve.js` on port 8080.

The first deploy takes ~3 min (image is ~600 MB because of the captured site).
Subsequent deploys are ~30 s (Docker layer cache).

## Verify

```bash
# Tail logs (Ctrl-C to detach).
fly logs --app skybox-global

# Hit the health endpoint.
curl https://skybox-global.fly.dev/skybox-api/health
# -> {"ok":true,"live_mode":true,"sample_airline":"…"}

# Open the live site in the browser.
fly open --app skybox-global
```

## Custom domain (optional, ~2 min)

```bash
# Point your DNS A/AAAA records as Fly tells you:
fly certs create --app skybox-global skybox.yourdomain.com
# Fly will print the DNS records you need to add. Add them, then:
fly certs check --app skybox-global skybox.yourdomain.com
# Once "Ready", https://skybox.yourdomain.com is live with auto-renewing TLS.
```

If you don't have a domain handy, the default `https://skybox-global.fly.dev`
works fine for a client demo.

## Switching SQLite → Neon Postgres (for production scale)

SQLite on the Fly volume is fine for demos and low-traffic production. To
move to Neon's free Postgres tier when you outgrow it:

1. Create a project at <https://neon.tech>, copy the **pooled** connection string.
2. Edit `clone-tools/prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"
     url      = env("DATABASE_URL")
   }
   ```
3. Push the new URL and redeploy:
   ```bash
   fly secrets set --app skybox-global DATABASE_URL="postgresql://user:pass@…neon.tech/skybox?sslmode=require"
   fly deploy --app skybox-global
   ```

No code changes needed — Prisma handles the swap.

## What's NOT shipped (and where to add later)

| Concern | Status |
| --- | --- |
| Email (booking confirmations, magic-link sign-in) | Stubbed; wire `RESEND_API_KEY` to enable. |
| Card 3DS challenge flow | Duffel handles in their card form; works as-is in live mode. |
| Webhook idempotency | Already implemented (HMAC signature + duplicate-event guard via `WebhookEvent` table). |
| Background jobs (cron, retry queue) | None needed; Fly machines auto-restart on crash. |
| CDN for `/_ext/` assets | Fly's edge handles this. Optional Cloudflare layer if you want longer cache. |

## Troubleshooting

**`prisma generate` error on boot** — the Docker layer cache may have a stale
`@prisma/client`. Rebuild with `fly deploy --no-cache --app skybox-global`.

**`DUFFEL_API_KEY missing` on startup** — make sure you ran `fly secrets set`
BEFORE the first `fly deploy`. Re-run secrets, then `fly machine restart`.

**Cold-start on free tier** — `min_machines_running = 1` in `fly.toml` keeps
one machine warm, so no cold starts. Costs ~$1.94/mo if you exceed the
free monthly compute allowance (256 MB × 730 hrs is free).

**Health check fails** — verify `/skybox-api/health` returns 200 locally
first (`node clone-tools/serve.js`, then `curl localhost:8088/skybox-api/health`).
