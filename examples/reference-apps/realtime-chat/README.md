# Realtime Chat — StreetJS reference application

A production-shaped realtime chat backend built entirely on verified StreetJS
primitives:

- `StreetWebSocketServer` — authenticated WebSocket upgrades + heartbeat
- `ChannelHub` — rooms, reference-counted presence, typing indicators, scoped broadcast
- Bounded in-memory message history per room + HTTP health endpoints

This is a *reference app*: a runnable, tested starting point you adapt — not an
npm package.

## Run

```bash
# from the repo root (resolves the local `streetjs` build)
npm run build -w packages/core
node examples/reference-apps/realtime-chat/server.mjs        # starts on :3000
```

WebSocket clients connect with a bearer token; the demo auth maps `user:<id>` →
`<id>`. **Replace `defaultAuth` with `streetjs` `JwtService` verification in
production.**

Client protocol (JSON frames `{ type, payload }`):
`join {room}`, `leave {room}`, `message {room, text}`, `typing {room, typing}`.
Server emits: `presence:snapshot`, `history`, `presence:join`/`presence:leave`,
`typing`, `message`.

HTTP: `GET /health/live`, `GET /health/ready`, `GET /rooms`.

## Verification (executed)

```bash
node examples/reference-apps/realtime-chat/smoke-test.mjs   # 8/8 checks pass, exit 0
node examples/reference-apps/realtime-chat/benchmark.mjs    # throughput
```

Smoke test covers: **unauthorized upgrade rejected**, presence snapshot,
`presence:join`, message delivery (incl. sender echo), late-joiner history,
typing indicators, and presence-leave on disconnect.

Benchmark (this machine, 10 subscribers × 2000 messages): **20,000/20,000
deliveries in ~0.18s → ~11.5K msg/s published, ~115K deliveries/s** (in-process
single instance; horizontal scale needs a Redis pub/sub fan-out in front of
`ChannelHub.publish`).

## Security configuration

- **Auth at the upgrade** (`authFn`) — unauthenticated sockets are rejected with
  401 before the connection is established (verified by the smoke test). Wire it
  to `JwtService.verify` in production.
- Message text is length-capped (4 KB); the WS server caps frame size (512 KB).
- Run behind TLS; set `ALLOWED_ORIGINS` if exposing companion HTTP routes.

## Deployment

Reuses the repo's deployment artifacts (`deploy/`): build the container
(`Dockerfile`), deploy to Kubernetes (`deploy/helm/street`) or Cloud Run
(`deploy/cloud-run/service.yaml`). Liveness/readiness probes hit
`/health/live` and `/health/ready`. Validate any deployment with
`scripts/deploy/smoke-test.sh`.

## Monitoring

Emit StreetJS Prometheus metrics / OpenTelemetry spans (see `observability/` and
the docs). Track: active connections (`wss.connectionCount`), per-room presence
(`hub.presence(room)`), and message rate. Alert on readiness failures and
abnormal disconnect rates.

## Scaling notes

`ChannelHub` is in-process. For multiple instances, fan `publish` and presence
events through Redis pub/sub so a message published on one node reaches members
connected to another; persist history in Postgres (`@streetjs/social-comments`
demonstrates the store pattern) instead of the in-memory buffer.
