# Performance tuning

This guide covers the knobs that affect gateway throughput and latency and the
signals to watch. Concrete numbers depend on your hardware, network, and
upstreams; measure in your environment rather than assuming.

## Load balancing

- `round-robin` — cheapest; even distribution for homogeneous pools.
- `weighted-round-robin` — smooth (nginx-style) distribution honouring per-target
  `weight`; use when instances differ in capacity.
- `least-connections` — best when request durations vary widely; picks the target
  with the fewest in-flight connections (the gateway tracks this per target).
- `random` — lowest coordination; good for very large pools.

A balancer is created once per `service + strategy` and reused, so scheduling
state (round-robin cursor, weighted credits) persists across requests.

## Retries and timeouts

- Keep `timeoutMs` tight enough to shed hung upstreams quickly but above your
  p99 upstream latency to avoid false timeouts.
- Retries multiply load. Restrict `retryMethods` to idempotent verbs and use
  exponential backoff (`baseDelayMs`, `multiplier`, `maxDelayMs`) so a struggling
  upstream is not hammered.
- Pair retries with the circuit breaker so repeated failures trip the circuit
  (`failureThreshold`, `openMs`) instead of retrying into a dead backend.

## Compression

Compression trades CPU for bandwidth. Set `compression.threshold` so only
payloads large enough to benefit are compressed (small bodies cost more CPU than
they save). `br` compresses better but costs more CPU than `gzip`; the encoding
is negotiated from the client's `Accept-Encoding`.

## Health checks

Probing removes dead targets from rotation, avoiding wasted forwards and retries.
Balance probe frequency against probe cost; `filterHealthy` is O(pool size) per
request and only excludes targets explicitly marked `unhealthy`.

## Rate limiting

Rate limiting is an O(1) token-bucket check per request. One limiter is created
per route and reused. Prefer coarse global/ip limits at the edge and finer
user/api-key limits deeper in, to keep bucket cardinality bounded.

## Metrics to watch

`registerGatewayObservability` exposes:

- `gateway_requests_total` — request count.
- `gateway_errors_total` — 5xx count.
- `gateway_request_duration_ms` — latency.
- `gateway_active_connections` — in-flight requests.
- `gateway_backend_healthy` — healthy upstream count.

`gateway.stats()` returns a live snapshot (`requestsTotal`, `errorsTotal`,
`activeConnections`, `healthyUpstreams`, `unhealthyUpstreams`). Alert on rising
`errorsTotal`, latency, or a falling healthy-upstream count.

## Middleware

Middleware runs on every request as an onion. Keep the chain short, do
CPU-heavy work lazily, and place cheap short-circuiting middleware (auth, rate
limit) before expensive ones so rejected requests exit early.

## Determinism vs. production

The injectable `clock`/`rng`/`forwarder` seams exist for reproducible tests. In
production leave them at their defaults (`systemClock`, `Math.random`,
`httpForwarder`) unless you have a specific reason to override them.
