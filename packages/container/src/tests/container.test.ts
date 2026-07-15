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

test('resolve detects a direct circular dependency', () => {
  @Injectable()
  class A {
    // Lazily reference B to build the cycle at metadata time.
    constructor(readonly b: B) {}
  }
  @Injectable()
  class B {
    constructor(readonly a: A) {}
  }

  assert.throws(() => container.resolve(A), /Circular dependency detected|Cannot resolve/);
});

test('resolve reports a helpful error for a primitive/undefined dependency', () => {
  @Injectable()
  class NeedsPrimitive {
    constructor(readonly count: number) {}
  }
  assert.throws(
    () => container.resolve(NeedsPrimitive),
    /Cannot resolve.*primitive or undefined type/s
  );
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
