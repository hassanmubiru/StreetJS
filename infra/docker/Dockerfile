# ---- Build stage ----
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder
WORKDIR /build

# Copy root package files for workspace resolution. First-party workspace
# dependencies of core (e.g. @streetjs/cache) must have their package.json
# present so `npm ci` links them.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/cli/package.json packages/cli/
COPY packages/container/package.json packages/container/
COPY packages/exceptions/package.json packages/exceptions/
COPY packages/diagnostics/package.json packages/diagnostics/
COPY packages/store/package.json packages/store/
COPY packages/cache/package.json packages/cache/
COPY packages/session/package.json packages/session/
COPY packages/security/package.json packages/security/
COPY packages/websocket/package.json packages/websocket/
COPY packages/xss/package.json packages/xss/
COPY packages/multipart/package.json packages/multipart/
COPY packages/context/package.json packages/context/
COPY packages/ratelimit/package.json packages/ratelimit/
COPY packages/webhook-dispatcher/package.json packages/webhook-dispatcher/
COPY packages/telemetry/package.json packages/telemetry/
COPY packages/cluster/package.json packages/cluster/
COPY packages/postgres/package.json packages/postgres/
COPY packages/pool/package.json packages/pool/
COPY packages/schema-inspector/package.json packages/schema-inspector/
COPY packages/migrations/package.json packages/migrations/
COPY packages/repository/package.json packages/repository/

RUN npm ci

# Copy source for core and its first-party workspace dependencies.
COPY packages/core/tsconfig.json packages/core/
COPY packages/core/tsconfig.lib.json packages/core/
COPY packages/core/src packages/core/src
COPY packages/container/tsconfig.json packages/container/
COPY packages/container/src packages/container/src
COPY packages/exceptions/tsconfig.json packages/exceptions/
COPY packages/exceptions/src packages/exceptions/src
COPY packages/diagnostics/tsconfig.json packages/diagnostics/
COPY packages/diagnostics/src packages/diagnostics/src
COPY packages/store/tsconfig.json packages/store/
COPY packages/store/src packages/store/src
COPY packages/cache/tsconfig.json packages/cache/
COPY packages/cache/src packages/cache/src
COPY packages/session/tsconfig.json packages/session/
COPY packages/session/src packages/session/src
COPY packages/security/tsconfig.json packages/security/
COPY packages/security/src packages/security/src
COPY packages/websocket/tsconfig.json packages/websocket/
COPY packages/websocket/src packages/websocket/src
COPY packages/xss/tsconfig.json packages/xss/
COPY packages/xss/src packages/xss/src
COPY packages/multipart/tsconfig.json packages/multipart/
COPY packages/multipart/src packages/multipart/src
COPY packages/context/tsconfig.json packages/context/
COPY packages/context/src packages/context/src
COPY packages/webhook-dispatcher/tsconfig.json packages/webhook-dispatcher/
COPY packages/webhook-dispatcher/src packages/webhook-dispatcher/src
COPY packages/telemetry/tsconfig.json packages/telemetry/
COPY packages/telemetry/src packages/telemetry/src
COPY packages/cluster/tsconfig.json packages/cluster/
COPY packages/cluster/src packages/cluster/src
COPY packages/postgres/tsconfig.json packages/postgres/
COPY packages/postgres/src packages/postgres/src
COPY packages/pool/tsconfig.json packages/pool/
COPY packages/pool/src packages/pool/src
COPY packages/schema-inspector/tsconfig.json packages/schema-inspector/
COPY packages/schema-inspector/src packages/schema-inspector/src
COPY packages/migrations/tsconfig.json packages/migrations/
COPY packages/migrations/src packages/migrations/src
COPY packages/repository/tsconfig.json packages/repository/
COPY packages/repository/src packages/repository/src

# Build core's first-party workspace dependencies first (so their compiled
# output exists when core is type-checked and at runtime).
WORKDIR /build/packages/container
RUN npx tsc
WORKDIR /build/packages/exceptions
RUN npx tsc
WORKDIR /build/packages/diagnostics
RUN npx tsc
WORKDIR /build/packages/store
RUN npx tsc
WORKDIR /build/packages/cache
RUN npx tsc
WORKDIR /build/packages/session
RUN npx tsc
WORKDIR /build/packages/security
RUN npx tsc
WORKDIR /build/packages/websocket
RUN npx tsc
WORKDIR /build/packages/xss
RUN npx tsc
WORKDIR /build/packages/multipart
RUN npx tsc
WORKDIR /build/packages/context
RUN npx tsc
WORKDIR /build/packages/webhook-dispatcher
RUN npx tsc
WORKDIR /build/packages/telemetry
RUN npx tsc
WORKDIR /build/packages/cluster
RUN npx tsc
WORKDIR /build/packages/postgres
RUN npx tsc
WORKDIR /build/packages/pool
RUN npx tsc
WORKDIR /build/packages/schema-inspector
RUN npx tsc
WORKDIR /build/packages/migrations
RUN npx tsc
WORKDIR /build/packages/repository
RUN npx tsc

# Build the runnable app server with an explicit layout (emits dist/src/**,
# including main.js) and copy the SQLite wasm assets alongside it.
WORKDIR /build/packages/core
RUN node src/database/sqlite/download-wasm.mjs \
 && test -f src/database/sqlite/sqlite3.wasm \
 && npx tsc --rootDir src --outDir dist/src \
 && node -e "const fs=require('fs'),p=require('path');const s='src/database/sqlite',d='dist/src/database/sqlite';fs.mkdirSync(d,{recursive:true});for(const f of ['sqlite3.wasm','sqlite3-node.mjs'])fs.copyFileSync(p.join(s,f),p.join(d,f));"
WORKDIR /build

# The distroless runtime stage copies node_modules but not packages/*, so
# replace the workspace symlinks for first-party deps with their real files,
# keeping the runtime image self-contained.
RUN for pkg in container exceptions diagnostics store cache session security websocket xss multipart context webhook-dispatcher telemetry cluster postgres pool schema-inspector migrations repository; do \
      rm -rf "node_modules/@streetjs/$pkg" \
   && mkdir -p "node_modules/@streetjs/$pkg" \
   && cp -R "packages/$pkg/dist" "packages/$pkg/package.json" "node_modules/@streetjs/$pkg/"; \
    done

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
