<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/workflow

StreetJS Core v2 **Pillar 5**: a production-grade, strongly typed, **durable**
workflow orchestration engine. Workflows are authored as ordinary imperative
async functions and made durable through a journaled, deterministic-replay
execution model — so a multi-step process survives crashes and restarts,
retries and compensates failed work, and reacts to signals and timers, all with
no external services required to get started.

- **Imperative, typed authoring** — `createWorkflow(config)` returns a
  `WorkflowEngine`; you `define(name, fn)` a workflow whose body receives a typed
  `WorkflowContext` (`ctx`) and orchestrates work by awaiting activities.
- **Durable by default** — every effectful `ctx` call is journaled and persisted
  **before** control returns to your function (write-before-advance). On resume,
  recorded commands replay from the journal without re-executing, so an activity
  runs **exactly once**.
- **Zero-dependency persistence** — `streetjs` is the only runtime dependency.
  The default `MemoryWorkflowStore` needs nothing else.
- **Optional Redis persistence** — a Redis-backed store lives behind its own
  submodule (`@streetjs/workflow/redis`) and its client is an **optional peer
  dependency**, pulled in only when you use it.
- **Optional pillar bridges** — structural, no-hard-dependency integration with
  `@streetjs/storage`, `@streetjs/queue`, `@streetjs/events`, and
  `@streetjs/realtime`, plus reuse of the core `MetricsRegistry` /
  `HealthCheckRegistry`.
- **In-process test doubles** — `@streetjs/workflow/testing`.

## Install

```bash
npm install @streetjs/workflow
```

That is all you need for the in-memory store. Redis persistence requires the
optional `redis` peer dependency; the pillar bridges are satisfied structurally
by any matching shape, so no pillar package is required.

## Quick Start

```ts
import { createWorkflow } from "@streetjs/workflow";

// A zero-dependency engine backed by the in-memory store.
const engine = createWorkflow();

engine.define("greet", async (ctx, input: { name: string }) => {
  // Every ctx.activity call is journaled and reused on replay.
  const greeting = await ctx.activity(() => `Hello, ${input.name}!`);
  ctx.logger.info("greeted", { runId: ctx.metadata.runId });
  return greeting;
});

// run() returns a typed handle immediately; result() resolves on completion.
const handle = await engine.run<{ name: string }, string>("greet", { name: "Ada" });
console.log(handle.runId);
console.log(await handle.result()); // "Hello, Ada!"

console.log(await engine.status(handle.runId)); // "completed"
console.log(await engine.list());               // [{ runId, definition, status }]
console.log(await engine.history(handle.runId)); // ordered, append-only History

await engine.close();
```

`createWorkflow(config)` returns a `WorkflowEngine` with the full lifecycle
surface: `define`, `run`, `resume`, `pause`, `cancel`, `restart`, `status`,
`list`, `history`, `signal`, `definitions`, `stats`, and `close`.

### The canonical order-processing workflow

This is the shape most real workflows take — a sequence of activities with
retries and compensation, then side effects through the pillar bridges:

```ts
import { createWorkflow } from "@streetjs/workflow";

const engine = createWorkflow({
  bridges: { storage, queue, events, realtime }, // all optional, all structural
});

engine.define("order-processing", async (ctx, input: OrderInput) => {
  const order = await ctx.activity(() => receiveOrder(input), {
    metadata: { step: "receive" },
  });

  const inventory = await ctx.activity((signal) => validateInventory(order, signal), {
    timeout: 5_000,
    retry: {
      maxAttempts: 3,
      backoff: { strategy: "exponential", baseMs: 200, multiplier: 2, maxDelayMs: 5_000 },
    },
  });

  // If a later activity throws, chargeCard is rolled back automatically (saga).
  const charge = await ctx.activity((signal) => chargeCard(order, signal), {
    retry: { maxAttempts: 3, backoff: { strategy: "jitter", maxDelayMs: 4_000 } },
    compensate: () => refundCard(order),
  });

  const invoice = await ctx.activity(() => generateInvoice(order, charge));

  await ctx.storage.put(`invoices/${invoice.id}.pdf`, invoice.pdf);
  await ctx.events.publish("invoice.generated", { invoiceId: invoice.id });
  await ctx.realtime.broadcast("orders", { runId: ctx.metadata.runId, status: "invoice-ready" });
  const emailJob = await ctx.queue.dispatch("send-email", { invoiceId: invoice.id });

  return { orderId: order.id, invoiceId: invoice.id, emailJob };
});

const handle = await engine.run("order-processing", { cart: /* ... */ });
```

