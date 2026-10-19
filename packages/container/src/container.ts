// src/container.ts
// Dependency injection container with singleton registry and circular dep detection.

import 'reflect-metadata';
import type { BindingScope, Constructor, Token } from './types.js';

const INJECTABLE_META = Symbol('street:injectable');

/** Mark a class as injectable and register its dependencies */
export function Injectable(): ClassDecorator {
  return (target: object) => {
    Reflect.defineMetadata(INJECTABLE_META, true, target);
  };
}

export interface FactoryBinding<T> {
  factory: (container: Container) => T;
  scope?: BindingScope;
}

interface Binding<T = unknown> {
  factory: (container: Container) => T;
  scope: BindingScope;
}

/** Application-scoped dependency container with a legacy global instance. */
export class Container {
  private static readonly instance = new Container();

  private readonly singletons = new Map<Token, unknown>();
  private readonly bindings = new Map<Token, Binding>();
  private readonly resolving = new Set<Token>();
  private disposed = false;

  constructor(private readonly parent?: Container) {}

  static getInstance(): Container {
    return Container.instance;
  }

  /** Register a pre-built singleton instance (legacy class-token API). */
  register<T extends object>(token: Constructor<T>, instance: T): void {
    this.assertActive();
    this.singletons.set(token, instance);
    this.bindings.set(token, { factory: () => instance, scope: 'singleton' });
  }

  /** Register an explicit value under a class, symbol, or string token. */
  registerValue<T>(token: Token<T>, value: T): void {
    this.assertActive();
    this.singletons.set(token, value);
    this.bindings.set(token, { factory: () => value, scope: 'singleton' });
  }

  /** Register a factory with an explicit lifetime. */
  registerFactory<T>(token: Token<T>, factory: (container: Container) => T, scope: BindingScope = 'singleton'): void {
    this.assertActive();
    this.bindings.set(token, { factory, scope });
    this.singletons.delete(token);
  }

  /** Create an application/request child scope inheriting this container's bindings. */
  createScope(): Container {
    this.assertActive();
    return new Container(this);
  }

  /** Resolve a class or explicit token. Unregistered classes retain singleton behavior. */
  resolve<T>(token: Token<T>): T {
    this.assertActive();
    const binding = this.findBinding(token);
    if (this.singletons.has(token)) {
      const existing = this.singletons.get(token);
      return existing as T;
    }

    if (binding) {
      if (!this.bindings.has(token) && this.parent && binding.scope === 'singleton') {
        return this.parent.resolve(token);
      }
      if (this.resolving.has(token)) {
        throw new Error(
          `Circular dependency detected while resolving: ${String(token)}. ` +
            `Resolution chain: ${[...this.resolving].map(String).join(' -> ')} -> ${String(token)}`
        );
      }
      this.resolving.add(token);
      try {
        const instance = binding.factory(this);
        if (binding.scope !== 'transient') this.singletons.set(token, instance);
        return instance as T;
      } finally {
        this.resolving.delete(token);
      }
    }

    if (typeof token !== 'function') {
      throw new Error(`No dependency binding registered for token ${String(token)}`);
    }

    if (this.resolving.has(token)) {
      throw new Error(
        `Circular dependency detected while resolving: ${token.name}. ` +
          `Resolution chain: ${[...this.resolving].map((c) => typeof c === 'function' ? c.name : String(c)).join(' -> ')} -> ${token.name}`
      );
    }

    this.resolving.add(token);

    try {
      const paramTypes: Constructor[] =
        (Reflect.getMetadata('design:paramtypes', token) as Constructor[] | undefined) ?? [];

      const deps = paramTypes.map((dep) => {
        if (!dep || dep === Object) {
          const chain = [...this.resolving].map((c) => typeof c === 'function' ? c.name : String(c));
          chain.push(token.name);
          throw new Error(
            `Cannot resolve ${chain.join(' → ')}: got primitive or undefined type. ` +
              `Ensure emitDecoratorMetadata is enabled and the dependency is decorated with @Injectable.`
          );
        }
        try {
          return this.resolve(dep);
        } catch (inner) {
          const chain = [...this.resolving].map((c) => typeof c === 'function' ? c.name : String(c));
          chain.push(dep.name);
          const reason = inner instanceof Error ? inner.message : String(inner);
          // Only wrap if the message doesn't already contain a chain annotation
          if (reason.includes(' → ') || reason.startsWith('Cannot resolve ')) {
            throw inner;
          }
          throw new Error(`Cannot resolve ${chain.join(' → ')}: ${reason}`);
        }
      });

      const instance = new token(...deps);
      this.singletons.set(token, instance);
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }

  /** Dispose owned singleton/scoped instances in reverse creation order. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    let firstError: unknown;
    for (const instance of [...this.singletons.values()].reverse()) {
      try {
        if (isDisposable(instance)) await instance.dispose();
        else if (isCloseable(instance)) await instance.close();
      } catch (error) {
        firstError ??= error;
      }
    }
    this.singletons.clear();
    this.resolving.clear();
    if (firstError) throw firstError;
  }

  /** Remove all registered instances (useful in tests) */
  reset(): void {
    this.assertActive();
    this.singletons.clear();
    this.resolving.clear();
  }

  /** Check if a token has been resolved or registered. */
  has(token: Token): boolean {
    return this.singletons.has(token) || this.findBinding(token) !== undefined;
  }

  private findBinding(token: Token): Binding | undefined {
    return this.bindings.get(token) ?? this.parent?.findBinding(token);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Container has been disposed');
  }
}

function isDisposable(value: unknown): value is { dispose(): void | Promise<void> } {
  return typeof value === 'object' && value !== null && typeof (value as { dispose?: unknown }).dispose === 'function';
}

function isCloseable(value: unknown): value is { close(): void | Promise<void> } {
  return typeof value === 'object' && value !== null && typeof (value as { close?: unknown }).close === 'function';
}

/** Global container singleton */
export const container = Container.getInstance();

/** Create an isolated application container. */
export function createContainer(): Container {
  return new Container();
}
