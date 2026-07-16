/**
 * @streetjs/diagnostics — runnable integration example.
 *
 * Subscribes to the reporter's event stream and reports a few different thrown
 * values, showing the structured DiagnosticEvent shape and stack cleaning.
 *
 * Run with: `npm run example -w packages/diagnostics`
 */

import { DiagnosticsReporter, type DiagnosticEvent } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

const reporter = new DiagnosticsReporter();
const collected: DiagnosticEvent[] = [];
reporter.on('diagnostic', (e) => collected.push(e));

// 1. A real Error with a correlation id.
class PaymentError extends Error {}
reporter.report(new PaymentError('card declined'), 'req-42');

// 2. A string.
reporter.report('cache miss storm');

// 3. An arbitrary value.
reporter.report({ unexpected: true });

// (Each report also wrote a JSON line to stderr above.)

assert(collected.length === 3, 'three diagnostics emitted');
assert(collected[0]!.errorClass === 'PaymentError', 'subclass name preserved');
assert(collected[0]!.correlationId === 'req-42', 'correlation id carried');
assert(collected[1]!.errorClass === 'StringError', 'string classified');
assert(collected[2]!.errorClass === 'UnknownError', 'unknown value classified');
for (const e of collected) {
  assert(e.level === 'error', 'level is error');
  assert(/^\d{4}-\d{2}-\d{2}T/.test(e.ts), 'ISO timestamp');
  assert(e.stack.every((f) => f.startsWith('at ')), 'only clean at-frames survive');
}

console.log('\ncollected diagnostics:');
for (const e of collected) {
  console.log(`  [${e.errorClass}] ${e.message}${e.correlationId ? ` (${e.correlationId})` : ''}`);
}
console.log('\nAll @streetjs/diagnostics example assertions passed.');