If the process crashes after `chargeCard` completes but before
`generateInvoice`, resuming replays `receiveOrder`, `validateInventory`, and
`chargeCard` from the journal (returning recorded results, charging the card
**exactly once**), then continues live from `generateInvoice`.

### Configuration

`createWorkflow(config?)` accepts a `WorkflowConfig`:

| Field | Type | Purpose |
|---|---|---|
| `store` | `WorkflowStore` | Persistence backend. Default: `new MemoryWorkflowStore()`. |
| `clock` | `Clock` | Inject deterministic time (timestamps, backoff, timer expiry). Default: `systemClock`. |
| `metrics` | `MetricsRegistry` | Register workflow metrics with the core registry. |
| `health` | `HealthCheckRegistry` | Register the persistence-store health check. |
| `rng` | `() => number` | Injectable RNG for `jitter` backoff (deterministic tests). |
| `bridges` | `{ storage?, queue?, events?, realtime? }` | Optional structural pillar bridges. |
| `autoResume` | `boolean` | Auto-resume non-terminal runs as definitions register. Default: `true`. |

Every field is optional — `createWorkflow()` with no arguments is a valid,
zero-dependency engine.

## Activities

An activity is the unit of durable work: `ctx.activity(fn, options?)`. The
function receives an `AbortSignal` (so it can be cancelled or time out) and its
result is recorded on first execution and **reused on replay** without re-running
the effect.

```ts
engine.define("charge", async (ctx, input: { orderId: string; amountCents: number }) => {
  // Simple activity — recorded once, reused on replay.
  const order = await ctx.activity(() => loadOrder(input.orderId));

  // With a timeout (Clock-measured), retries, and recorded metadata.
  const receipt = await ctx.activity(
    (signal) => paymentGateway.charge(order, input.amountCents, signal),
    {
      timeout: 10_000,
      retry: {
        maxAttempts: 5,
        backoff: { strategy: "exponential", baseMs: 250, multiplier: 2, maxDelayMs: 8_000 },
      },
      metadata: { gateway: "stripe" },
    },
  );

  return receipt.id;
});
```

`ActivityOptions` fields: `timeout` (ms), `retry` (a `RetryPolicy`), `metadata`,
`compensate` (see Sagas), `middleware` (wrap each attempt), and `viaQueue`
(execute through the queue bridge — see Queue integration). An activity with no
`retry` runs at most once.

### Branching, timers, state, and logging

`ctx` also exposes deterministic local helpers (not journaled) and journaled
timers:

```ts
engine.define("reminders", async (ctx, input: { premium: boolean }) => {
  // Local, deterministic branching.
  await ctx.if(input.premium)
    .then(() => { /* premium path */ })
    .else(() => { /* standard path */ });

  // Journaled timers — survive restarts by absolute expiry.
  await ctx.sleep(60_000);                       // wait 60s
  await ctx.waitUntil(Date.parse("2025-01-01")); // wait until an absolute instant

  // Durable per-run state: writes persist with the run, reads survive replay.
  await ctx.state.set("phase", "notified");
  const phase = ctx.state.get<string>("phase");

  ctx.logger.info("reminder sent", { phase, at: ctx.clock() });
});
```

Also available: `ctx.switch(selector, cases, defaultBranch?)`,
`ctx.match(value, patterns, defaultBranch?)`, `ctx.cron(expression, body)`, and
`ctx.interval(durationMs, body)`. Ambient metadata is on `ctx.metadata`
(`runId`, `definition`, `attempt`).

## Parallel workflows

`ctx.parallel` composes activities concurrently with **deterministic positional
ordering**, so replay reconstructs the same result tuple every time.

```ts
engine.define("dashboard", async (ctx, userId: string) => {
  // all — typed positional tuple; resolves when every activity settles.
  const [profile, orders, prefs] = await ctx.parallel.all([
    () => loadProfile(userId),
    (signal) => loadOrders(userId, signal),
    () => loadPreferences(userId),
  ]);

  // race — the first activity to settle wins.
  const fastest = await ctx.parallel.race([
    (signal) => primaryRegion(userId, signal),
    (signal) => fallbackRegion(userId, signal),
  ]);

  // map — one activity per item, results in item order.
  const enriched = await ctx.parallel.map(orders, (order) => () => enrichOrder(order));

  return { profile, orders, prefs, fastest, enriched };
});
```

## Sagas

A saga is a sequence of activities where each completed step declares how to undo
itself. When a later activity fails terminally, the engine automatically runs the
recorded compensations **in reverse completion order** and the run reaches the
`compensated` status. You author a saga by attaching a `compensate` handler to
each reversible activity:

