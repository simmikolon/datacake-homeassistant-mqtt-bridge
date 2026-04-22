# syntax=docker/dockerfile:1

# ---- Builder stage ------------------------------------------------------------
# Builds TypeScript, copies views, and compiles Tailwind CSS. The `build` step
# needs dev dependencies, which we drop from the runtime image below.
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# better-sqlite3 compiles a native addon, so we need the C toolchain here. Keep
# the list minimal; node-gyp pulls in Python automatically via the base image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential \
      python3 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json tailwind.config.js ./
COPY scripts ./scripts
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev


# ---- Runtime stage ------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/bridge.db

WORKDIR /app

# Add a non-root user that owns the persistent data volume.
RUN groupadd --system --gid 1001 app \
    && useradd  --system --uid 1001 --gid app --home /app app \
    && mkdir -p /data \
    && chown -R app:app /app /data

COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

USER app

VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
