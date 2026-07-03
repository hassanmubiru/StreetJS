# Implementation Report — `@streetjs/workflow` (StreetJS Core v2 · Pillar 5)

**Status:** Complete · **Version:** 1.0.0 · **Node:** `>=22` · **Module:** ESM (NodeNext) · **TypeScript:** `strict`

This report closes out the `workflow-engine` spec. It summarizes the delivered
architecture, the deliverables, the verification results, the 13 correctness
property validations, known limitations, honestly-skipped external-provider
tests, interoperability with the four prior pillars, and recommended future
enhancements (Requirements 32.1–32.5).

---

## 1. Architecture Overview

`@streetjs/workflow` is a **production-grade, strongly-typed, durable workflow
orchestration engine**. A workflow is authored as an ordinary **imperative,
context-based async function** — not a declarative step graph — and is made
durable through a **journaled, deterministic-replay** execution model.

The engine's core invariant is **write-before-advance**: every effectful `ctx`
command is assigned a monotonically increasing `seq`, executed once, its outcome
recorded as a `HistoryEvent`/`CommandRecord`, and the run persisted through the
`WorkflowStore` **before** control returns to the function. On resume the
function is replayed from the top; recorded commands return their journaled
outcome without re-executing, so completed activities never run twice and the
run continues from the interruption frontier.

Value is **coordination, not duplication**: the engine sequences work, passes
typed data between activities, survives process restarts through a pluggable
persistence layer, retries and compensates failed work, and reacts to external
signals and timers. It composes the four foundational pillars through optional,
**structural `*Like` bridge contracts** so it has no hard pillar dependency,
introduces no circular dependency, and stays fully testable in-process.

### Execution model (data flow)

```
createWorkflow(config) → WorkflowEngine (facade, lifecycle, resume, bridge wiring)
        │
        ├── WorkflowRuntime      drives Workflow_Function(ctx, input); owns replay driving
        │       ├── Journal      seq allocation · record-then-persist · replay outcomes
        │       ├── ActivityExecutor   one attempt: AbortSignal · middleware · timeout race · retry/backoff · viaQueue
        │       ├── Compensator/Saga    reverse-order, exactly-once rollback on terminal failure
        │       └── SignalTimerCoordinator   park as waiting · resume exactly once · buffer early signals · absolute timer expiry
        │
        ├── WorkflowStore        MemoryWorkflowStore (default, zero-dep) | RedisWorkflowStore (submodule)
        └── *Like bridges        Storage · Queue · Events · Realtime  (optional, structural)
```

### Design guarantees

- **Base-entry purity** — `src/index.ts` imports **no** pillar package and **no**
  Redis client. Redis persistence and testing helpers live behind dedicated
  subpath exports (`./redis`, `./testing`).
- **Determinism under test** — an injectable `Clock` (default `systemClock`) and
  injectable `rng` (default `Math.random`) make timers, backoff, and replay
  reproducible; `FakeClock` advances time without wall-clock waiting.
- **Additive** — only the new `packages/workflow` package is introduced;
  `packages/core` and all existing public APIs are untouched.

---

## 2. Deliverables

### Core modules (`src/`)

| Module | Export(s) | Responsibility |
| --- | --- | --- |
| `index.ts` | `createWorkflow`, all public types, `MemoryWorkflowStore`, `WorkflowPlugin`, `WorkflowCommands`, `computeBackoff`, `TERMINAL`, error hierarchy, observability | Base entry (`.`); imports no pillar and no redis |
| `engine.ts` | `createWorkflow`, `WorkflowEngine` | Facade: define/run/pause/cancel/restart/status/list/history/signal/definitions/stats/close; resume + auto-resume; bridge wiring |
| `runtime.ts` | `WorkflowRuntime` | Drives the imperative function; owns the replay-driving path |
| `journal.ts` | `Journal` | seq allocation, record-then-persist (write-before-advance), replay outcomes |
| `context.ts` | `createContext`, `WorkflowContext` | The typed `ctx` surface (activity/parallel/if/switch/match/sleep/waitUntil/cron/interval/queue/events/storage/realtime/logger/clock/metadata/state) |
| `executor.ts` | `ActivityExecutor` | One activity attempt: AbortSignal, middleware, timeout race, retry/backoff, viaQueue |
| `compensator.ts` | `Compensator`, `Saga` | Reverse-order exactly-once compensation; `step()`/`compensate()`/`rollback()` |
| `coordinator.ts` | `SignalTimerCoordinator` | Park/resume waits, early-signal buffering, absolute timer expiry across restart |
| `backoff.ts` | `computeBackoff` | fixed/linear/exponential/jitter delay math (reuses the queue formula) |
| `store.ts` | `WorkflowStore`, `StoreProbe`, `MemoryWorkflowStore` | Persistence contract + zero-dependency default (deep-clone on save/load) |
| `types.ts` | shared typed models + `TERMINAL` | Run/command/history/config/ctx types |
| `errors.ts` | `WorkflowError` + subclasses | Descriptive typed error hierarchy |
| `observability.ts` | `registerWorkflowObservability`, metric/health constants + types | Idempotent metrics + persistence health, reusing core primitives |
| `plugin.ts` | `WorkflowPlugin`, `WorkflowPluginOptions` | `PluginModule` lifecycle within `SandboxedApp` constraints |
| `integrations/{storage,queue,events,realtime}.ts` | `*Like` + `bridgeWorkflow*` | The four structural pillar bridges |
| `cli/commands.ts` | `WorkflowCommands` | `@Command` methods (make:workflow/activity, workflow:list/run/cancel/retry) |
| `cli/generators.ts` | scaffold generators | Pure, validate-before-write scaffolds |