```ts
engine.define("book-trip", async (ctx, input: TripInput) => {
  const flight = await ctx.activity((s) => bookFlight(input, s), {
    compensate: (booked) => cancelFlight(booked),
  });

  const hotel = await ctx.activity((s) => bookHotel(input, s), {
    compensate: (booked) => cancelHotel(booked),
  });

  // If this throws, cancelHotel then cancelFlight run automatically (reverse order).
  const car = await ctx.activity((s) => bookCar(input, s), {
    compensate: (booked) => cancelCar(booked),
  });

  return { flight, hotel, car };
});
```

The `compensate` handler receives the activity's recorded output and an
`AbortSignal`: `(output, signal) => Promise<void> | void`. Compensation is driven
over the durable journal, so it is rebuilt deterministically on resume before any
rollback runs. The `Saga` authoring interface (`step` / `compensate` / `rollback`)
is exported as a type describing this model; the `compensate` option shown above
is the primary supported path and maps onto the same compensator machinery.

## Compensation

Compensation is the rollback half of a saga. The rules:

- Only **completed** activities that declared a `compensate` handler are rolled
  back.
- Rollbacks run in **reverse completion order** — the most recently completed
  compensable activity is undone first.
- Each rollback runs **exactly once**; the History records
  `compensation.started` / `compensation.completed` (or `compensation.failed`)
  per step.
- After compensation, the run's terminal status is `compensated`, and
  `handle.result()` rejects (the run did not complete successfully).

```ts
try {
  await handle.result();
} catch {
  const status = await engine.status(handle.runId); // "compensated" or "failed"
  const history = await engine.history(handle.runId);
  // history contains compensation.started / compensation.completed events, newest seq first
}
```

A run with no completed compensable activities transitions to `failed` instead.

## Retry policies

A `RetryPolicy` is `{ maxAttempts, backoff }`, where `maxAttempts` counts the
initial attempt plus retries (default behavior with no `retry` is a single
attempt). Four backoff strategies are supported:

```ts
// Fixed — constant delay between attempts.
const fixed = { strategy: "fixed", delayMs: 1_000 } as const;

// Linear — grows by baseMs each attempt, capped at maxDelayMs.
const linear = { strategy: "linear", baseMs: 500, maxDelayMs: 5_000 } as const;

// Exponential — baseMs * multiplier^n, capped at maxDelayMs.
const exponential = { strategy: "exponential", baseMs: 200, multiplier: 2, maxDelayMs: 8_000 } as const;

// Jitter — randomized delay in [0, maxDelayMs) (uses the injectable rng).
const jitter = { strategy: "jitter", maxDelayMs: 4_000 } as const;

await ctx.activity((signal) => flakyCall(signal), {
  retry: { maxAttempts: 5, backoff: exponential },
});
```

Backoff delays are measured on the injected `Clock`, so tests can advance a
`FakeClock` to fire retry windows without waiting. The pure delay math is also
exported as `computeBackoff` for inspection. Retries are bounded: after
`maxAttempts` the activity fails and the run either compensates or fails.

## Queue integration

Wire a structural `bridges.queue` (`{ dispatch(job, payload), execute? }`) to
hand background work to `@streetjs/queue` without a hard dependency.

```ts
const engine = createWorkflow({
  bridges: { queue: myQueueLike }, // { dispatch(job, payload): Promise<string> }
});

engine.define("notify", async (ctx, input: { userId: string }) => {
  // Dispatch a background job; the journaled jobId flows back unchanged.
  const jobId = await ctx.queue.dispatch("send-email", { userId: input.userId });
  return jobId;
});
```

If the queue bridge also provides `execute`, you can route an activity through
the queue by setting `viaQueue: true`. A `viaQueue` activity and a bridgeless run
produce an observationally equivalent result:

```ts
await ctx.activity((signal) => heavyComputation(signal), { viaQueue: true });
```

Using `ctx.queue` without a wired queue bridge raises a `WorkflowConfigError`; a
workflow that never touches the bridge runs unchanged.

## Storage integration

Wire a structural `bridges.storage` to persist objects through
`@streetjs/storage`. The `ctx.storage` surface is journaled, so writes are not
repeated on replay.

```ts
const engine = createWorkflow({ bridges: { storage: myStorageLike } });

engine.define("archive", async (ctx, input: { key: string; body: Uint8Array }) => {
  await ctx.storage.put(input.key, input.body, { contentType: "application/pdf" });

  const result = await ctx.storage.get(input.key);
  if (result.found) {
    ctx.logger.info("archived", { bytes: result.bytes?.byteLength });
  }

  await ctx.storage.copy(input.key, `backup/${input.key}`);
  await ctx.storage.move(input.key, `done/${input.key}`);
  await ctx.storage.delete(`backup/${input.key}`);
});
```

