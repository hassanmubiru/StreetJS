/**
 * @streetjs/container — the StreetJS dependency injection container.
 *
 * A process-wide singleton IoC registry that resolves constructor-injected
 * dependency trees from `design:paramtypes` metadata, detects circular
 * dependencies, and exposes an `@Injectable()` class decorator. Backed by
 * `reflect-metadata`.
 *
 * ```ts
 * import 'reflect-metadata';
 * import { Injectable, container } from '@streetjs/container';
 *
 * @Injectable() class Db {}
 * @Injectable() class UserService { constructor(readonly db: Db) {} }
 *
 * const svc = container.resolve(UserService); // db injected as a singleton
 * ```
 *
 * > This is the standalone home of the container that also backs the `streetjs`
 * > framework; the framework re-exports it, so there is a single implementation.
 */

export { Container, Injectable, container } from './container.js';
export type { Constructor } from './types.js';
