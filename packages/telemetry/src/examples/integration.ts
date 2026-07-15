/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Records a few request latencies and prints a metrics snapshot + health view.
 */

import { TelemetryTracker } from '../index.js';

function main(): void {
  const telemetry = new TelemetryTracker(3_600_000); // long interval; sample now

  // Simulate request timings (nanoseconds) — a couple slow, mostly fast.
  const timingsMs = [3, 5, 4, 6, 2, 40, 8, 5, 4, 120];
  for (const ms of timingsMs) {
    telemetry.recordRequest(BigInt(ms) * 1_000_000n, ms > 100);
  }

  const snap = telemetry.snapshot();
  process.stdout.write(
    `requests=${snap.requestCount} errors=${snap.errorCount} ` +
      `p50=${snap.latencyP50}ms p99=${snap.latencyP99}ms heap=${snap.heapUsedMb.toFixed(1)}MB\n`,
  );
  process.stdout.write('health: ' + JSON.stringify(telemetry.health()) + '\n');

  telemetry.destroy();
}

main();
