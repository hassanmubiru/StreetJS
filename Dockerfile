# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /build

# Copy root package files for workspace resolution
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/

RUN npm ci

# Copy core package source
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/tsconfig.lib.json packages/core/
COPY packages/core/src packages/core/src

# Build the runnable app (emits dist/src/** including main.js + copies SQLite wasm)
RUN npm run build:app -w packages/core

# ---- Production stage ----
FROM gcr.io/distroless/nodejs20-debian12 AS runtime
WORKDIR /app

# Copy compiled output
COPY --from=builder /build/packages/core/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/core/package.json ./package.json

# Migrations are plain SQL, copy as-is
COPY packages/core/migrations ./migrations

# Non-root execution (distroless runs as nonroot by default uid=65532)
# Upload directory is created at runtime by MultipartParser
USER nonroot

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["/nodejs/bin/node", "dist/main.js"]
