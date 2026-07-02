// src/index.ts
// @streetjs/events — public typed surface for the StreetJS application event
// layer. This is an in-process event system (loose coupling between modules),
// NOT a message broker: for cross-process/distributed messaging use the core
// `EventBus`, and for event sourcing use the core `EventStore`.
//
// Integration bridges (`./queue`, `./realtime`) are opt-in submodule exports so
// this package depends only on `streetjs`.

// ── Event model ────────────────────────────────────────────────────────────────
export { Event, isEvent, buildEnvelope } from './event.js';
export type {
  EventMap,
  AnyEventMap,
  EventName,
  EventPayload,
  EventContext,
  EventListener,
  EventEnvelope,
  SerializedError,
  Awaitable,
  MatchingEventNames,
  WildcardPayload,
} from './event.js';

// ── Wildcard matching ───────────────────────────────────────────────────────────
export { isWildcard, matchesPattern } from './matcher.js';

// ── Facade ──────────────────────────────────────────────────────────────────────
export { createEvents } from './facade.js';
export type {
  Events,
  EventsOptions,
  EventsStats,
  EventsTelemetry,
  PublishOptions,
  ErrorHandler,
  Unsubscribe,
} from './facade.js';

// ── Middleware ────────────────────────────────────────────────────────────────
export { composePipeline } from './middleware.js';
export type { EventMiddleware, DeliveryStep, PipelineRunner } from './middleware.js';

// ── Event store ─────────────────────────────────────────────────────────────────
export { MemoryEventStore } from './store/memory.js';
export type { MemoryEventStoreOptions } from './store/memory.js';
export type { EventStore, ReplayFilter } from './store/store.js';
