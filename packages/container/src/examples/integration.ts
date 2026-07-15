/**
 * @streetjs/container — runnable integration example.
 *
 * Wires a small dependency graph (config → db → repository → service) through
 * the container using constructor injection, then demonstrates singleton
 * sharing, the type guard on `has`, and circular-dependency detection.
 *
 * Run with: `npm run example -w packages/container`
 */

import 'reflect-metadata';
import { Injectable, container } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

@Injectable()
class Config {
  readonly url = 'postgres://localhost/app';
}

@Injectable()
class Database {
  constructor(readonly config: Config) {}
  query(): string {
    return `SELECT from ${this.config.url}`;
  }
}

@Injectable()
class UserRepository {
  constructor(readonly db: Database) {}
}

@Injectable()
class UserService {
  constructor(
    readonly repo: UserRepository,
    readonly db: Database
  ) {}
}

// Resolving the top of the graph builds every dependency exactly once.
const service = container.resolve(UserService);
assert(service instanceof UserService, 'service resolved');
assert(service.repo instanceof UserRepository, 'repository injected');
assert(service.db instanceof Database, 'database injected');

// The Database instance is a singleton shared across the graph.
assert(service.db === service.repo.db, 'database is a shared singleton');
console.log('resolved graph ->', service.db.query());

// `has` reports what has been built.
assert(container.has(Config), 'config was built transitively');
assert(container.has(UserService), 'service is registered');

// A pre-built instance can be registered and takes precedence.
container.reset();
const fixedConfig = new Config();
container.register(Config, fixedConfig);
assert(container.resolve(Config) === fixedConfig, 'pre-registered instance wins');

// Circular dependencies are detected rather than overflowing the stack. We set
// the param metadata explicitly (what `emitDecoratorMetadata` emits) so the
// mutual references don't hit a temporal-dead-zone at module load.
class Left {}
class Right {}
Reflect.defineMetadata('design:paramtypes', [Right], Left);
Reflect.defineMetadata('design:paramtypes', [Left], Right);
let caught = false;
try {
  container.resolve(Left as unknown as new () => object);
} catch (err) {
  caught = /Circular dependency detected/.test(String(err));
}
assert(caught, 'circular dependency detected');

console.log('\nAll @streetjs/container example assertions passed.');
