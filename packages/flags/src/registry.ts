// src/registry.ts
// A fast in-memory flag registry plus a pluggable store contract.
//
// Evaluation is synchronous against in-memory definitions (flag checks belong on
// hot paths). Loading/refreshing definitions from an external source (a DB,
// Redis, a config service) is async via the `FlagStore` seam; `InMemoryFlagStore`
// is the zero-dependency default.

import { evaluateFlag, evaluateFlagDetailed } from './evaluate.js';
import type { FlagContext, FlagDefinition, FlagEvaluation } from './types.js';

/** A source of flag definitions (DB / Redis / config service / memory). */
export interface FlagStore {
  /** Load every flag definition. */
  all(): Promise<FlagDefinition<unknown>[]>;
  /** Load one flag definition by key, or undefined if absent. */
  get(key: string): Promise<FlagDefinition<unknown> | undefined>;
}

/** Zero-dependency in-memory {@link FlagStore}. */
export class InMemoryFlagStore implements FlagStore {
  private readonly defs = new Map<string, FlagDefinition<unknown>>();

  constructor(defs: FlagDefinition<unknown>[] = []) {
    for (const d of defs) this.defs.set(d.key, d);
  }

  set(def: FlagDefinition<unknown>): void {
    this.defs.set(def.key, def);
  }

  async all(): Promise<FlagDefinition<unknown>[]> {
    return [...this.defs.values()];
  }

  async get(key: string): Promise<FlagDefinition<unknown> | undefined> {
    return this.defs.get(key);
  }
}

export class UnknownFlagError extends Error {
  constructor(public readonly key: string) {
    super(`Unknown feature flag: "${key}"`);
    this.name = 'UnknownFlagError';
  }
}

/**
 * An in-memory registry of flag definitions with synchronous evaluation.
 * Register flags directly, or hydrate from a {@link FlagStore} via
 * {@link FlagRegistry.loadFrom} / {@link FlagRegistry.fromStore}.
 */
export class FlagRegistry {
  private readonly flags = new Map<string, FlagDefinition<unknown>>();

  constructor(defs: FlagDefinition<unknown>[] = []) {
    for (const d of defs) this.register(d);
  }

  /** Build a registry by loading all definitions from a store. */
  static async fromStore(store: FlagStore): Promise<FlagRegistry> {
    const registry = new FlagRegistry();
    await registry.loadFrom(store);
    return registry;
  }

  /** Register (or replace) a flag definition. Returns the registry for chaining. */
  register<T>(def: FlagDefinition<T>): this {
    if (!def || typeof def.key !== 'string' || def.key.length === 0) {
      throw new Error('FlagRegistry.register: def.key must be a non-empty string');
    }
    this.flags.set(def.key, def as FlagDefinition<unknown>);
    return this;
  }

  /** Replace all definitions with those from a store. */
  async loadFrom(store: FlagStore): Promise<void> {
    const defs = await store.all();
    this.flags.clear();
    for (const d of defs) this.register(d);
  }

  /** Whether a flag is registered. */
  has(key: string): boolean {
    return this.flags.has(key);
  }

  /** Get a raw definition, or undefined. */
  get(key: string): FlagDefinition<unknown> | undefined {
    return this.flags.get(key);
  }

  /** All registered keys. */
  keys(): string[] {
    return [...this.flags.keys()];
  }

  /** Toggle a flag's kill switch. Throws {@link UnknownFlagError} if absent. */
  setEnabled(key: string, enabled: boolean): void {
    const def = this.require(key);
    def.enabled = enabled;
  }

  /**
   * Evaluate a flag by key. Throws {@link UnknownFlagError} for unregistered
   * keys — an unknown flag is a bug, not a silent `false`.
   */
  evaluate<T = boolean>(key: string, context: FlagContext = {}): T {
    return evaluateFlag(this.require(key) as FlagDefinition<T>, context);
  }

  /** Evaluate with the full {@link FlagEvaluation} (value + reason). */
  evaluateDetailed<T = boolean>(key: string, context: FlagContext = {}): FlagEvaluation<T> {
    return evaluateFlagDetailed(this.require(key) as FlagDefinition<T>, context);
  }

  /** Convenience: coerce any flag's evaluation to a boolean `isEnabled` check. */
  isEnabled(key: string, context: FlagContext = {}): boolean {
    return this.evaluate<unknown>(key, context) === true;
  }

  private require(key: string): FlagDefinition<unknown> {
    const def = this.flags.get(key);
    if (!def) throw new UnknownFlagError(key);
    return def;
  }
}
