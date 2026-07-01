---
layout:    default
title:     "Docker, CI/CD & Scaling"
parent:    "Deployment"
nav_order: 1
permalink: /deployment/docker/
description: "Deploy StreetJS with Docker — production container setup and environment configuration for TypeScript Node.js backends."
---

# Docker Deployment

street's `Dockerfile` uses a multi-stage build to produce a minimal, secure production image.

---

## Dockerfile walkthrough

```dockerfile
# ---- Build stage ----
FROM node:24-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci                        # Reproducible install
COPY tsconfig.json ./
COPY src ./src
COPY tests ./tests
RUN npx tsc                       # Strict TypeScript compilation

# ---- Production stage ----
FROM gcr.io/distroless/nodejs22-debian12 AS runtime
WORKDIR /app

# Only compiled output and dependencies
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json
COPY migrations ./migrations

USER nonroot                      # UID 65532 — no root privileges

EXPOSE 3000
ENV NODE_ENV=production

ENTRYPOINT ["nodejs", "dist/main.js"]
```

### Why distroless?

The `gcr.io/distroless/nodejs22-debian12` image contains:
- Node.js 20 runtime
- Required system libraries
- **Nothing else** — no shell, no package manager, no `curl`, no `ls`

Benefits:
- ~60% smaller than `node:24-alpine` for the runtime image
- No shell means no interactive exploit surface (cannot `docker exec bash`)
- No OS package manager means fewer CVEs
- Minimal signal surface for container escape attacks

### Build

```bash
# Build the image
docker build -t myapp:1.0.0 .
docker build -t myapp:latest .

# Multi-platform build (for M1 Mac → Linux x86_64 deployment)
docker buildx build --platform linux/amd64 -t myapp:latest .
```

### Run

```bash
docker run -d \
  --name myapp \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e PORT=3000 \
  -e PG_HOST=db.internal \
  -e PG_PORT=5432 \
  -e PG_DATABASE=myapp \
  -e PG_USER=myapp \
  -e PG_PASSWORD=secret \
  -e JWT_SECRET=32-char-minimum-jwt-secret-here!! \
  -e SESSION_KEY=64hexchars... \
  -v /data/uploads:/app/uploads \
  myapp:latest
```

---

## Docker Compose

Complete local development and production compose files:

### `docker-compose.yml` (development)

```yaml
version: '3.9'

services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: myapp_dev
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: devpassword
    ports:
      - "5432:5432"
    volumes:
      - pg_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp -d myapp_dev"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: 3000
      PG_HOST: db
      PG_PORT: 5432
      PG_DATABASE: myapp_dev
      PG_USER: myapp
      PG_PASSWORD: devpassword
      JWT_SECRET: dev-jwt-secret-not-for-production!!
      SESSION_KEY: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
      UPLOADS_DIR: /app/uploads
      MIGRATIONS_DIR: /app/migrations
    volumes:
      - uploads_data:/app/uploads
    command: >
      sh -c "nodejs dist/main.js migrate && nodejs dist/main.js"

volumes:
  pg_data:
  uploads_data:
```

### Start

```bash
docker compose up -d
docker compose logs -f app
```

---

# Production Hardening

## Environment variables

Never hardcode secrets. Use your platform's secret management:

```bash
# AWS ECS: use Secrets Manager or Parameter Store
# GCP Cloud Run: use Secret Manager
# Kubernetes: use Secrets + external-secrets-operator
# Heroku: use config vars
# Railway/Render: use environment variable groups
```

## Required environment variables

