# @streetjs/health

The health foundation for StreetJS: a **framework-agnostic health-check registry** with
liveness / readiness / startup checks, per-check timeouts, criticality, status
aggregation, and **IETF `health+json`** reporting.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS
minimal, carefully curated dependency footprint. Generic and reusable by any
application — not tied to any particular StreetJS package or HTTP server.

```bash
npm install @streetjs/health
```

## Why

Every service needs to answer two questions for orchestrators (Kubernetes, load
balancers, uptime monitors): *is the process alive?* (liveness) and *can it serve
traffic?* (readiness). `@streetjs/health` provides one registry to declare checks,
run them with timeouts, aggregate their statuses, and render a standard report —
independent of any HTTP framework, so you wire the result into whatever server you use.

## Quick start

```ts
import { HealthRegistry } from '@streetjs/health';

const health = new HealthRegistry();

health.register({ name: 'process', kind: 'liveness', check: () => {} });

health.register({
  name: 'database',
  kind: 'readiness',
  check: async () => { await db.query('SELECT 1'); }, // no throw = pass
});

health.register({
  name: 'cache',
  kind: 'readiness',
  critical: false, // a cache outage degrades to "warn", it doesn't fail readiness
  check: async () => { await redis.ping(); },
});

// In your HTTP layer:
app.get('/health/live', async (_req, res) => {
  const { statusCode, contentType, body } = await health.endpoint('liveness');
  res.writeHead(statusCode, { 'Content-Type': contentType }).end(body);
});
app.get('/health/ready', async (_req, res) => {
  const { statusCode, contentType, body } = await health.endpoint('readiness');
  res.writeHead(statusCode, { 'Content-Type': contentType }).end(body);
});
```

## Checks

A check is a sync or async function. Its return value determines the outcome:

- returns nothing → **pass**
- returns `{ status, output?, observedValue?, observedUnit?, ...extra }` → that status
  (default `pass`), with the extra fields captured as `details`
- throws → **fail** (the error message becomes `output`)
- exceeds `timeoutMs` → **fail** (`timed out after Nms`)

```ts
health.register({
  name: 'disk',
  check: () => {
    const freePct = getFreeDiskPercent();
    if (freePct < 5) return { status: 'fail', output: 'disk almost full', observedValue: freePct, observedUnit: 'percent' };
    if (freePct < 15) return { status: 'warn', observedValue: freePct, observedUnit: 'percent' };
    return { status: 'pass', observedValue: freePct, observedUnit: 'percent' };
  },
});
```

Registration options: `name` (unique), `check`, `kind` (`liveness` | `readiness` |
`startup`, default `readiness`), `critical` (default `true`), `timeoutMs` (default `5000`).

## Status aggregation

| Overall | When | HTTP |
|---|---|---|
| `pass` | all checks pass | 200 |
| `warn` | a `warn`, or a **non-critical** check failed | 200 |
| `fail` | a **critical** check failed | 503 |

`endpoint(kind?)` returns `{ statusCode, contentType, body, report }` — `statusCode` is
200 for pass/warn and 503 for fail, `contentType` is `application/health+json`.

## Report format (IETF `health+json`)

```json
{
  "status": "warn",
  "time": "2026-07-14T00:00:00.000Z",
  "checks": {
    "database": [{ "name": "database", "kind": "readiness", "critical": true, "status": "pass", "time": "…", "durationMs": 3, "observedValue": 3, "observedUnit": "ms" }],
    "cache":    [{ "name": "cache", "kind": "readiness", "critical": false, "status": "fail", "time": "…", "durationMs": 5, "output": "redis connection refused" }]
  }
}
```

## Registry API

```ts
health.register(options);
health.unregister('database');       // → boolean
health.get('database');              // metadata or undefined
health.list('readiness');            // metadata for a kind
await health.run();                  // all kinds
await health.liveness();             // kind shortcuts
await health.readiness();
await health.startup();
await health.endpoint('readiness');  // HTTP-ready response
health.clear();
health.contentType;                  // "application/health+json"
```

Pass `{ clock }` to the constructor to inject time for deterministic tests.

## Dependency injection

This package depends on no container. It exports a `HEALTH_REGISTRY` token (a global
`Symbol`) for interface-first wiring:

```ts
import { HEALTH_REGISTRY, HealthRegistry } from '@streetjs/health';
container.register(HEALTH_REGISTRY, new HealthRegistry());
```

## Public API

`HealthRegistry` · `runCheck` / `normalizeCheck` · `buildReport` / `toEndpointResponse`
/ `CONTENT_TYPE` · `aggregate` / `worst` / `httpStatusFor` · `withTimeout` /
`TimeoutError` · `HEALTH_REGISTRY` token · types (`HealthReport`, `CheckOutcome`,
`HealthCheckOptions`, `CheckResult`, `HealthStatus`, `CheckKind`, …).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## License

MIT © street contributors
