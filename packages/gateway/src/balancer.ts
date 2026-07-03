/**
 * @streetjs/gateway — load balancers.
 *
 * Four pluggable {@link LoadBalancer} implementations plus a {@link createBalancer}
 * factory. Each balancer picks a single {@link UpstreamTarget} from a set of
 * health-filtered candidates and returns `undefined` only when the set is empty.
 *
 * Implementations keep their scheduling state internal (a round-robin cursor, a
 * smooth weighted-round-robin credit map) so successive `pick` calls advance
 * deterministically. Random selection accepts an injectable `rng` so tests can
 * pin the sequence.
 */

import type {
  LoadBalancer,
  LoadBalancerStrategyName,
  UpstreamTarget,
} from "./types.js";

/** Normalize a target weight to an integer >= 1 (default 1). */
function normalizeWeight(target: UpstreamTarget): number {
  const raw = target.weight;
  if (raw === undefined || !Number.isFinite(raw)) return 1;
  const floored = Math.floor(raw);
  return floored < 1 ? 1 : floored;
}

/**
 * Deterministic round robin: cycles through candidates in order across
 * successive `pick` calls, wrapping at the end.
 */
export class RoundRobinBalancer implements LoadBalancer {
  readonly name = "round-robin" as const;
  private cursor = 0;

  pick(candidates: readonly UpstreamTarget[]): UpstreamTarget | undefined {
    if (candidates.length === 0) return undefined;
    const index = this.cursor % candidates.length;
    this.cursor = (this.cursor + 1) % candidates.length;
    return candidates[index];
  }
}

/**
 * Least connections: picks the candidate with the fewest in-flight connections
 * (from `liveConnections`, defaulting to 0). Ties are broken by candidate order.
 */
export class LeastConnectionsBalancer implements LoadBalancer {
  readonly name = "least-connections" as const;

  pick(
    candidates: readonly UpstreamTarget[],
    liveConnections?: ReadonlyMap<string, number>,
  ): UpstreamTarget | undefined {
    if (candidates.length === 0) return undefined;
    let best = candidates[0]!;
    let bestCount = liveConnections?.get(best.id) ?? 0;
    for (let i = 1; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const count = liveConnections?.get(candidate.id) ?? 0;
      if (count < bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    return best;
  }
}

/**
 * Random: picks a candidate uniformly at random. Accepts an injectable `rng`
 * (defaulting to `Math.random`) so tests can make selection deterministic.
 */
export class RandomBalancer implements LoadBalancer {
  readonly name = "random" as const;
  private readonly rng: () => number;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  pick(candidates: readonly UpstreamTarget[]): UpstreamTarget | undefined {
    if (candidates.length === 0) return undefined;
    let r = this.rng();
    if (!Number.isFinite(r) || r < 0) r = 0;
    if (r >= 1) r = 1 - Number.EPSILON;
    const index = Math.floor(r * candidates.length);
    return candidates[index];
  }
}

/**
 * Smooth weighted round robin (the nginx algorithm): honors per-target `weight`
 * (default 1, min 1). Over a full cycle of `sum(weights)` picks, each target is
 * chosen exactly `weight` times, and the selection is spread out rather than
 * bursty.
 */
export class WeightedRoundRobinBalancer implements LoadBalancer {
  readonly name = "weighted-round-robin" as const;
  /** Persistent per-target credit (`currentWeight`), keyed by target id. */
  private readonly current = new Map<string, number>();

  pick(candidates: readonly UpstreamTarget[]): UpstreamTarget | undefined {
    if (candidates.length === 0) return undefined;

    // Prune credits for targets no longer present.
    if (this.current.size > 0) {
      const present = new Set(candidates.map((c) => c.id));
      for (const id of this.current.keys()) {
        if (!present.has(id)) this.current.delete(id);
      }
    }

    let totalWeight = 0;
    let best: UpstreamTarget | undefined;
    let bestCurrent = 0;

    for (const candidate of candidates) {
      const weight = normalizeWeight(candidate);
      totalWeight += weight;
      const next = (this.current.get(candidate.id) ?? 0) + weight;
      this.current.set(candidate.id, next);
      if (best === undefined || next > bestCurrent) {
        best = candidate;
        bestCurrent = next;
      }
    }

    // `best` is defined because candidates is non-empty.
    this.current.set(best!.id, bestCurrent - totalWeight);
    return best;
  }
}

/**
 * Create a {@link LoadBalancer} for the named strategy. The optional `rng` is
 * only consulted by the `random` strategy.
 */
export function createBalancer(
  name: LoadBalancerStrategyName,
  options?: { rng?: () => number },
): LoadBalancer {
  switch (name) {
    case "round-robin":
      return new RoundRobinBalancer();
    case "least-connections":
      return new LeastConnectionsBalancer();
    case "random":
      return new RandomBalancer(options?.rng);
    case "weighted-round-robin":
      return new WeightedRoundRobinBalancer();
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown load balancer strategy: ${String(exhaustive)}`);
    }
  }
}
