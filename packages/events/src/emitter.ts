// src/emitter.ts
// @streetjs/events — the untyped subscription registry underneath the typed
// facade. It stores exact and wildcard subscriptions, preserves global
// registration order across both kinds (so delivery order is deterministic),
// and resolves the ordered set of matching subscriptions for a fired event.
//
// The facade layers full type-safety on top; this core stays deliberately
// untyped (`unknown` payloads) so it has a single, simple implementation.

import type { Awaitable, EventContext } from './event.js';
import { isWildcard, matchesPattern } from './matcher.js';

/** An untyped listener stored in the registry. */
export type RawListener = (payload: unknown, ctx: EventContext) => Awaitable<void>;

/** A single active (or cancelled) subscription. */
export interface Subscription {
  /** Monotonic registration order; delivery is sorted by this across all kinds. */
  readonly order: number;
  /** Exact event name or wildcard pattern this subscription is bound to. */
  readonly key: string;
  /** Whether `key` is a wildcard pattern. */
  readonly wildcard: boolean;
  /** The untyped listener. */
  readonly listener: RawListener;
  /** When true, the subscription is removed after its first delivery. */
  readonly once: boolean;
  /** Flipped to false on unsubscribe / after a `once` delivery. */
  active: boolean;
}

/**
 * Ordered, dual-index subscription registry.
 *
 * - Exact subscriptions are indexed by name for O(1) lookup.
 * - Wildcard subscriptions are kept in a list and matched per fired event.
 * - Every subscription carries a global `order` so {@link resolve} returns the
 *   combined matches in registration order regardless of kind.
 */
export class Emitter {
  private nextOrder = 0;
  private readonly exact = new Map<string, Set<Subscription>>();
  private readonly wildcards = new Set<Subscription>();

  /**
   * Register a listener for an exact name or a wildcard pattern. Returns an
   * idempotent unsubscribe function.
   */
  add(key: string, listener: RawListener, once = false): () => void {
    const wildcard = isWildcard(key);
    const sub: Subscription = {
      order: this.nextOrder++,
      key,
      wildcard,
      listener,
      once,
      active: true,
    };

    if (wildcard) {
      this.wildcards.add(sub);
    } else {
      let set = this.exact.get(key);
      if (!set) {
        set = new Set();
        this.exact.set(key, set);
      }
      set.add(sub);
    }

    return () => this.remove(sub);
  }

  /** Cancel a subscription. Idempotent and safe to call during delivery. */
  remove(sub: Subscription): void {
    if (!sub.active) {
      return;
    }
    sub.active = false;
    if (sub.wildcard) {
      this.wildcards.delete(sub);
    } else {
      const set = this.exact.get(sub.key);
      if (set) {
        set.delete(sub);
        if (set.size === 0) {
          this.exact.delete(sub.key);
        }
      }
    }
  }

  /**
   * Resolve the active subscriptions matching a fired `name`, in global
   * registration order (exact and wildcard interleaved by `order`). A snapshot
   * is returned so a listener may safely subscribe/unsubscribe during delivery.
   */
  resolve(name: string): Subscription[] {
    const matches: Subscription[] = [];

    const exactSet = this.exact.get(name);
    if (exactSet) {
      for (const sub of exactSet) {
        if (sub.active) {
          matches.push(sub);
        }
      }
    }

    for (const sub of this.wildcards) {
      if (sub.active && matchesPattern(name, sub.key)) {
        matches.push(sub);
      }
    }

    matches.sort((a, b) => a.order - b.order);
    return matches;
  }

  /**
   * The number of exact listeners for `name` (when given) or the total number
   * of active subscriptions (exact + wildcard) across the registry.
   */
  listenerCount(name?: string): number {
    if (name !== undefined) {
      let count = 0;
      const set = this.exact.get(name);
      if (set) {
        for (const sub of set) {
          if (sub.active) count += 1;
        }
      }
      for (const sub of this.wildcards) {
        if (sub.active && matchesPattern(name, sub.key)) count += 1;
      }
      return count;
    }

    let total = 0;
    for (const set of this.exact.values()) {
      for (const sub of set) {
        if (sub.active) total += 1;
      }
    }
    for (const sub of this.wildcards) {
      if (sub.active) total += 1;
    }
    return total;
  }

  /** The number of active wildcard subscriptions. */
  patternCount(): number {
    let count = 0;
    for (const sub of this.wildcards) {
      if (sub.active) count += 1;
    }
    return count;
  }

  /** Remove every subscription. */
  clear(): void {
    for (const set of this.exact.values()) {
      for (const sub of set) {
        sub.active = false;
      }
    }
    for (const sub of this.wildcards) {
      sub.active = false;
    }
    this.exact.clear();
    this.wildcards.clear();
  }
}
