// src/core/container.ts
// Dependency injection container with singleton registry and circular dep detection.

import 'reflect-metadata';
import type { Constructor } from './types.js';

const INJECTABLE_META = Symbol('street:injectable');

/** Mark a class as injectable and register its dependencies */
export function Injectable(): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata(INJECTABLE_META, true, target);
  };
}

/** Container manages singleton instances and resolves dependency trees */
export class Container {
  private static readonly instance = new Container();

  private readonly singletons = new Map<Constructor, object>();
  private readonly resolving = new Set<Constructor>();

  private constructor() {}

  static getInstance(): Container {
    return Container.instance;
  }

  /** Register a pre-built instance */
  register<T extends object>(token: Constructor<T>, instance: T): void {
    this.singletons.set(token as Constructor, instance);
  }

  /** Resolve a class, creating it if not already instantiated */
  resolve<T extends object>(token: Constructor<T>): T {
    const existing = this.singletons.get(token as Constructor);
    if (existing) {
      return existing as T;
    }

    if (this.resolving.has(token as Constructor)) {
      throw new Error(
        `Circular dependency detected while resolving: ${token.name}. ` +
          `Resolution chain: ${[...this.resolving].map((c) => c.name).join(' -> ')} -> ${token.name}`
      );
    }

    this.resolving.add(token as Constructor);

    try {
      const paramTypes: Constructor[] =
        (Reflect.getMetadata('design:paramtypes', token) as Constructor[] | undefined) ?? [];

      const deps = paramTypes.map((dep) => {
        if (!dep || dep === Object) {
          throw new Error(
            `Cannot resolve dependency for ${token.name}: got primitive or undefined type. ` +
              `Ensure emitDecoratorMetadata is enabled and the dependency is decorated with @Injectable.`
          );
        }
        return this.resolve(dep);
      });

      const instance = new token(...deps);
      this.singletons.set(token as Constructor, instance);
      return instance;
    } finally {
      this.resolving.delete(token as Constructor);
    }
  }

  /** Remove all registered instances (useful in tests) */
  reset(): void {
    this.singletons.clear();
    this.resolving.clear();
  }

  /** Check if a token has been resolved or registered */
  has(token: Constructor): boolean {
    return this.singletons.has(token);
  }
}

/** Global container singleton */
export const container = Container.getInstance();
