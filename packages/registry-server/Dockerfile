# packages/registry-server/Dockerfile
#
# Production container image for the @streetjs/registry-server Network Plugin
# Registry (Requirement 4). Build context is this package directory:
#
#   docker build -t streetjs-registry packages/registry-server
#   docker run --rm -p 8787:8787 \
#     -e STREET_REGISTRY_PUBLISHERS='[{"id":"acme","apiKey":"secret","namespaces":["acme"]}]' \
#     streetjs-registry
#
# The publish→install E2E verification harness (scripts/registry/e2e.mjs) runs
# the server in a container using the official node image with the repo mounted,
# which needs no image build; this Dockerfile is the canonical production image.
#
# Zero runtime deps in core; the server's only dependency is `streetjs` itself,
# installed from the npm registry at the version pinned in package.json.

FROM node:26-alpine@sha256:a2dc166a387cc6ca1e62d0c8e265e49ca985d6e60abc9fe6e6c3d6ce8e63f606 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.json ./
COPY src ./src
RUN npm ci --no-audit --no-fund \
  && npm run build

FROM node:26-alpine@sha256:a2dc166a387cc6ca1e62d0c8e265e49ca985d6e60abc9fe6e6c3d6ce8e63f606 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Install only production dependencies (streetjs core, zero further runtime deps).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist

# Non-root for least privilege.
USER node
ENV PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "dist/cli.js"]
