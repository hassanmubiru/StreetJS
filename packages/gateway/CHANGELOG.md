# Changelog

All notable changes to `@streetjs/gateway` are documented here. This project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-04

Initial release of the StreetJS API Gateway & Edge Framework.

### Added
- Reverse proxy with an injectable HTTP(S) forwarder (`httpForwarder`) and a
  WebSocket upgrade bridge (`proxyWebSocketUpgrade`), with abort/cancellation
  and per-attempt timeouts.
- Routing with static, prefix, wildcard, and regex kinds, ordered by
  specificity (priority routing).
- Load balancing: round-robin, least-connections, random, and smooth
  weighted-round-robin, configurable per route.
- Health checks (`httpChecker`, `tcpChecker`, custom) with health-filtered,
  fail-open upstream selection.
- Resilience: circuit breaker plus retry with exponential backoff and timeout.
- Rate limiting (global / IP / user / API-key scopes).
- Authentication (JWT / API-key / session / custom) and authorization
  (public / authenticated / role / permission / custom).
- Request validation, response transformation, API versioning (path / headers),
  CORS, and gzip/brotli compression.
- Structured request logging and observability (`registerGatewayObservability`)
  exposing request/error/latency/active-connection/backend-health metrics.
- Security headers, request size limits, and timeout/slowloris policy.
- `GatewayPlugin` for integration and a CLI (`make:gateway-route`, `make:proxy`,
  `gateway:routes`, `gateway:health`).
- Testing utilities on the `./testing` subpath: `FakeGateway`, `GatewayHarness`,
  `FakeBackend`.
- Runnable in-process edge example (Browser → Gateway → three backends →
  Realtime/Storage/Queue/Events) and full unit, integration, regression, and
  property-based test suites.

### Notes
- Additive and backwards compatible: no modifications to the `streetjs` core
  public API. Only runtime dependency is `streetjs`; the sibling pillar packages
  are optional peer dependencies and are never statically imported by the base
  entry.
