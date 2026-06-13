# ---- Build stage ----
FROM node:26-alpine@sha256:3ad34ca6292aec4a91d8ddeb9229e29d9c2f689efd0dd242860889ac71842eba AS builder
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

# Build the runnable app server with an explicit layout (emits dist/src/**,
# including main.js) and copy the SQLite wasm assets alongside it.
WORKDIR /build/packages/core
RUN node src/database/sqlite/download-wasm.mjs \
 && npx tsc --rootDir src --outDir dist/src \
 && node -e "const fs=require('fs'),p=require('path');const s='src/database/sqlite',d='dist/src/database/sqlite';fs.mkdirSync(d,{recursive:true});for(const f of ['sqlite3.wasm','sqlite3-node.mjs'])fs.copyFileSync(p.join(s,f),p.join(d,f));"
WORKDIR /build

# ---- Production stage ----
FROM gcr.io/distroless/nodejs20-debian12@sha256:6fe218dbad37e979c7542e670d28d6e23d3f53d2929693bc9cdded8b622f339f AS runtime
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

ENTRYPOINT ["/nodejs/bin/node", "dist/src/main.js"]