### Submodules (isolated subpath exports)

| Subpath | Maps to | Extra dependency | Export(s) |
| --- | --- | --- | --- |
| `.` (`@streetjs/workflow`) | `dist/index.js` | `streetjs` only | the full public surface |
| `@streetjs/workflow/redis` | `dist/redis/index.js` | optional `redis` peer, **here only** | `RedisWorkflowStore`, `RedisLike`, `RedisWorkflowStoreOptions` |
| `@streetjs/workflow/testing` | `dist/testing/index.js` | none | `MemoryWorkflow`, `FakeWorkflow`, `FakeClock`, `WorkflowHarness` |

### Supporting deliverables

- **Example** — `src/examples/order-processing/` (`npm run example`): Receive → Validate → Charge → Invoice → Store → Publish → Notify → Queue → Complete over `MemoryWorkflowStore` + in-process bridge doubles, no external services.
- **Documentation** — `README.md` (Quick Start; Activities, Parallel, Sagas, Compensation, Retry, Queue/Storage/Events/Realtime integration, Testing; Migration + Best-practices guides).
- **Tests** — 30 test files under `src/tests/` (unit, integration, 13 property tests, regression, CLI, example smoke, and a `types.test-d.ts` compile-time type test).

---

## 3. Verification Results

All commands were run in `packages/workflow` (except the core-untouched check,
run from the repo root).

| # | Check | Command | Result |
| --- | --- | --- | --- |
| 1 | `tsc` build clean (strict) | `npx tsc` | **exit 0** ✅ |
| 2 | Type-check clean | `npx tsc --noEmit` | **exit 0** ✅ |
| 3 | Full test suite | `node --test dist/tests/*.test.js` | **exit 0** — see counts below ✅ |
| 4 | Example runs to completion | `npm run example` | **exit 0** — full 9-step sequence, run status `completed` ✅ |
| 5a | `packages/core` untouched | `git status --porcelain packages/core` | **empty output** ✅ |
| 5b | No existing public API changed | package is purely additive (new package only) | ✅ |
| 5c | No new circular dependency | base entry imports no pillar/redis; no package depends on `@streetjs/workflow` | ✅ |
| 5d | Base entry imports no pillar/redis | grep of `dist/index.js` + transitive core modules | **NONE** ✅ |
| 6 | `make:workflow`/`make:activity` scaffolds compile | verified in tasks 18.1 / 18.3 (`cli.test.ts` compiles generated output under `tsc`) | ✅ (referenced) |

### Test counts (`node --test dist/tests/*.test.js`)

```
# tests 153
# suites 5
# pass 149
# fail 0
# cancelled 0
# skipped 4
# todo 0
```

**149 pass · 0 fail · 4 honestly skipped** (external-provider integration tests
— see §5). Test categories covered: unit, integration, property (13 at
`{ numRuns: 100 }`), regression, CLI, example smoke, and compile-time type tests
(Requirement 31.2).

### Example output (abridged)

```
1. Receive Order       → order order_0001
2. Validate Inventory  → reservation resv_0002
3. Charge Card         → charge charge_0003
4. Generate Invoice    → invoice inv_0004
5. Store Invoice       → storage keys: invoices/inv_0004.pdf
6. Publish Event       → events: invoice.generated
7. Notify Realtime     → broadcasts: workflow.started, orders/workflow.broadcast, workflow.completed
8. Queue Email         → job job_0001 (1 dispatched)
9. Complete            → run status: completed
```

---

## 4. Property Validations

The 13 universal correctness properties from the design each run as a single
fast-check property at `{ numRuns: 100 }`, tagged
`Feature: workflow-engine, Property {n}`. All pass.

| # | Property | Test file |
| --- | --- | --- |
| 1 | No double-execution of completed activities | `src/tests/no-double-execution.property.test.ts` |
| 2 | Cancelled runs never auto-resume | `src/tests/cancelled-no-resume.property.test.ts` |
| 3 | Compensation is exactly-once in reverse completion order | `src/tests/compensation.property.test.ts` |
| 4 | Retry attempts never exceed `maxAttempts` | `src/tests/retry-bound.property.test.ts` |
| 5 | Waiting resumes exactly once per wait | `src/tests/waiting.property.test.ts` |
| 6 | Timers preserve relative firing order | `src/tests/timer-order.property.test.ts` |
| 7 | Workflow run identifiers are unique | `src/tests/unique-run-ids.property.test.ts` |
| 8 | Parallel execution is deterministically ordered | `src/tests/parallel-order.property.test.ts` |
| 9 | Event-replay preserves terminal state and results | `src/tests/event-replay.property.test.ts` |
| 10 | Storage operations are idempotent within a run | `src/tests/storage-idempotence.property.test.ts` |
| 11 | Queue-backed and direct activities are observationally equivalent | `src/tests/queue-equivalence.property.test.ts` |
| 12 | Memory and Redis stores are observationally equivalent | `src/tests/memory-redis-equivalence.property.test.ts` |
| 13 | Backoff delay formula and bound | `src/tests/backoff.property.test.ts` |

