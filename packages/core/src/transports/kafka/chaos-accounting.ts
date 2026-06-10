// src/transports/kafka/chaos-accounting.ts
// Pure lost-message accounting for the Kafka chaos / cold-start reliability
// harness (Requirement 9.8, Property 25). A "lost message" is defined as a
// produced message that is never delivered to a committed consumer; the run
// is a pass iff zero messages were lost. This module is dependency-free
// (Node-core only types) so it can be exercised by fast-check offline without
// any broker, and reused by the harness/artifact emitter.

/** The full-scale targets for the Kafka reliability verification (Req 9.4/9.5). */
export const FULL_SCALE_COLD_STARTS = 100;
export const FULL_SCALE_RESTART_CYCLES = 100;

/** A single chaos fault scenario the framework can inject (Req 9.3). */
export type ChaosScenario =
  | 'broker-restart'
  | 'network-interruption'
  | 'connection-loss'
  | 'slow-broker';

export const CHAOS_SCENARIOS: readonly ChaosScenario[] = [
  'broker-restart',
  'network-interruption',
  'connection-loss',
  'slow-broker',
] as const;

/** The minimum injected response delay for the slow-broker scenario (Req 9.3). */
export const SLOW_BROKER_MIN_DELAY_MS = 5000;

/**
 * The result of accounting one run's produced vs. committed-and-delivered
 * message tallies (Req 9.8). `lostCount === produced − deliveredToCommitted`
 * and `passed === (lostCount === 0)`.
 */
export interface LostMessageAccount {
  produced: number;
  deliveredToCommitted: number;
  lostCount: number;
  passed: boolean;
}

/**
 * Account for lost messages in a single run.
 *
 * A lost message is a produced message that is never delivered to a committed
 * consumer, so `lostCount = produced − deliveredToCommitted`. The run passes
 * iff nothing was lost.
 *
 * Inputs are non-negative integer counts and `deliveredToCommitted` cannot
 * exceed `produced` (a consumer cannot commit-and-deliver more than was
 * produced); both invariants are validated so the accounting can never report
 * a negative or fabricated loss.
 */
export function accountLostMessages(
  produced: number,
  deliveredToCommitted: number,
): LostMessageAccount {
  assertCount(produced, 'produced');
  assertCount(deliveredToCommitted, 'deliveredToCommitted');
  if (deliveredToCommitted > produced) {
    throw new RangeError(
      `deliveredToCommitted (${deliveredToCommitted}) cannot exceed produced (${produced})`,
    );
  }
  const lostCount = produced - deliveredToCommitted;
  return { produced, deliveredToCommitted, lostCount, passed: lostCount === 0 };
}

function assertCount(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
}
