# @streetjs/postgres — Architecture

## Goals

- A single, dependency-free PostgreSQL driver for StreetJS (no `pg`, no native addons).
- Node core only (`net`, `crypto`, `stream`); SCRAM-SHA-256 + extended query protocol.
- High availability as an additive layer over the single-endpoint connection.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  types.ts   DbResult (the universal driver result shape).
  wire.ts    PgConnection + StreetPostgresWireStream + protocol builders/parsers.
  ha.ts      PgHaClient (multi-host discovery, routing, failover) over PgConnection.
  index.ts   Curated public API + POSTGRES DI token.
```

`types ← wire ← ha` — a strictly one-directional graph.

## Extraction & single source of truth

Extracted from `streetjs` core (`database/{types,wire,ha}`). Core now depends on
`@streetjs/postgres` and re-exports it: `database/types.ts` re-exports `DbResult`,
`database/wire.ts` re-exports the connection/stream/types, and `database/ha.ts` re-exports
the HA client. So the `streetjs/database`, `streetjs/pool`?, and `streetjs/pg-ha`
subpaths and all internal imports (pool, repository) resolve to one implementation —
dependency inversion, not duplication. The connection **pool**, **repository**,
**migrations**, and the **SQLite/wasm** engine stay in core (they depend on core's IoC
container, HTTP exceptions, enterprise policy, and ship wasm assets); they consume this
driver via the re-export.

## Wire protocol

`PgConnection` speaks the PostgreSQL frontend/backend protocol directly over a TCP socket:
- **Startup + SCRAM-SHA-256** — the client computes the SCRAM proof with
  `pbkdf2`/`hmac`/`timingSafeEqual` (`node:crypto`); `alg:none`-style downgrades are not
  possible (mechanism is validated).
- **Extended query protocol** — `Parse`/`Bind`/`Describe`/`Execute`/`Sync` frames are built
  by pure functions (`buildParseMessage`, `buildBindMessage`, …), so parameters bind
  server-side rather than being interpolated into SQL.
- **Streaming** — `StreetPostgresWireStream` is an object-mode `Readable`; `DataRow`s are
  pushed as parsed, with backpressure driving socket pause/resume in the connection layer.

## High availability

`PgHaClient` opens each configured host, classifies it via `pg_is_in_recovery()`, and
routes queries by `target` (`primary` / `prefer-replica` / `any`). A query that throws or
exceeds the per-attempt timeout drops that connection, re-discovers the topology (picking
up a promoted primary), and retries up to `maxFailover` times.

## Testing

`node --test`, all **server-free**:
- **wire-protocol** (86 tests, ported from core's validated suite) — the pure message
  builders/parsers and SCRAM computations, plus the extended-query protocol driven through
  `PgConnection` with a **mock socket** (no live server).
- **wire-stream** — the streaming result reader (data/end, for-await-of, empty, post-
  finalize, error).
- **ha** — discovery/routing/failover with `PgConnection.connect` mocked over a
  controllable topology (including a promotion-on-failover scenario).

Coverage thresholds (lines/statements ≥ 75, functions ≥ 75, branches ≥ 72) are lower than
the leaf packages by design: the live-TCP connect/authenticate/error paths of a 1000-line
wire driver require a real PostgreSQL server, which is validated by core's live
integration test (`pg-ha.it.test.ts`) and the framework's dogfooding — not in the CI-safe
unit suite. The protocol encoding/decoding, streaming, and HA logic are covered here.
