# Configuration

Everything is configured through the `GatewayConfig` object passed to
`createGateway`. All fields except `routes` and `services` are optional.

## Services and targets

```ts
services: [
  {
    name: "users-service",
    targets: [
      { id: "u1", url: "http://10.0.0.1:4001", weight: 2 },
      { id: "u2", url: "http://10.0.0.2:4001" },
    ],
    strategy: "weighted-round-robin", // per-service default strategy
  },
]
```

A `UpstreamTarget` needs a stable `id` and a base `url`. `weight` is only used by
the weighted balancer (default `1`, minimum `1`).

## Routes

```ts
routes: [
  { pattern: "/auth", kind: "prefix", service: "auth-service" },     // /auth/*
  { pattern: "/users/:id", kind: "static", service: "users" },       // exact
  { pattern: "/files/*", kind: "wildcard", service: "files" },       // glob tail
  { pattern: "^/v\\d+/api", kind: "regex", service: "api" },         // regex
]
```

- `kind` is one of `static | prefix | wildcard | regex`.
- Matching is **priority-ordered by specificity**: more specific routes win over
  broader ones regardless of declaration order. Use `id` to give a route a
  stable key (otherwise `pattern` is the key for rate-limiter buckets).
- `strategy` and `policy` may be set per route to override service/global
  defaults.

## Policies (`defaults` + per-route `policy`)

The effective policy for a request is `{ ...defaults, ...route.policy }`.

```ts
defaults: {
  timeoutMs: 5_000,
  retry: { maxAttempts: 3, baseDelayMs: 50, multiplier: 2, maxDelayMs: 2_000,
           retryMethods: ["GET", "HEAD"] },
  circuitBreaker: { failureThreshold: 5, openMs: 10_000, halfOpenSuccesses: 1 },
  rateLimit: { scope: "ip", limit: 100, windowMs: 60_000 },
  auth: { kind: "custom", verify: (req) => resolveIdentity(req) },
  authorization: { kind: "role", roles: ["admin"] },
}
```

- **Retry** only re-attempts idempotent methods (`retryMethods`, default GET/HEAD)
  and backs off exponentially with an optional cap.
- **Circuit breaker** is keyed per `service::target`; by default it never opens.
- **Rate limit** scopes: `global | ip | user | api-key`.
- **Auth** kinds: `none | jwt | api-key | session | custom`.
- **Authorization** kinds: `public | authenticated | role | permission | custom`.

## CORS

```ts
cors: {
  origins: ["https://app.example.com"], // or "*"
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["content-type", "authorization"],
  credentials: true,
  maxAgeSeconds: 600,
}
```

## Versioning

```ts
versioning: {
  versions: ["v1", "v2"],
  default: "v1",
  sources: ["path", "x-version", "accept-version"], // first hit wins
}
```

When a version is resolved from the path (e.g. `/v2/users`), the version segment
is stripped before routing, so routes are declared without the version prefix.

## Compression

```ts
compression: { enabled: true, threshold: 1024 } // gzip/br, based on Accept-Encoding
```

## Security

```ts
security: {
  maxBodyBytes: 1_048_576,   // 413 Payload Too Large above this
  headerTimeoutMs: 10_000,   // slowloris protection (see the security guide)
  headers: { "x-frame-options": "DENY" }, // merged over the secure defaults
}
```

## Observability & logging

```ts
logSink: (record) => logger.info(record), // structured access log per request
```

Metrics and health are registered via `registerGatewayObservability`; see the
performance guide for the exposed metric names.

## Request validation

Per-route validation is intentionally not a config field. Register it as
middleware with `gateway.use(...)` using the `validation` module
(`validateRequest` / `assertValid` and the `required`, `isString`, `matches`,
`isInteger` rule helpers), which keeps the core pipeline lean.

## Binding to a transport

`createGateway` is transport-agnostic. To serve over HTTP, translate a
`node:http` request into a `GatewayRequest`, call `handle`, and write the
`GatewayResponse` back. For WebSocket routes, wire the server's `upgrade` event
to `proxyWebSocketUpgrade`.
