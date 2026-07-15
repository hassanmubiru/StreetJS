import 'reflect-metadata';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Container, Injectable, container } from '../index.js';

// The DI container is a process-wide singleton; reset it before each test so
// state from one case never leaks into another.
beforeEach(() => {
  container.reset();
});

test('getInstance returns the same singleton as the exported container', () => {
  assert.equal(Container.getInstance(), container);
  assert.equal(Container.getInstance(), Container.getInstance());
});

test('register stores a pre-built instance that resolve returns as-is', () => {
  @Injectable()
  class Config {
    readonly value = 42;
  }
  const preBuilt = new Config();
  container.register(Config, preBuilt);
  assert.equal(container.resolve(Config), preBuilt);
  assert.equal(container.has(Config), true);
});

test('resolve constructs a class with no dependencies and caches it', () => {
  @Injectable()
  class Logger {}
  const first = container.resolve(Logger);
  const second = container.resolve(Logger);
  assert.ok(first instanceof Logger);
  assert.equal(first, second, 'resolve returns the same singleton on repeat calls');
});

test('resolve injects constructor dependencies as singletons', () => {
  @Injectable()
  class Db {}
  @Injectable()
  class Repo {
    constructor(readonly db: Db) {}
  }
  @Injectable()
  class Service {
    constructor(
      readonly repo: Repo,
      readonly db: Db
    ) {}
  }

  const service = container.resolve(Service);
  assert.ok(service instanceof Service);
  assert.ok(service.repo instanceof Repo);
  assert.ok(service.db instanceof Db);
  // The Db shared by Service and its Repo is the very same instance.
  assert.equal(service.db, service.repo.db);
});

test('resolve detects a circular dependency and reports the resolution chain', () => {
  // Two classes that depend on each other. We set the constructor param
  // metadata explicitly (exactly what `emitDecoratorMetadata` produces) so the
  // cycle uses real class references rather than a forward-reference fallback.
  class A {}
  class B {}
  Reflect.defineMetadata('design:paramtypes', [B], A);
  Reflect.defineMetadata('design:paramtypes', [A], B);

  assert.throws(() => container.resolve(A as unknown as new () => object), {
    message: /Circular dependency detected while resolving: A/,
  });
});

test('resolve reports a helpful error for an interface/undefined dependency', () => {
  interface ILogger {
    log(): void;
  }
  @Injectable()
  class NeedsInterface {
    // Interface types erase to `Object` in emitted metadata — unresolvable.
    constructor(readonly logger: ILogger) {}
  }
  assert.throws(
    () => container.resolve(NeedsInterface),
    /Cannot resolve.*primitive or undefined type/s
  );
});

test('resolve wraps a failing dependency construction with the resolution chain', () => {
  @Injectable()
  class Broken {
    constructor() {
      throw new Error('boom');
    }
  }
  @Injectable()
  class Consumer {
    constructor(readonly broken: Broken) {}
  }
  assert.throws(() => container.resolve(Consumer), /Cannot resolve Consumer → Broken: boom/);
});

test('resolve propagates an already-annotated nested failure without double-wrapping', () => {
  interface IMissing {
    x(): void;
  }
  @Injectable()
  class Inner {
    constructor(readonly missing: IMissing) {}
  }
  @Injectable()
  class Outer {
    constructor(readonly inner: Inner) {}
  }
  // The inner "primitive or undefined type" error already carries a chain, so
  // it is rethrown as-is rather than wrapped again.
  assert.throws(() => container.resolve(Outer), /primitive or undefined type/);
});

test('has reflects registration and resolution state, reset clears it', () => {
  @Injectable()
  class Widget {}
  assert.equal(container.has(Widget), false);
  container.resolve(Widget);
  assert.equal(container.has(Widget), true);
  container.reset();
  assert.equal(container.has(Widget), false);
});

test('Injectable decorator marks the class without altering its shape', () => {
  @Injectable()
  class Marked {
    readonly ok = true;
  }
  const instance = container.resolve(Marked);
  assert.equal(instance.ok, true);
});

test('a fresh resolve after reset builds a brand new instance', () => {
  @Injectable()
  class Counter {
    readonly id = Symbol('counter');
  }
  const a = container.resolve(Counter);
  container.reset();
  const b = container.resolve(Counter);
  assert.notEqual(a.id, b.id, 'instances differ across a reset boundary');
});
