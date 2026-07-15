# Changelog

All notable changes to `@streetjs/cluster` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-15

### Added

- Initial release of `@streetjs/cluster` — the StreetJS clustering foundation, extracted
  from `streetjs` core as the single source of truth (core re-exports the coordinator and
  the `IpcMessage` type).
- `ClusterCoordinator`: primary-process worker spawning (default = CPU count), IPC
  heartbeat monitoring with kill+respawn on timeout, auto-restart on exit (debounced),
  idempotent `start()` (throws off the primary), and clean `shutdown()` (listener + timer
  teardown, `SIGTERM` to workers). All timers `unref`'d.
- Worker-side `workerHeartbeat()` and `signalReady()`; `IpcMessage`/`ClusterOptions` types.
- `CLUSTER_COORDINATOR` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Test suite (10 tests) covering the coordination logic; the `cluster.fork()` paths are
  validated by the runnable example. Enforced coverage: lines/statements/functions ≥ 80,
  branches ≥ 75 (fork paths are integration-bound).
