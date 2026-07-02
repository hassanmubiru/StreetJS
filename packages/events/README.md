# @streetjs/events

The **application event layer** for StreetJS: a strongly-typed, plugin-first,
in-process event system for loose coupling between modules. Publish an event
from one module; other modules react without a direct dependency.

```ts
import { createEvents } from '@streetjs/events';

interface AppEvents {
  'user.created': User;
  'payment.completed': Payment;
  'order.shipped': Order;
}

const events = createEvents<AppEvents>();

events.on('user.created', async (user) => {   // `user` is typed as User
  await sendWelcomeEmail(user.email);
});

await events.publish('user.created', user);
```

> **This is not a message broker.** For cross-process/distributed messaging use
> the core `EventBus` (Redis/RabbitMQ/Kafka transports); for event sourcing use
> the core `EventStore`. `@streetjs/events` is the *in-process* application event
> layer. Its only runtime dependency is `streetjs` — it reuses the core metrics,
> health, plugin SDK, CLI, and clock rather than reinventing them.

Delivery is **at-least-once within a process** and honest about it — see
[Delivery semantics](#delivery-semantics).

## Contents

- [Install](#install)
- [Quick Start](#quick-start)
- [Publishing Events](#publishing-events)
- [Listening](#listening)
- [Typed Events](#typed-events)
- [Wildcards](#wildcards)
- [Middleware](#middleware)
- [Replay](#replay)
- [Observability](#observability)
- [Testing](#testing)
- [Integration with Queue](#integration-with-queue)
- [Integration with Realtime](#integration-with-realtime)
- [Plugin Integration](#plugin-integration)
- [Delivery semantics](#delivery-semantics)

## Install

```bash
npm install @streetjs/events streetjs
```

ESM (`"type": "module"`), ships type declarations. Uses no third-party runtime
dependency.

## Quick Start

```ts
import { createEvents, Event } from '@streetjs/events';

interface AppEvents {
  'user.created': { id: string; email: string };
}

const events = createEvents<AppEvents>();

// Subscribe.
events.on('user.created', async (user, ctx) => {
  console.log(`created ${user.email} (event ${ctx.id})`);
});

// Publish (string form) — awaits all listeners.
await events.publish('user.created', { id: 'u1', email: 'a@b.com' });

// Or publish a class-based event.
class UserCreated extends Event<{ id: string; email: string }> {
  readonly type = 'user.created';
}
await events.publish(new UserCreated({ id: 'u2', email: 'c@d.com' }));

await events.close(); // remove listeners, drain fire-and-forget deliveries
```

## Publishing Events

- **`publish(name, payload)`** — awaited, ordered synchronous dispatch: resolves
  after every listener settles, delivered in registration order.
- **`publish(new SomeEvent(payload))`** — the class-based form; routed by the
  event's `type`.
- **`publishAsync(...)` / `emit(...)`** — fire-and-forget: returns immediately.
  Deliveries run on an **ordered async queue** that preserves publish order.
- **`flush()`** — await all queued fire-and-forget deliveries.

```ts
await events.publish('order.shipped', order);      // awaited
events.emit('metrics.tick', { at: Date.now() });   // fire-and-forget
await events.flush();                               // drain fire-and-forget
```

Optional per-publish `metadata` / `tenantId` ride on the event context:

```ts
await events.publish('user.created', user, { tenantId: 'acme', metadata: { actor: 'admin' } });
```

## Listening

```ts
const off = events.on('user.created', (user, ctx) => { /* ... */ });
off();                                    // unsubscribe (idempotent)

events.once('user.created', (user) => { /* fires exactly once */ });
```

Every listener receives the payload and an `EventContext` (`event`, `id`,
`timestamp`, `metadata`, `tenantId`).

## Typed Events

`createEvents<AppEvents>()` makes the whole surface type-safe. `AppEvents` is a
plain interface — no index signature required:

```ts
interface AppEvents {
  'user.created': User;
  'payment.completed': Payment;
  'order.shipped': Order;
}
const events = createEvents<AppEvents>();

events.on('user.created', (user) => user.email);   // user: User ✓
events.publish('order.shipped', order);             // payload checked ✓
// events.publish('user.created', order);           // ✗ compile error
```

## Wildcards

Subscribe to patterns. `*` matches exactly one segment; `**` matches one or more:

```ts
events.on('user.*',  (payload, ctx) => { /* user.created, user.updated */ });
events.on('order.**',(payload, ctx) => { /* order.shipped, order.line.added */ });
events.on('**',      (payload, ctx) => { /* every event */ });
```

Wildcard payloads are typed as the **union** of matching event payloads, and
`ctx.event` is the concrete event name that fired. Delivery order across exact
and wildcard listeners is strict registration order.

## Middleware

Middleware wrap the dispatch of one event (delivery to all its listeners) — the
place for logging, metrics, tracing, tenant context, authorization, and audit.
They run once per event, in registration order:

```ts
// Logging / audit.
events.use(async (ctx, payload, next) => {
  console.log('event', ctx.event, ctx.id);
  await next();
});

// Tenant context — visible to every listener for the rest of dispatch.
events.use(async (ctx, _payload, next) => {
  (ctx as { tenantId?: string }).tenantId = resolveTenant();
  await next();
});

// Authorization — a middleware that throws (or omits next()) vetoes delivery.
events.use(async (ctx, payload, next) => {
  if (!authorized(ctx)) throw new Error('forbidden'); // rejects publish, skips listeners
  await next();
});
```

A **middleware** error propagates to the publisher (policy can veto). A
**listener** error is isolated (metered + routed to `onError`) and never blocks
siblings or the publisher:

```ts
const events = createEvents<AppEvents>({ onError: (err, ctx) => logger.error(ctx.event, err) });
```

## Replay

Provide an `EventStore` to persist published events and replay them to current
listeners. The package ships `MemoryEventStore`; the `EventStore` interface is a
pluggable seam for future Postgres/Redis/Kafka adapters.

```ts
import { createEvents, MemoryEventStore } from '@streetjs/events';

const events = createEvents<AppEvents>({ store: new MemoryEventStore() });
await events.publish('user.created', user);   // persisted

// Later — re-dispatch stored events (optionally filtered), in publish order.
await events.replay();                          // all stored events
await events.replay({ pattern: 'user.*' });     // only user.* events
await events.replay({ since: Date.now() - 3600_000 });
```

Replayed events are re-dispatched through middleware and listeners but are **not**
re-persisted.

### Durable event store (Redis)

For durable, shareable replay across restarts, use the opt-in Redis-backed store
(built on the core zero-dependency `RedisClient`):

```ts
import { createEvents } from '@streetjs/events';
import { RedisEventStore } from '@streetjs/events/redis';
import { RedisClient } from 'streetjs';

const store = new RedisEventStore({ client: new RedisClient({ host, port }) });
const events = createEvents<AppEvents>({ store });

await events.publish('user.created', user);  // persisted to Redis (ZSET, INCR-scored)
await events.replay({ pattern: 'user.*' });   // durable, ordered replay
```

The `EventStore` interface is the pluggable seam; `MemoryEventStore` (default,
zero-dep), `RedisEventStore`, and `PostgresEventStore` all implement it and are
behaviorally equivalent for `read`/`count`/replay.

### Durable event store (Postgres)

For relational durability, use the opt-in Postgres store (built on the core
`PgPool`, no new runtime dependency):

```ts
import { createEvents } from '@streetjs/events';
import { PostgresEventStore, POSTGRES_EVENTS_MIGRATION_SQL } from '@streetjs/events/postgres';
import { PgPool } from 'streetjs';

const pool = new PgPool({ host, port, user, password, database });
const store = new PostgresEventStore({ pool });   // table: street_events
await store.init();                                // runs POSTGRES_EVENTS_MIGRATION_SQL

const events = createEvents<AppEvents>({ store });
await events.publish('user.created', user);        // persisted (JSONB, store_seq-ordered)
await events.replay({ pattern: 'user.*' });
```

### Distributed fan-out (EventBus)

Application events are in-process by design. To fan them out across processes,
bridge selected events onto the core `EventBus` (which can run over
Redis/RabbitMQ/Kafka). Wiring both directions is loop-safe — inbound events are
tagged so they are not echoed back out:

```ts
import { EventBus } from 'streetjs';
import { forwardToBus, forwardFromBus } from '@streetjs/events/bus';

const bus = new EventBus(/* optional distributed transport */);

// Local events fan out to the bus for other instances.
forwardToBus(events, bus, [{ appEvent: 'order.shipped' }]);

// Bus messages arrive as local application events (tagged, so no loop).
forwardFromBus(bus, events, [{ topic: 'order.shipped' }]);
```

Or wire both directions in one call with `connectBus` (returns a single detach):

```ts
import { EventBus, RedisEventBusTransport } from 'streetjs';
import { connectBus } from '@streetjs/events/bus';

// Any core transport plugs in: in-process (default), Redis, RabbitMQ, Kafka.
const bus = new EventBus(new RedisEventBusTransport({ host, port }));

const detach = connectBus(events, bus, {
  toBus:   [{ appEvent: 'order.*' }],
  fromBus: [{ topic: 'order.shipped' }],
});
```

An event published on one instance is delivered as a local application event on
every other instance connected to the same bus — that is the cross-process
fan-out. The loop guard ensures an inbound event is never echoed back out.

## Observability

Wire a health check and metrics onto the reused core registries. The `telemetry`
sink feeds live counters/latency; `attach` registers the health check + gauges:

```ts
import { HealthCheckRegistry, MetricsRegistry } from 'streetjs';
import { createEvents, registerEventsObservability } from '@streetjs/events';

const health = new HealthCheckRegistry();
const metrics = new MetricsRegistry();

const obs = registerEventsObservability({ health, metrics });
const events = createEvents<AppEvents>({ telemetry: obs.telemetry });
obs.attach(events);
```

Exposed metrics: `events_published_total`, `events_delivered_total`,
`events_failed_total` (failed handlers), `event_handler_latency_seconds`
(handler latency), `events_listeners` (subscribers), and `events_async_pending`
(fire-and-forget queue depth). The `events` health check reports `up` for the
in-process dispatcher and `down` if a configured store is unreachable.

(The `EventsPlugin` does all of this wiring for you — see below.)

### Distributed tracing (OpenTelemetry)

`createEventsTracing` emits one span per published event and propagates W3C
trace context, so a publish issued from inside a listener becomes a **child
span** automatically (via `AsyncLocalStorage`). It reuses the core `OtelTracer`.

```ts
import { OtelTracer } from 'streetjs';
import { createEvents, createEventsTracing } from '@streetjs/events';

const tracer = new OtelTracer({ serviceName: 'app' });
const tracing = createEventsTracing(tracer);

const events = createEvents<AppEvents>({ telemetry: tracing.telemetry });
events.use(tracing.middleware);
```

Each span is named `event <name>` with `event.name` / `event.id` /
`event.tenant_id` attributes; the telemetry sink adds `event.delivered` /
`event.failed`. A middleware veto marks the span as an error; **isolated
listener failures do not** (they are recorded as `event.failed`, consistent with
the delivery semantics below). An inbound `traceparent` on the event metadata is
honored as the parent, so traces flow across the queue/realtime/bus bridges.

## Testing

Redis-free, timing-free utilities:

- **`FakeEvents`** — records every publish/emit call (name + payload + options)
  and delivers synchronously. Assert *that* an event was published.
- **`createMemoryEvents`** — a real facade over a `MemoryEventStore` (replay
  enabled) for end-to-end tests.
- **`TestHarness`** — a real facade with an injected, advanceable clock plus
  recording (`published`) and assertions (`assertPublished`, `assertOrder`).

```ts
import { createFakeEvents, TestHarness } from '@streetjs/events';

const fake = createFakeEvents<AppEvents>();
await fake.publish('user.created', user);
fake.wasPublished('user.created');       // true
fake.payloadsFor('user.created');        // [user]

const harness = new TestHarness<AppEvents>({ now: 1000 });
harness.advance(500);
await harness.publish('user.created', user);   // ctx.timestamp === 1500
harness.assertPublished('user.created');
```

## Integration with Queue

Bridge `@streetjs/queue` lifecycle events into application events. The bridge
uses a **structural** interface (no `@streetjs/queue` dependency), so wiring is
decoupled and there is no circular package dependency.

```ts
import { bridgeQueueEvents } from '@streetjs/events/queue';

// queue.on('job.completed', ...) ──▶ events.publish('report.generated', ...)
bridgeQueueEvents(queue, events, [
  {
    queueEvent: 'job.completed',
    appEvent: 'report.generated',
    map: (e) => ({ jobId: e.ctx.id, url: `/reports/${e.ctx.id}` }),
  },
]);
```

## Integration with Realtime

Bridge application events to `@streetjs/realtime` room broadcasts (also via a
structural interface):

```ts
import { bridgeRealtimeEvents } from '@streetjs/events/realtime';

// events.on('report.generated', ...) ──▶ realtime.room('reports').broadcast(...)
bridgeRealtimeEvents(events, realtime, [
  { appEvent: 'report.generated', room: 'reports' },
  { appEvent: 'order.*', room: (o) => `orders:${o.id}` }, // per-entity room
]);
```

## Plugin Integration

`EventsPlugin` constructs the facade, wires observability, and runs a startup
hook so plugins/modules register their listeners during load:

```ts
import { EventsPlugin } from '@streetjs/events';
import { HealthCheckRegistry, MetricsRegistry } from 'streetjs';

const plugin = new EventsPlugin<AppEvents>({
  health: new HealthCheckRegistry(),
  metrics: new MetricsRegistry(),
  register: (events) => {
    events.on('user.created', sendWelcomeEmail);
  },
});

await plugin.onLoad(app);
const events = plugin.events;   // the live facade
// ...
await plugin.onUnload(app);     // detaches bridges, closes observability + facade
```

Bridges can be wired declaratively at load — each entry is an attach function
that may return a detach called on unload. This keeps the plugin decoupled from
any specific integration:

```ts
import { forwardToBus } from '@streetjs/events/bus';
import { bridgeRealtimeEvents } from '@streetjs/events/realtime';

new EventsPlugin<AppEvents>({
  bridges: [
    (events) => forwardToBus(events, bus, [{ appEvent: 'order.shipped' }]),
    (events) => bridgeRealtimeEvents(events, realtime, [{ appEvent: 'report.generated', room: 'reports' }]),
  ],
});
```

### CLI

```bash
street make:event UserCreated       # scaffolds a typed Event class
street make:listener UserCreated     # scaffolds a listener registration
```

Generated scaffolds import only public `@streetjs/events` symbols and compile
under `tsc`.

## Delivery semantics

`@streetjs/events` is an **in-process** event layer:

- `publish` delivers to all listeners in registration order and awaits them;
  listener failures are isolated (metered + `onError`), never blocking siblings
  or the publisher.
- `publishAsync`/`emit` are fire-and-forget with **ordered** async delivery.
- Delivery is **at-least-once for the process lifetime**: with replay, a stored
  event can be re-delivered. It is **not** exactly-once and **not** durable
  cross-process — design listeners to be idempotent, e.g. keyed on `ctx.id`.
- For cross-process/distributed delivery, publish onto the core `EventBus` from
  a listener (or use the core bus directly). This package intentionally does not
  reimplement a broker.
