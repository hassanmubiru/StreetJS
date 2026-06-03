// src/tests/diagnostics.test.ts
// Unit tests for Enhanced Error Diagnostics (Task 4.1 – 4.7)

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { DiagnosticsReporter } from '../diagnostics/reporter.js';
import type { DiagnosticEvent } from '../diagnostics/reporter.js';
import { Container, Injectable } from '../core/container.js';

// ── DiagnosticsReporter ───────────────────────────────────────────────────────

describe('DiagnosticsReporter — diagnostic event fires on error report', () => {
  it('emits a "diagnostic" event when report() is called with an Error', () => {
    const reporter = new DiagnosticsReporter();
    let captured: DiagnosticEvent | undefined;

    reporter.on('diagnostic', (event: DiagnosticEvent) => {
      captured = event;
    });

    // suppress stderr output in test
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      reporter.report(new Error('test error'));
    } finally {
      process.stderr.write = orig;
    }

    assert.ok(captured !== undefined, 'expected a diagnostic event to be emitted');
    assert.equal(captured.level, 'error');
    assert.equal(captured.message, 'test error');
    assert.equal(captured.errorClass, 'Error');
    assert.ok(typeof captured.ts === 'string');
    // ISO 8601 check: must parse as a valid date
    assert.ok(!isNaN(Date.parse(captured.ts)), `ts "${captured.ts}" should be ISO 8601`);
  });

  it('includes correlationId when provided', () => {
    const reporter = new DiagnosticsReporter();
    let captured: DiagnosticEvent | undefined;

    reporter.on('diagnostic', (e: DiagnosticEvent) => { captured = e; });

    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      reporter.report(new Error('with corr'), 'corr-123');
    } finally {
      process.stderr.write = orig;
    }

    assert.ok(captured !== undefined);
    assert.equal(captured.correlationId, 'corr-123');
  });

  it('handles non-Error values gracefully', () => {
    const reporter = new DiagnosticsReporter();
    let captured: DiagnosticEvent | undefined;

    reporter.on('diagnostic', (e: DiagnosticEvent) => { captured = e; });

    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      reporter.report('plain string error');
    } finally {
      process.stderr.write = orig;
    }

    assert.ok(captured !== undefined);
    assert.equal(captured.errorClass, 'StringError');
    assert.equal(captured.message, 'plain string error');
  });
});

describe('DiagnosticsReporter — stack frames are cleaned (no node:internal frames)', () => {
  it('removes node:internal frames from the stack', () => {
    const reporter = new DiagnosticsReporter();
    let captured: DiagnosticEvent | undefined;

    reporter.on('diagnostic', (e: DiagnosticEvent) => { captured = e; });

    // Craft an error whose stack contains internal frames
    const err = new Error('stack test');
    // Inject a synthetic stack with both internal and user frames
    err.stack = [
      'Error: stack test',
      '    at UserCode (/app/src/handler.ts:10:5)',
      '    at node:internal/process/task_queues:140:5',
      '    at node:internal/timers:544:11',
      '    at runNextTicks (node:internal/process/task_queues:67:3)',
      '    at AnotherUserFn (/app/src/service.ts:25:3)',
      '    at node_modules/node-runner/index.js:1:1',
    ].join('\n');

    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      reporter.report(err);
    } finally {
      process.stderr.write = orig;
    }

    assert.ok(captured !== undefined);
    // Only user frames should remain
    for (const frame of captured.stack) {
      assert.ok(
        !frame.includes('node:internal') && !frame.includes('node_modules/node'),
        `Expected no internal frames but found: "${frame}"`
      );
    }
    // User frames should be present
    assert.ok(
      captured.stack.some((f) => f.includes('handler.ts')),
      'expected user frame from handler.ts to be present'
    );
    assert.ok(
      captured.stack.some((f) => f.includes('service.ts')),
      'expected user frame from service.ts to be present'
    );
  });

  it('returns empty stack array when error has no stack', () => {
    const reporter = new DiagnosticsReporter();
    let captured: DiagnosticEvent | undefined;

    reporter.on('diagnostic', (e: DiagnosticEvent) => { captured = e; });

    const err = new Error('no stack');
    err.stack = undefined;

    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = () => true;
    try {
      reporter.report(err);
    } finally {
      process.stderr.write = orig;
    }

    assert.ok(captured !== undefined);
    assert.deepEqual(captured.stack, []);
  });
});

// ── Container — dependency chain in DI error messages ─────────────────────────

describe('Container — dependency chain appears in DI error messages', () => {
  let container: Container;

  beforeEach(() => {
    container = Container.getInstance();
    container.reset();
  });

  it('includes the class names in the error when resolution fails due to circular dep', () => {
    @Injectable()
    class ServiceA {
      constructor(public b: ServiceB) {}
    }

    @Injectable()
    class ServiceB {
      constructor(public a: ServiceA) {}
    }

    // Manually register metadata since decorators may not emit in test
    Reflect.defineMetadata('design:paramtypes', [ServiceB], ServiceA);
    Reflect.defineMetadata('design:paramtypes', [ServiceA], ServiceB);

    let errorMessage = '';
    try {
      container.resolve(ServiceA);
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    assert.ok(errorMessage.length > 0, 'expected an error to be thrown');
    // Circular dep error must mention the class names involved
    assert.ok(
      errorMessage.includes('ServiceA') || errorMessage.includes('ServiceB'),
      `Error message should mention class names, got: "${errorMessage}"`
    );
  });

  it('includes dependency chain with arrow notation "→" for nested resolution failures', () => {
    @Injectable()
    class Leaf {
      constructor(public x: unknown) {}
    }

    @Injectable()
    class Middle {
      constructor(public leaf: Leaf) {}
    }

    @Injectable()
    class Root {
      constructor(public middle: Middle) {}
    }

    // Set Leaf to depend on Object (primitive-like) to trigger "Cannot resolve" error
    Reflect.defineMetadata('design:paramtypes', [Object], Leaf);
    Reflect.defineMetadata('design:paramtypes', [Leaf], Middle);
    Reflect.defineMetadata('design:paramtypes', [Middle], Root);

    let errorMessage = '';
    try {
      container.resolve(Root);
    } catch (err) {
      errorMessage = (err as Error).message;
    }

    assert.ok(errorMessage.length > 0, 'expected an error to be thrown');
    // Should contain arrow-separated chain
    assert.ok(
      errorMessage.includes('→'),
      `Error message should contain "→" separator, got: "${errorMessage}"`
    );
    // Should mention multiple classes in the chain
    assert.ok(
      errorMessage.includes('Root') || errorMessage.includes('Middle') || errorMessage.includes('Leaf'),
      `Error message should contain class names from the chain, got: "${errorMessage}"`
    );
  });
});
