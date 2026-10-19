/**
 * @streetjs/container — the StreetJS dependency injection container.
 *
 * An application-scoped IoC container that resolves constructor-injected
 * dependency trees from `design:paramtypes` metadata, supports explicit token
 * bindings, detects circular dependencies, and owns deterministic disposal.
 * The exported `container` remains as a legacy process-wide compatibility
 * instance. Backed by `reflect-metadata`.
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

export { Container, Injectable, container, createContainer } from './container.js';
export type { BindingScope, Constructor, Token } from './types.js';
