# ---- Build stage ----
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder
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
 && test -f src/database/sqlite/sqlite3.wasm \
 && npx tsc --rootDir src --outDir dist/src \
 && node -e "const fs=require('fs'),p=require('path');const s='src/database/sqlite',d='dist/src/database/sqlite';fs.mkdirSync(d,{recursive:true});for(const f of ['sqlite3.wasm','sqlite3-node.mjs'])fs.copyFileSync(p.join(s,f),p.join(d,f));"
WORKDIR /build

# ---- Production stage ----
FROM gcr.io/distroless/nodejs22-debian12@sha256:8a3e96fe3345b5d83ecec2066e7c498139a02a6d1214e4f6c39f9ce359f3f5bc AS runtime
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
