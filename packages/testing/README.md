# @streetjs/testing

The testing foundation for StreetJS: **framework-agnostic test utilities** — spies, a
controllable fake clock, deferreds, `waitFor`/`delay` async helpers, and a scripted fetch
mock.

**Zero runtime dependencies.** Works with any test runner (`node:test`, Vitest, Jest, …),
matching the StreetJS minimal, carefully curated dependency footprint.

```bash
npm install --save-dev @streetjs/testing
```

## Why

The StreetJS foundation packages are designed to be testable: they accept injectable
clocks, `fetch`, and `sleep`. This package provides the doubles that plug into those seams
— a fake clock for `@streetjs/config`/`logging`/`metrics`/`health`/`tracing`/`webhooks`, a
scripted `fetch` for `@streetjs/http-client`/`webhooks`, and general spies and async
helpers — so tests are deterministic and network-free.

## Spies

```ts
import { spy } from '@streetjs/testing';

const handler = spy();
emitter.on('event', handler);
handler.called;                       // boolean
handler.callCount;                    // number
handler.calls;                        // [{ args, returned?, threw? }]
handler.lastCall;
handler.calledWith('event', { id: 7 }); // deep-equal match

const s = spy()
  .mockReturnValue(42);               // or .mockImplementation(fn)
s.mockResolvedValue('ok');            // async
s.mockRejectedValue(new Error('no'));
s.reset();                            // clear recorded calls
```

Thrown errors are recorded (`call.threw`) and re-thrown.

## Fake clock

```ts
import { fakeClock } from '@streetjs/testing';
import { createLogger } from '@streetjs/logging';

const clock = fakeClock(1_000);            // start at epoch ms
const log = createLogger({ clock: clock.fn }); // any package taking `clock: () => number`

clock.tick(500);   // advance
clock.set(9_999);  // absolute
clock.now();        // read
```

`clock.fn` is a plain `() => number`, exactly the shape the foundation packages accept.

## Async helpers

```ts
import { deferred, delay, waitFor } from '@streetjs/testing';

const d = deferred<string>();
somethingAsync(() => d.resolve('done'));
await d.promise;

await delay(20);                                   // unref'd sleep

await waitFor(() => queue.length > 0, {            // poll until truthy
  timeoutMs: 1000, intervalMs: 10, message: 'queue never filled',
}); // resolves with the truthy value, or rejects on timeout; async predicates supported
```

## Fetch mock

```ts
import { mockFetch, jsonResponse } from '@streetjs/testing';
import { createHttpClient } from '@streetjs/http-client';

const fetch = mockFetch([jsonResponse({ page: 1 }), jsonResponse({}, 500)]); // sequence
const api = createHttpClient({ fetch });                                     // no network

await api.get('/x');
fetch.calls;   // [{ url, init }, ...]
fetch.reset();

// Or a handler / single response:
mockFetch((call) => new Response(call.url));
mockFetch(jsonResponse({ ok: true }, 201));
```

`jsonResponse(body, status?, headers?)` builds a JSON `Response`; `sequential([...])`
turns a list into a per-call handler (repeating the last once exhausted).

## Misc

`deepEqual(a, b)` — structural equality (primitives, arrays, plain objects, `Date`,
`RegExp`), the same matcher `spy().calledWith(...)` uses.

## Public API

`spy` · `fakeClock` · `deferred` / `delay` / `waitFor` · `mockFetch` / `jsonResponse` /
`sequential` · `deepEqual` · types (`Spy`, `FakeClock`, `Deferred`, `FetchMock`,
`WaitForOptions`, …).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## License

MIT © street contributors
