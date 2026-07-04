# Migration guide

`@streetjs/gateway` is **additive**. Adopting it requires no changes to the
`streetjs` core or to any sibling pillar package — you add a dependency and a
gateway in front of your existing services.

## From no gateway

1. Install: `npm install @streetjs/gateway streetjs`.
2. Enumerate your backend services as `services` (each with one or more
   `targets`).
3. Map inbound paths to services with `routes`.
4. Bind `gateway.handle` to your HTTP server (translate the `node:http` request
   to a `GatewayRequest`, write back the `GatewayResponse`).
5. Move cross-cutting concerns (CORS, rate limiting, auth, compression) from each
   service into the gateway config incrementally.

## From a hand-rolled reverse proxy

- Replace ad-hoc `http.request` forwarding with `httpForwarder` (the default) or
  inject your own `Forwarder`.
- Replace bespoke retry/timeout loops with `defaults.retry` + `policy.timeoutMs`.
- Replace manual upstream selection with a `strategy` + the health registry.
- Move WebSocket bridging to `proxyWebSocketUpgrade`.

## Incremental routing (strangler pattern)

Route a subset of paths through the gateway to new services while leaving the
rest pointing at the legacy origin as a single catch-all service:

```ts
routes: [
  { pattern: "/v2/users", kind: "prefix", service: "users-v2" },
  { pattern: "/", kind: "prefix", service: "legacy-origin" }, // lowest specificity
]
```

Because matching is specificity-ordered, the broad `"/"` route only wins when no
more-specific route matches, so you can migrate endpoints one at a time.

## API versioning during migration

Introduce `versioning` to serve `v1` and `v2` side by side:

```ts
versioning: { versions: ["v1", "v2"], default: "v1" },
routes: [
  { pattern: "/users", kind: "prefix", service: "users-v1" },
  // a v2 route is selected when the request carries /v2 or the version header
],
```

## Compatibility guarantees

- No `streetjs` core public API is modified (guarded by regression tests).
- Pillar packages remain optional peer dependencies and are never statically
  imported by the base entry (also guarded by regression tests).
- The public export surface is asserted by a regression test, so removals are
  caught before release.

## Rollback

The gateway holds no persistent state of its own. To roll back, point traffic
back at your origin — no data migration is involved.
