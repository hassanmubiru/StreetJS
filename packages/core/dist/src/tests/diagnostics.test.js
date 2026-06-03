// src/tests/diagnostics.test.ts
// Unit tests for Enhanced Error Diagnostics (Task 4.1 – 4.7)
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsReporter } from '../diagnostics/reporter.js';
import { Container, Injectable } from '../core/container.js';
// ── DiagnosticsReporter ───────────────────────────────────────────────────────
describe('DiagnosticsReporter — diagnostic event fires on error report', () => {
    it('emits a "diagnostic" event when report() is called with an Error', () => {
        const reporter = new DiagnosticsReporter();
        let captured;
        reporter.on('diagnostic', (event) => {
            captured = event;
        });
        // suppress stderr output in test
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = () => true;
        try {
            reporter.report(new Error('test error'));
        }
        finally {
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
        let captured;
        reporter.on('diagnostic', (e) => { captured = e; });
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = () => true;
        try {
            reporter.report(new Error('with corr'), 'corr-123');
        }
        finally {
            process.stderr.write = orig;
        }
        assert.ok(captured !== undefined);
        assert.equal(captured.correlationId, 'corr-123');
    });
    it('handles non-Error values gracefully', () => {
        const reporter = new DiagnosticsReporter();
        let captured;
        reporter.on('diagnostic', (e) => { captured = e; });
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = () => true;
        try {
            reporter.report('plain string error');
        }
        finally {
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
        let captured;
        reporter.on('diagnostic', (e) => { captured = e; });
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
        }
        finally {
            process.stderr.write = orig;
        }
        assert.ok(captured !== undefined);
        // Only user frames should remain
        for (const frame of captured.stack) {
            assert.ok(!frame.includes('node:internal') && !frame.includes('node_modules/node'), `Expected no internal frames but found: "${frame}"`);
        }
        // User frames should be present
        assert.ok(captured.stack.some((f) => f.includes('handler.ts')), 'expected user frame from handler.ts to be present');
        assert.ok(captured.stack.some((f) => f.includes('service.ts')), 'expected user frame from service.ts to be present');
    });
    it('returns empty stack array when error has no stack', () => {
        const reporter = new DiagnosticsReporter();
        let captured;
        reporter.on('diagnostic', (e) => { captured = e; });
        const err = new Error('no stack');
        err.stack = undefined;
        const orig = process.stderr.write.bind(process.stderr);
        process.stderr.write = () => true;
        try {
            reporter.report(err);
        }
        finally {
            process.stderr.write = orig;
        }
        assert.ok(captured !== undefined);
        assert.deepEqual(captured.stack, []);
    });
});
// ── Container — dependency chain in DI error messages ─────────────────────────
describe('Container — dependency chain appears in DI error messages', () => {
    let container;
    beforeEach(() => {
        container = Container.getInstance();
        container.reset();
    });
    it('includes the class names in the error when resolution fails due to circular dep', () => {
        let DepA = class DepA {
            b;
            constructor(b) {
                this.b = b;
            }
        };
        DepA = __decorate([
            Injectable(),
            __metadata("design:paramtypes", [Object])
        ], DepA);
        let DepB = class DepB {
            a;
            constructor(a) {
                this.a = a;
            }
        };
        DepB = __decorate([
            Injectable(),
            __metadata("design:paramtypes", [Object])
        ], DepB);
        // Manually wire circular metadata
        Reflect.defineMetadata('design:paramtypes', [DepB], DepA);
        Reflect.defineMetadata('design:paramtypes', [DepA], DepB);
        let errorMessage = '';
        try {
            container.resolve(DepA);
        }
        catch (err) {
            errorMessage = err.message;
        }
        assert.ok(errorMessage.length > 0, 'expected an error to be thrown');
        // Circular dep error must mention the class names involved
        assert.ok(errorMessage.includes('DepA') || errorMessage.includes('DepB'), `Error message should mention class names, got: "${errorMessage}"`);
    });
    it('includes dependency chain with arrow notation "→" for nested resolution failures', () => {
        let Leaf = class Leaf {
            x;
            constructor(x) {
                this.x = x;
            }
        };
        Leaf = __decorate([
            Injectable(),
            __metadata("design:paramtypes", [Object])
        ], Leaf);
        let Middle = class Middle {
            leaf;
            constructor(leaf) {
                this.leaf = leaf;
            }
        };
        Middle = __decorate([
            Injectable(),
            __metadata("design:paramtypes", [Leaf])
        ], Middle);
        let Root = class Root {
            middle;
            constructor(middle) {
                this.middle = middle;
            }
        };
        Root = __decorate([
            Injectable(),
            __metadata("design:paramtypes", [Middle])
        ], Root);
        // Set Leaf to depend on Object (primitive-like) to trigger "Cannot resolve" error
        Reflect.defineMetadata('design:paramtypes', [Object], Leaf);
        Reflect.defineMetadata('design:paramtypes', [Leaf], Middle);
        Reflect.defineMetadata('design:paramtypes', [Middle], Root);
        let errorMessage = '';
        try {
            container.resolve(Root);
        }
        catch (err) {
            errorMessage = err.message;
        }
        assert.ok(errorMessage.length > 0, 'expected an error to be thrown');
        // Should contain arrow-separated chain
        assert.ok(errorMessage.includes('→'), `Error message should contain "→" separator, got: "${errorMessage}"`);
        // Should mention multiple classes in the chain
        assert.ok(errorMessage.includes('Root') || errorMessage.includes('Middle') || errorMessage.includes('Leaf'), `Error message should contain class names from the chain, got: "${errorMessage}"`);
    });
});
//# sourceMappingURL=diagnostics.test.js.map