Properties 4 and 12 exercise Redis through an **in-process `RedisLike` fake**, so
they require no Redis server and run in the standard suite.

---

## 5. Known Limitations & Skipped External-Provider Tests

### Skipped external-provider tests (honest skips — never reported as passed)

The 4 skipped tests use Node's test `skip` with a clear message and only skip
when the external provider is genuinely absent (Requirements 31.6, 27.3, 27.4):

| Test | Skip condition |
| --- | --- |
| `live @streetjs/queue satisfies QueueLike …` | `@streetjs/queue` not installed |
| `live @streetjs/events satisfies EventsLike …` | `@streetjs/events` not installed |
| `live @streetjs/realtime satisfies RealtimeLike …` | `@streetjs/realtime` not installed |
| `RedisWorkflowStore backs a run against a real Redis server` | `redis` client / server unavailable |

The bridge wiring paths and `RedisWorkflowStore` conformance are still fully
covered by in-process doubles/fakes, so functional coverage does not depend on
the presence of any external provider.

### Known limitations

- **Persistence granularity** — `MemoryWorkflowStore` retains runs only for the
  process lifetime (durable across in-process resume, not across restart). Cross-
  restart durability requires `RedisWorkflowStore` (or another `WorkflowStore`).
- **Single-process coordinator** — timer/signal coordination and auto-resume run
  within one engine instance. Multi-node coordination (distributed leasing of
  runs) is not provided.
- **`ctx.cron`/`ctx.interval`** — scheduled as journaled timers relative to the
  injected Clock; there is no external scheduler daemon.
- **Bridge contracts are structural** — the pillars are validated structurally
  against a live instance only when their packages are installed; in this
  workspace they are absent, hence the honest skips above.

---

## 6. Interoperability with the Four Prior Pillars

Integration is achieved exclusively through optional, structural `*Like` bridge
contracts — no hard dependency, no peer requirement to run, and no circular
dependency (Requirements 30.3, 32.4). Each bridge is present and typed on `ctx`
regardless of wiring; using an unwired bridge yields a descriptive
`WorkflowConfigError`.

| Pillar | Bridge contract | `ctx` surface | Behavior |
| --- | --- | --- | --- |
| `@streetjs/storage` (Pillar 4) | `StorageLike` (`put/get/delete/move/copy`) | `ctx.storage` | Journaled, keyed operations that are idempotent within a run (Property 10) |
| `@streetjs/queue` (Pillar 2) | `QueueLike` (`dispatch`, optional `execute`) | `ctx.queue` | `dispatch` returns a jobId; `viaQueue` activities run through the queue with an observationally equivalent recorded result (Property 11) |
| `@streetjs/events` (Pillar 3) | `EventsLike` (`publish/waitFor/subscribe`) | `ctx.events` | `publish` is fire-and-forget (failure recorded as `publish.failed`, run continues); `waitFor` parks as `waiting`; `subscribe` delivers matching events |
| `@streetjs/realtime` (Pillar 1) | `RealtimeLike` (`broadcast`) | `ctx.realtime` | Broadcasts on a channel; lifecycle transitions broadcast `workflow.started/progress/completed/failed/cancelled` carrying the runId; failures never block the run |

The engine composes rather than duplicates: coordination, typed data flow,
durability, retry/compensation, and signal/timer reaction are layered over the
existing pillars without absorbing their responsibilities.

---

## 7. Recommended Future Enhancements

1. **Distributed multi-node execution** — run leasing/ownership so a run can be
   resumed by any node, with fencing to preserve exactly-once semantics.
2. **Additional persistence stores** — SQL/Postgres and document-store
   `WorkflowStore` implementations behind their own submodules, mirroring the
   `./redis` isolation pattern.
3. **First-class external scheduler** — a durable cron/interval driver so
   scheduled workflows fire without an always-on in-process Clock.
4. **Visual history/DAG inspection** — a devtools view over `history()` and the
   command journal for debugging interruption/replay frontiers.
5. **Versioned workflow definitions** — safe migration of in-flight runs when a
   `Workflow_Function` changes shape between deployments.
6. **Batch/child-workflow orchestration** — a `ctx.childWorkflow` primitive for
   composing sub-workflows with independent durability.
7. **Live pillar contract tests in CI** — provision the four pillar packages and
   a Redis service in CI so the currently-skipped integration tests execute
   against real providers.

---

_Generated for spec task 24.1 (Final Implementation Report and full
verification). Requirements covered: 30.1–30.4, 31.1–31.6, 32.1–32.5._
