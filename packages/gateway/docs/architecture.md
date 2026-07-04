# Architecture

`@streetjs/gateway` is a composition of small, independently-tested leaf modules
assembled by a single facade, `createGateway`. Each concern lives in its own
module with its own unit and (where valuable) property tests; the facade only
adds the *wiring* behaviour, delegating every stage to a leaf.

## Layers

```
                        ┌─────────────────────────────────────────┐
   GatewayRequest  ──▶  │              createGateway               │  ──▶ GatewayResponse
                        │  (gateway.ts: the request pipeline)      │
                        └───────────────┬─────────────────────────┘
                                        │ delegates to
        ┌───────────────┬───────────────┼───────────────┬───────────────┐
        ▼               ▼               ▼               ▼               ▼
     router.ts      balancer.ts      health.ts     circuit-breaker   retry.ts
   (match route)  (pick target)   (filter pool)   (per-target trip)  (retry+timeout)
        ▼               ▼               ▼               ▼               ▼
   ratelimit.ts     auth.ts        cors.ts        versioning.ts   compression.ts
        ▼               ▼               ▼               ▼               ▼
   validation.ts   security.ts    logging.ts    observability.ts  middleware.ts
                                        │
                                        ▼
                                    proxy.ts
                             (httpForwarder + WS upgrade)
```

## The pipeline (`gateway.ts`)

`createGateway(config)` eagerly builds the shared, stateful collaborators — the
routing table, health registry, a circuit breaker, the logger and observability
handle — and lazily builds the per-key ones: one balancer per
`service + strategy`, one rate limiter per route. This keeps internal scheduling
and bucket state alive and reused across requests.

`handle(req)` executes these stages in order:

1. **Ingress** — assign a request id, start the latency clock.
2. **Body-size limit** — reject oversized bodies (`security.maxBodyBytes`).
3. **CORS** — reject disallowed origins; answer genuine preflights with `204`.
4. **Versioning** — resolve the API version and the path to route on.
5. **Routing** — match the (version-stripped) path + method to a route.
6. **Policy merge** — `defaults` overlaid with the route's `policy`.
7. **Rate limit** — token-bucket check for the route.
8. **Auth / authz** — authenticate, then authorize.
9. **Upstream selection** — filter the service pool by health, then load balance.
10. **Circuit breaker** — keyed by `service::target`.
11. **Forward** — `runWithRetry(withTimeout(forwarder))` on the stripped path.
12. **Response transform** — security headers, CORS headers, optional compression.
13. **Egress** — always emit a structured access log + telemetry.

Steps 7–11 form the *terminal handler* that sits at the centre of the
`use()`-registered middleware onion (`runPipeline` in `middleware.ts`).

## Determinism & injection

- `clock: Clock` — every timestamp, backoff and window boundary.
- `rng: () => number` — random balancing and jitter.
- `forwarder: Forwarder` — the actual upstream call.

Injecting a fake clock and a deterministic forwarder makes a gateway fully
reproducible, which is how the property tests drive it at `numRuns: 100`.

## Error model (`errors.ts`)

Every failure is a `GatewayError` subclass carrying an HTTP `status`. The
pipeline converts a caught error into a consistent JSON body
(`{ error, message, issues? }`) and never leaks upstream internals. Non-gateway
throwables become `502 Bad Gateway`.

## Pillar integration

The base entry imports no pillar package. Integration is *structural*: a gateway
forwards to backend services which themselves use the pillars, and gateway
middleware can call into any pillar a consumer chooses to wire in. The runnable
example demonstrates the full fan-out with in-process stand-ins so it needs no
external services.
