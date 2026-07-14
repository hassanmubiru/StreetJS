/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Demonstrates the utilities working together: a fake clock feeding a
 * time-dependent unit, a spy observing callbacks, a scripted fetch mock, and
 * waitFor polling until a condition holds.
 */

import { spy, fakeClock, mockFetch, jsonResponse, waitFor, deferred } from '../index.js';

// A unit that depends on an injected clock — exactly the shape used by
// @streetjs/config, logging, metrics, health, tracing, and webhooks.
class RateWindow {
  constructor(private readonly now: () => number, private readonly windowMs: number) {}
  private hits: number[] = [];
  record(): void {
    this.hits.push(this.now());
  }
  count(): number {
    const cutoff = this.now() - this.windowMs;
    return this.hits.filter((t) => t >= cutoff).length;
  }
}

async function main(): Promise<void> {
  const clock = fakeClock(0);
  const window = new RateWindow(clock.fn, 1000);
  window.record();
  clock.tick(500);
  window.record();
  clock.tick(600); // first hit now outside the 1000ms window
  process.stdout.write(`rate window count = ${window.count()} (expected 1)\n`);

  const onEvent = spy();
  onEvent('user.created', { id: 7 });
  process.stdout.write(`spy calledWith = ${onEvent.calledWith('user.created', { id: 7 })}\n`);

  const fetch = mockFetch([jsonResponse({ page: 1 }), jsonResponse({ page: 2 })]);
  const a = await (await fetch('https://api/x')).json();
  const b = await (await fetch('https://api/x')).json();
  process.stdout.write(`fetch responses = ${JSON.stringify([a, b])}, calls=${fetch.calls.length}\n`);

  const d = deferred<string>();
  setTimeout(() => d.resolve('ready'), 10);
  let done = false;
  void d.promise.then(() => (done = true));
  await waitFor(() => done, { timeoutMs: 500, intervalMs: 5 });
  process.stdout.write(`waitFor observed completion: ${done}\n`);
}

void main();
