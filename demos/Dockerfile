# Shared image for the StreetJS showcase demos. One image runs ANY reference app,
# selected at runtime via $DEMO_APP. Build context is the repo root:
#   docker build -f demos/Dockerfile -t streetjs-demos .
#
# Not distroless on purpose — the demo entrypoint runs an arbitrary example
# server.mjs and benefits from a shell. For the framework's own production image
# see the distroless root Dockerfile.
FROM node:26-alpine@sha256:725aeba2364a9b16beae49e180d83bd597dbd0b15c47f1f28875c290bfd255b9
WORKDIR /app

# Restore deps from the lockfile (workspace symlinks), then build the packages the
# reference apps import. `streetjs` (core) is required by all; the others back
# specific demos (admin → saas/crm, ai → ai-assistant, plugin-htmx → htmx-dashboard,
# commerce → ecommerce, dating-profiles → dating).
COPY . .
RUN npm ci \
 && npm run build -w packages/core \
 && npm run build -w packages/admin \
 && npm run build -w packages/ai \
 && npm run build -w packages/commerce \
 && npm run build -w packages/dating-profiles \
 && npm run build -w packages/plugin-htmx \
 && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=3000
# Which reference app to run (override per service in docker-compose.yml).
ENV DEMO_APP=saas
EXPOSE 3000

# Health endpoints are exposed by every reference app at /health/live + /health/ready.
HEALTHCHECK --interval=15s --timeout=4s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health/ready" >/dev/null 2>&1 || exit 1

# `exec` so the node process is PID 1 and receives signals for clean shutdown.
ENTRYPOINT ["sh", "-c", "exec node examples/reference-apps/${DEMO_APP}/server.mjs"]