`ctx.storage` methods: `put(key, content, options?)`, `get(key)` (returns
`{ found, bytes?, metadata? }`, never throws on a missing key), `delete(key)`,
`move(from, to)`, and `copy(from, to)`.

## Events integration

Wire a structural `bridges.events`
(`{ publish(event, payload), waitFor(event), subscribe(event, handler) }`) to
integrate with `@streetjs/events`.

```ts
const engine = createWorkflow({ bridges: { events: myEventsLike } });

engine.define("await-approval", async (ctx, input: { docId: string }) => {
  // Fire-and-forget publish; a failure is recorded and the run continues.
  await ctx.events.publish("review.requested", { docId: input.docId });

  // Park the run as `waiting` until a matching event arrives, with optional parsing.
  const decision = await ctx.events.waitFor<{ approved: boolean }>("review.decided", {
    parse: (p) => p as { approved: boolean },
  });

  return decision.approved ? "published" : "rejected";
});
```

`ctx.events.subscribe(event, handler)` delivers each matching event to the
handler and returns an unsubscribe function. A run parked on `waitFor` resumes
when a matching event is delivered — you can drive one explicitly with
`engine.signal(runId, name, payload)`.

## Realtime integration

Wire a structural `bridges.realtime` (`{ broadcast(channel, event, payload) }`)
to push live updates through `@streetjs/realtime`.

```ts
const engine = createWorkflow({ bridges: { realtime: myRealtimeLike } });

engine.define("live-order", async (ctx, input: OrderInput) => {
  await ctx.activity(() => processOrder(input));
  // ctx.realtime.broadcast(channel, payload)
  await ctx.realtime.broadcast("orders", { runId: ctx.metadata.runId, status: "done" });
});
```

Beyond your own `ctx.realtime.broadcast` calls, the engine also broadcasts
run-lifecycle events on transitions — `workflow.started`, `workflow.progress`,
`workflow.completed`, `workflow.failed`, and `workflow.cancelled`, each carrying
the `runId`. Lifecycle broadcasts are best-effort: a missing realtime bridge
simply means no broadcasts, and workflows proceed unaffected.

## Storage backends

### Memory (default)

The zero-dependency `MemoryWorkflowStore` is used automatically when no `store`
is configured. It exercises durability, resume, retry, timers, and compensation
fully in-process.

```ts
import { createWorkflow, MemoryWorkflowStore } from "@streetjs/workflow";

const engine = createWorkflow({ store: new MemoryWorkflowStore() });
```

### Redis — `@streetjs/workflow/redis`

For persistence across process restarts, use the Redis-backed store. It is
reachable **only** through the submodule, and the Redis client is depended upon
structurally (through the `RedisLike` shape) and declared as an optional peer
dependency.

```ts
import { createClient } from "redis";
import { createWorkflow } from "@streetjs/workflow";
import { RedisWorkflowStore } from "@streetjs/workflow/redis";

const client = createClient({ url: process.env.REDIS_URL });
await client.connect();

const engine = createWorkflow({
  store: new RedisWorkflowStore({ client, keyPrefix: "workflow:" }),
});
```

`RedisWorkflowStore` implements the identical `WorkflowStore` contract as the
memory store and is fully substitutable — for equivalent inputs the two produce
the same observable `Run_Status`, recorded activity results, and History.
Incomplete (non-terminal) runs are resumed on startup, so a workflow interrupted
by a restart continues from its journal.

## Plugin

Register the engine in the StreetJS plugin system with `WorkflowPlugin`. Its
options extend `WorkflowConfig`, so the `store`, `clock`, `bridges`, and the
`metrics` / `health` registries are all supplied through the plugin. The live
engine is available via `plugin.workflow` after load.

```ts
import { WorkflowPlugin } from "@streetjs/workflow";

const plugin = new WorkflowPlugin({
  bridges: { storage, queue, events, realtime },
  metrics,
  health,
});

await plugin.onLoad(app);
const engine = plugin.workflow!; // the live WorkflowEngine

engine.define("order-processing", orderProcessing);
```

`onLoad` constructs the engine (wiring observability and resuming incomplete
runs); `onUnload` closes it gracefully, settling in-flight resumes.

## Observability

Pass the core `MetricsRegistry` and/or `HealthCheckRegistry` and the engine
registers workflow metrics (running/completed/failed counts, retries,
compensations, duration, active timers, queued activities) and a
persistence-store health check. `engine.stats()` returns a live snapshot.

