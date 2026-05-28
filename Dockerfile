# Skybox Global — Fly.io image
# Multi-stage: install deps in stage 1, copy only what runs in stage 2.
FROM node:20-slim AS deps
WORKDIR /app/clone-tools
COPY clone-tools/package.json clone-tools/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# --- runtime ---
FROM node:20-slim
ENV NODE_ENV=production \
    PORT=8080 \
    APP_PORT=8080
WORKDIR /app
# OpenSSL is needed by Prisma's runtime engine on Debian slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
# Bring in deps from stage 1.
COPY --from=deps /app/clone-tools/node_modules /app/clone-tools/node_modules
# Bring in the app code + the captured site that gets served.
COPY clone-tools /app/clone-tools
COPY goClone /app/goClone
# Generate the Prisma client against the schema in the image.
WORKDIR /app/clone-tools
RUN npx prisma generate
EXPOSE 8080
# Run any pending migrations on boot, then start the server.
CMD sh -c "npx prisma migrate deploy 2>&1 || true; node serve.js"
