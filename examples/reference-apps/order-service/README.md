# Order service: framework golden-path slice

A backend-only reference built through the public `streetjs` entry point:
controllers, explicit application DI, request scopes, JWT authentication and
role authorization, Zod runtime validation, SQL transactions, health probes,
Prometheus metrics, correlation logging, safe error envelopes, and shutdown.
No new package or runtime API is introduced.

## Run

From the repository root, using Node 22:

```sh
npm ci
npm run build:core
# Supply JWT_SECRET through your environment (at least 32 characters).
node examples/reference-apps/order-service/server.mjs
```

`PORT` defaults to 3000; the listener binds to loopback. SIGINT/SIGTERM close
HTTP before the container closes the SQLite worker. The async factory
`createOrderService({ jwtSecret, logStream })` supports embedding and tests;
`service.listen(0)` uses an ephemeral port and `service.close()` is repeat-safe.

## Flow

- `POST /orders`: bearer JWT with `writer` role; body contains `requestKey`,
  `sku`, and integer `quantity` (1–1000). Returns 201.
- `GET /orders/:id`: `reader` or `writer` role; only the owning subject can read
  an order. Other subjects receive 404.
- `/orders/` is not an alias for `/orders`.
- `/health/live`, `/health/ready`, and `/metrics` are public local probes.

An order and audit row commit in one real SQLite transaction. Reusing a
`requestKey` triggers a database uniqueness failure after the order insert;
the transaction rolls back and returns a safe 409. This is duplicate rejection,
not an idempotency replay guarantee. Unexpected errors use the framework's
sanitized envelope; server diagnostics may still log database details.

The service accepts caller-supplied signing material. It does not issue or
persist tokens. Each request owns a disposable scoped resource; the app
container owns the database pool. Metrics use `metricsHandler` directly to
avoid starting the default heap-sampling interval.

## Verify

```sh
npm run test:conformance
npm run verify
```

`scripts/framework-conformance/order-service.test.mjs` exercises real HTTP,
SQLite read-back and rollback, invalid/expired/missing credentials, role and
owner boundaries, malformed input, correlation logs, probes/metrics, request
disposal, two-app isolation, and repeated close.

## Limits

SQLite is intentionally in-memory and ephemeral—not restart-durable storage.
This slice has no events, queue workers, outbox, HTTP/2, cancellation contract,
or deployment certification. It is not a production commerce system. Tests do
not establish crash recovery or distributed transaction semantics.