```ts
const engine = createWorkflow({ metrics, health });

const snapshot = engine.stats();
// { running, waiting, completed, failed, compensated, cancelled,
//   activityRetries, compensations, activeTimers, queuedActivities }
```

Observability is fully opt-in and registration is idempotent; when neither
registry is configured it is an inert no-op.

## Testing

`@streetjs/workflow/testing` provides in-process, zero-network doubles — none
require Redis or an external service.

```ts
import {
  MemoryWorkflow,
  WorkflowHarness,
  FakeClock,
  FakeWorkflow,
} from "@streetjs/workflow/testing";

// A real engine over the in-memory store — durability, resume, retry, timers,
// and compensation are exercised end-to-end in-process.
const engine = MemoryWorkflow();

// A function-callable, advanceable Clock: clock() reads virtual time.
const clock = FakeClock(0);
clock.advance(60_000); // move virtual time forward to fire timers / backoff windows

// A harness bundling a real engine, a FakeClock, and assertion helpers.
const harness = new WorkflowHarness();
harness.engine.define("order-processing", orderProcessing);
const handle = await harness.engine.run("order-processing", input);
await harness.advance(60_000); // advance the clock and settle due timers
await harness.assertStatus(handle.runId, "completed");
await harness.assertHistory(handle.runId, ["run.started", /* ... */]);
await harness.assertCompensatedInReverseOrder(handle.runId);

// A recording double that captures interactions without executing them.
const fake = new FakeWorkflow();
fake.define("order-processing", orderProcessing);
await fake.run("order-processing", input);
await fake.signal("fake-run-0", "review.decided", { approved: true });
console.log(fake.startedRuns);      // recorded runs
console.log(fake.deliveredSignals); // recorded signals
```

Pass a `FakeClock` to `MemoryWorkflow({ clock })` or use a `WorkflowHarness` when
a workflow has timers or backoff windows, so time-dependent behavior advances on
demand instead of waiting on the wall clock.

## Migration

Coming from a declarative step-graph engine, or a bespoke job/state-machine
layer? The main changes:

- **Author workflows as ordinary async functions**, not a declarative graph or
  YAML. Register with `engine.define(name, fn)` and orchestrate by awaiting
  `ctx` calls. Control flow is just JavaScript (`if`, loops, `try/catch`).
- **Do effectful work through `ctx`**, never directly. `ctx.activity`,
  `ctx.parallel.*`, `ctx.sleep`/`waitUntil`/`cron`/`interval`, and the
  `ctx.storage`/`queue`/`events`/`realtime` bridges are journaled so they replay
  correctly. Reading `Date.now()` or calling a service outside an activity breaks
  determinism — read time via `ctx.clock` and wrap side effects in `ctx.activity`.
- **Retries and compensation are first-class options** on an activity
  (`retry`, `compensate`) rather than separate wrappers or an external retry
  system.
- **Persistence is a config choice**, not a rewrite: start on the default
  `MemoryWorkflowStore`, then switch to `RedisWorkflowStore` from
  `@streetjs/workflow/redis` by changing only the `store` field.
- **Pillar integration is structural** — pass `bridges` shapes; there is no hard
  dependency on any pillar package.

## Best practices

- **Keep side effects inside activities.** Any call that touches the outside
  world (network, disk, randomness) belongs in `ctx.activity` so it is journaled
  and runs exactly once across replays.
- **Read time through `ctx.clock`, not `Date.now()`.** Determinism during replay
  depends on all time reads going through the injected `Clock`.
- **Make activities idempotent where you can.** An activity is recorded once, but
  idempotency is the safest guard against duplicate external effects during
  failures and retries.
- **Declare `compensate` for anything reversible.** If a later step can fail,
  give earlier steps a rollback so the run compensates cleanly instead of leaving
  partial state.
- **Choose backoff to match the failure mode.** Use `jitter` (or `exponential`
  with a cap) for contended external services to avoid retry storms; use `fixed`
  for predictable, rate-limited calls.
- **Bound your retries.** Set a deliberate `maxAttempts`; unbounded retries hide
  real failures and delay compensation.
- **Prefer `ctx.parallel` over manual `Promise.all`** for concurrent activities,
  so ordering stays deterministic across replays.
- **Test with `WorkflowHarness` and a `FakeClock`.** Advance virtual time to
  exercise timers, backoff, and resume without wall-clock waits.
- **Set `metadata` on activities** to make History and metrics easy to read in
  production.

## License

MIT
