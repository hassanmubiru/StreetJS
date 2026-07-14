# Changelog

All notable changes to `@streetjs/websocket` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/websocket` — the StreetJS realtime foundation, extracted
  from `streetjs` core as the single source of truth (core now re-exports it).
- `StreetWebSocketServer`: origin gating (403), optional `authFn` gating (401), optional
  heartbeat, `maxConnections` capacity (1013), 512 KB payload cap, `attach` (default
  handler) and `attachProtocol` (custom subprotocol), and `broadcast`.
- `StreetSocket`: `{ type, payload, ts }` event framing with `on`/`off`/`emit`, a `*`
  wildcard, a per-event listener cap, idempotent `close`/`onClose`, and a stable `id`.
- `SseConnection`/`createSse`: Server-Sent Events with heartbeat, CR/LF frame-injection
  guard, multi-line data, and cleanup on close/error/write failure.
- `ChannelHub`: transport-agnostic rooms with reference-counted presence (multi-device
  correct), typing indicators (optional TTL auto-clear), scoped broadcasts, and lifecycle
  binding; plus origin helpers (`normalizeOrigin`/`deriveSelfOrigin`/`isOriginAllowed`).
- `WEBSOCKET_SERVER` dependency-injection token.
- One runtime dependency (`ws`). Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (51 tests: pure-logic unit + real-socket integration) with
  enforced coverage (lines/functions/statements ≥90, branches ≥85).