| Variable | Notes |
|---|---|
| `PG_HOST`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE` | Use a dedicated application user with minimal privileges |
| `JWT_SECRET` | Minimum 32 chars. Rotate using a grace period (accept old + new) |
| `SESSION_KEY` | Exactly 64 hex chars (32 bytes). Rotation invalidates all sessions |
| `KEK` | Only required if using Vault Mode |
| `NODE_ENV=production` | Enables cluster mode |

## Database user privileges

Create a dedicated database user with minimal privileges:

```sql
CREATE USER myapp WITH PASSWORD 'strong-password';
GRANT CONNECT ON DATABASE myapp_prod TO myapp;
GRANT USAGE ON SCHEMA public TO myapp;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO myapp;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO myapp;
-- NOT: GRANT CREATE, DROP, ALTER — only the migrations user needs those
```

## PostgreSQL connection string

Use SSL in production:

```bash
PG_HOST=db.us-east-1.rds.amazonaws.com
PG_PORT=5432
PG_DATABASE=myapp_prod
PG_USER=myapp
PG_PASSWORD=strong-password
```

> **Note:** The current wire driver does not support SSL. For production deployments, use a local connection (same network) or a TLS-terminating proxy (e.g., pgBouncer with TLS).

## Nginx reverse proxy

Run nginx in front of street to handle TLS termination, rate limiting, and static files:

```nginx
# /etc/nginx/conf.d/myapp.conf
server {
    listen 443 ssl http2;
    server_name api.example.com;

    ssl_certificate     /etc/ssl/certs/myapp.crt;
    ssl_certificate_key /etc/ssl/private/myapp.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # Upload size limit (match street's maxBodyBytes)
    client_max_body_size 50m;

    # Proxy to street
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # SSE: disable buffering
        proxy_buffering    off;
        proxy_cache        off;
    }

    # Serve uploads directly without hitting Node
    location /files/ {
        alias /data/uploads/;
        expires 1d;
        add_header Cache-Control "public";
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

---

# CI/CD Pipeline

The single consolidated GitHub Actions workflow (`ci-cd.yml`) runs build, test, lint, and deploy jobs in parallel across Node 22 and 24:

```yaml
# .github/workflows/ci-cd.yml (abridged — Docker-relevant jobs)
name: street CI/CD

on:
  push:
    branches: [main, develop]
    tags: ['v*.*.*']
  pull_request:
    branches: [main]

env:
  PG_HOST: localhost
  PG_PORT: 5432
  PG_DATABASE: street_test
  PG_USER: street
  PG_PASSWORD: street_secret

jobs:
  # Core tests — Node 22 & 24 matrix, YAML validation first
  build-and-test:
    strategy:
      matrix:
        node: [20, 22]
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: ${{ env.PG_DATABASE }}
          POSTGRES_USER: ${{ env.PG_USER }}
          POSTGRES_PASSWORD: ${{ env.PG_PASSWORD }}
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}
          cache: 'npm'
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx tsc
      - run: node dist/main.js migrate
      - run: node --test dist/tests/integration.test.js

  # Docker build — only on main branch, waits for core tests
  docker-build:
    needs: build-and-test
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - name: Login to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ghcr.io/${{ github.repository }}:latest, ghcr.io/${{ github.repository }}:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Additional parallel jobs in `ci-cd.yml`:
- `security-lint` — zizmor static analysis (2 min)
- `memory-leak` — isolated memory-safety tests
- `system-tests` — infrastructure, load, fuzz, chaos tests
- `test-and-publish` — npm publish on version tags, waits for `build-and-test`

---

# Scaling

## Vertical scaling (single server)

street's cluster mode uses all CPU cores automatically in production. A 4-core server runs 4 workers, each handling independent request queues:

```bash
NODE_ENV=production node dist/main.js
# [cluster] Primary 1234 starting 4 workers
# [cluster] Spawned worker 1235
# [cluster] Spawned worker 1236
# [cluster] Spawned worker 1237
# [cluster] Spawned worker 1238
```

Tune the worker count:

```bash
# More workers than CPUs for I/O-bound workloads
WORKERS=8 NODE_ENV=production node dist/main.js
```

## Horizontal scaling (multiple servers)

Deploy multiple street instances behind a load balancer. Each instance is stateless except for:

1. **Rate limiter** — per-worker, per-process. For global rate limiting, use Redis as a shared store (implement a Redis-backed `RateLimiter` subclass).
2. **In-memory cache** — per-process. Use short TTLs (30–60 seconds) so stale reads are bounded.
3. **WebSocket connections** — per-server. For cross-server broadcasting, use a message broker (Redis Pub/Sub, NATS) and bridge events.

```
                    ┌─────────────────────────────────┐
Internet ──── nginx │  street-1  street-2  street-3   │
                    │  (4 workers each)               │
                    └─────────────────────────────────┘
                                    │
                             ┌──────┴──────┐
                             │ PostgreSQL  │
                             │  (primary)  │
                             └─────────────┘
```

## Kubernetes

```yaml
# k8s/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: street-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: street-api
  template:
    metadata:
      labels:
        app: street-api
    spec:
      containers:
        - name: api
          image: ghcr.io/my-org/myapp:latest
          ports:
            - containerPort: 3000
          env:
            - name: NODE_ENV
              value: production
            - name: WORKERS
              value: "2"              # 2 workers per pod × 3 pods = 6 total
            - name: PG_HOST
              value: postgres-service
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: myapp-secrets
                  key: jwt-secret
          resources:
            requests:
              cpu: "500m"
              memory: "256Mi"
            limits:
              cpu: "1000m"
              memory: "512Mi"
          readinessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /api/health
              port: 3000
            initialDelaySeconds: 30
            periodSeconds: 30
```

```yaml
# k8s/service.yaml
apiVersion: v1
kind: Service
metadata:
  name: street-api
spec:
  selector:
    app: street-api
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

## Health check integration

Load balancers and Kubernetes use `/api/health` to determine readiness:

- HTTP 200 → instance is healthy, route traffic
- HTTP 503 → instance is degraded, stop routing (but don't kill)

The health endpoint checks PostgreSQL connectivity on every request. If the database is unreachable, it returns 503 automatically.
