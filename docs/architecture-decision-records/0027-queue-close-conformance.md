# ADR 0027: Queue Close Conformance

**Status:** Accepted  
**Scope:** `@streetjs/queue` facade shutdown

## Decision

`QueueFacade.close()` owns one memoized close promise for the queue instance.
Concurrent and repeated callers observe the same completion or failure. Cleanup
continues through every worker, the scheduler, and the driver even when an
earlier cleanup step fails; failures are returned as one `AggregateError` after
all owned resources have been attempted.

The cleanup order remains:

1. stop and drain workers;
2. stop scheduler timers and cron schedulers;
3. close the queue driver.

## Rationale

Queue shutdown must not leave later-owned resources running merely because one
worker or backend close operation failed. A shared promise also makes repeated
shutdown deterministic and prevents a second driver close attempt.

## Non-goals

- forcibly cancelling in-flight job handlers;
- changing retry, reservation, or scheduler dispatch semantics;
- adding a queue-specific shutdown deadline;
- certifying Redis without a live Redis service.

## Evidence

Focused tests cover memoized close identity, one driver close attempt, and
preservation of the driver cleanup failure. The existing worker, scheduler,
driver-init, lifecycle-event, and Redis-skipped suites remain in the package
verification run.
