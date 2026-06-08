# Chaos / Fault-Injection Testing

Street ships a fault-injection toolkit for verifying resilience — retries,
backoff, circuit breakers, and graceful degradation — under adverse conditions.
Faults are **deterministic when seeded**, so chaos tests are reproducible.
Dependency-free; exported from `@streetjs/core`.

## `FaultInjector`

Injects latency and failures into async operations according to a policy:

```ts
interface FaultPolicy {
  errorRate?: number;   // probability [0,1] a call fails (uses the seeded PRNG)
  latencyMs?: number;   // fixed latency added before each call
  failAfter?: number;   // start failing after N successful calls
  failEvery?: number;   // fail every Nth call (deterministic)
  seed?: number;        // seed for errorRate decisions (default 1)
  error?: () => Error;  // custom error factory (default InjectedFaultError)
}
```

```ts
import { FaultInjector } from '@streetjs/core';

const fi = new FaultInjector({ failEvery: 3, latencyMs: 50 });
await fi.run(() => doWork());        // every 3rd call throws; all calls delayed 50ms
const flaky = fi.wrap(realFunction); // wrap any function under the policy
```

`failEvery`/`failAfter` are fully deterministic; `errorRate` is reproducible for
a fixed `seed`, so the exact pass/fail sequence is stable across runs.

## HTTP chaos middleware

Inject `503` responses (and latency) into a live server to exercise client
retry/timeout behaviour:

```ts
import { streetApp, chaosMiddleware } from '@streetjs/core';

const app = streetApp({});
app.use(chaosMiddleware({ errorRate: 0.2, latencyMs: 100 })); // 20% of requests → 503
```

## Resilience helper

`retryWithBackoff` is the counterpart used to prove that injected faults are
survived:

```ts
import { retryWithBackoff } from '@streetjs/core';

const result = await retryWithBackoff(() => callFlakyService(), {
  retries: 5, baseDelayMs: 50, maxDelayMs: 2000,
});
```

## Verification

`packages/core/src/tests/chaos.test.ts` (8 tests) covers deterministic
`failEvery`/`failAfter`, seeded reproducible `errorRate`, latency injection,
`wrap()`, `retryWithBackoff` surviving injected faults and rethrowing after
exhaustion, and the HTTP chaos middleware emitting `503`s on a **live Street app**
(verified: a `failEvery: 2` policy produces the status sequence
`[200, 503, 200, 503]`).

```bash
cd packages/core && npx tsc && node --test dist/src/tests/chaos.test.js
```
