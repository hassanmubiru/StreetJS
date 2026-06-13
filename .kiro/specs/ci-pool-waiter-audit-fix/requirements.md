# Requirements: CI Failure Fix — PgPool Waiter Enqueue & esbuild Audit

## Introduction

The CI pipeline reports seven failing checks (Core, Memory Leak, and
memory-safety on Node 20 and 22, plus Policy Checks). These collapse into two
independent, locally-reproduced root causes:

- **A:** `PgPool.acquire()` enqueues waiters one microtask late because it
  unconditionally awaits `ensureInitialized()`, violating the synchronous
  waiter-enqueue contract that several tests and `close()` depend on.
- **B:** `npm audit --audit-level=high` fails on a high-severity `esbuild`
  advisory pulled in by the `^0.28.0` dev dependency.

These requirements define the conditions under which the affected CI checks
pass without regressing existing behavior. The fixes must be minimal and
surgical, preserving all current public contracts.

## Glossary

- **Warm path:** an `acquire()` call on a pool that is already initialized.
- **Cold path:** the first `acquire()` (or query/stream/transaction) on a pool
  that has not yet completed warm-up.
- **Waiter:** a queued caller of `acquire()` parked in `waitQueue` because no
  connection is currently available.
- **Synchronous enqueue:** pushing a waiter onto `waitQueue` within the same
  tick as the `acquire()` call, with no intervening `await` boundary.
- **Advisory range:** the version range an `npm audit` advisory flags as
  vulnerable.

## Requirements

### Requirement 1: Synchronous waiter enqueue on the warm path

**User Story:** As a developer relying on the connection pool, I want a saturated
`acquire()` call on an already-initialized pool to register its waiter
immediately, so that `close()` and back-pressure guards observe the waiter in
the same tick and behave deterministically.

#### Acceptance Criteria

1. WHEN `acquire()` is called on an initialized, saturated pool THEN the pool
   SHALL push the waiter onto `waitQueue` synchronously, with no `await`
   boundary between the `acquire()` call and the enqueue.
2. WHEN `acquire()` is called on an initialized pool AND the wait queue already
   holds `MAX_WAIT` entries THEN the pool SHALL reject the call with an error
   whose message matches `wait queue full` synchronously (without first
   awaiting initialization).
3. WHILE the pool is already initialized THE `acquire()` method SHALL NOT await
   `ensureInitialized()`.

### Requirement 2: Preserve lazy cold-path initialization

**User Story:** As a developer, I want the pool to keep warming up on first use,
so that a pool can be registered at bootstrap without a live database and
initialize on the first acquire.

#### Acceptance Criteria

1. WHEN `acquire()` is called for the first time on an uninitialized pool THEN
   the pool SHALL await `ensureInitialized()` before attempting to acquire a
   connection.
2. WHEN cold-path initialization fails because the database is unreachable THEN
   `acquire()` SHALL reject and a later `acquire()` SHALL be able to retry
   initialization.
3. WHEN initialization has completed once THEN subsequent `acquire()` calls
   SHALL NOT re-run warm-up.

### Requirement 3: Correct waiter rejection on close

**User Story:** As a developer shutting down the pool, I want all pending waiters
to be rejected with a consistent, identifiable error, so that no acquire promise
hangs unresolved.

#### Acceptance Criteria

1. WHEN `close()` is called WHILE one or more waiters are queued THEN each queued
   waiter's promise SHALL reject with an error whose message matches
   `Connection pool is closed`.
2. WHEN `acquire()` is called after `close()` has set the pool to closed THEN the
   call SHALL reject with an error whose message matches `Pool is closed`.
3. WHEN `close()` rejects queued waiters THEN it SHALL clear each waiter's
   acquire-timeout timer AND leave `waitQueue` empty.
4. WHEN a connection that is not ready is released WHILE a waiter is queued THEN
   the pool SHALL NOT consume that waiter from `waitQueue`.

### Requirement 4: Resolve the high-severity esbuild advisory

**User Story:** As a maintainer, I want the dependency tree free of high-severity
advisories, so that the Policy Checks audit gate passes.

#### Acceptance Criteria

1. WHEN `npm audit --audit-level=high` runs at the repository root THEN it SHALL
   exit with code 0.
2. THE `esbuild` dev dependency in `packages/core/package.json` SHALL be set to a
   version range outside the flagged advisory range.
3. WHEN the dependency is bumped THEN `package-lock.json` SHALL be updated to
   resolve a patched `esbuild` version.
4. THE `esbuild` dependency SHALL remain a dev dependency and SHALL NOT be added
   to any published package's runtime dependencies.

### Requirement 5: No regression in existing behavior and gates

**User Story:** As a maintainer, I want the fixes to leave all other tests and
checks green, so that I can merge with confidence.

#### Acceptance Criteria

1. WHEN the memory-leak and wire-protocol suites run THEN all tests SHALL pass.
2. WHEN the memory-safety system suite runs THEN all tests SHALL pass.
3. WHEN the Core coverage suite runs THEN it SHALL complete without failing tests.
4. WHEN the browser-build test runs against the bumped `esbuild` THEN it SHALL
   pass.
5. WHEN the Policy Checks placeholder scan runs THEN no banned markers
   (TODO/FIXME/HACK/@ts-ignore) SHALL be introduced by the fix.
6. THE public API surface of `PgPool` (method signatures, the `pool:exhausted`
   event, timeout behavior) SHALL remain unchanged.
