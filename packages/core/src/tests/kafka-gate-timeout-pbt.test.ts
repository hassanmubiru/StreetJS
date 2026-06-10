// tests/kafka-gate-timeout-pbt.test.ts
// Property-based test for the Kafka Coordinator Readiness Gate timeout path
// (Req 9.2). Kept in its own file so the universal "timeout preserves offsets
// and does not consume" property is exercised across many generated
// never-ready broker scenarios without clobbering the example/edge-case unit
// tests elsewhere.
//
// Req 9.2: IF the Coordinator Readiness Gate does not observe a successful
// FindCoordinator response AND __consumer_offsets stability within the budget,
// THEN the Kafka integration SHALL NOT begin consuming and SHALL preserve any
// committed consumer offsets.
//
// The gate performs only read-only coordinator/metadata lookups; it never
// commits, fetches, or resets offsets. So for ANY scenario that never reaches
// readiness within the budget, await() must resolve with:
//   - ready === false              (caller must not begin consuming)
//   - offsetsPreserved === true    (committed offsets untouched)
// and the gate must never have invoked any offset-mutating client operation,
// leaving the broker-stored committed offsets byte-for-byte unchanged.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  CoordinatorReadinessGate,
  type KafkaClient,
  type ClusterMeta,
} from '../transports/kafka/client.js';

const NUM_RUNS = 120;

const CONSUMER_OFFSETS_TOPIC = '__consumer_offsets';

// ── Never-ready scenario model ────────────────────────────────────────────────
//
// Each scenario describes WHY the gate can never reach readiness within its
// budget. Either FindCoordinator never succeeds, or FindCoordinator succeeds
// but __consumer_offsets is never stable (missing, errored, no partitions, a
// partition error, or a partition with no elected leader), or metadata lookups
// keep failing. None of these can ever satisfy both readiness conditions.
type NeverReadyKind =
  | 'coordinator-throws'
  | 'metadata-throws'
  | 'topic-missing'
  | 'topic-error'
  | 'no-partitions'
  | 'partition-error'
  | 'no-leader';

interface Scenario {
  kind: NeverReadyKind;
  /** Non-zero topic/partition error code used by the error variants. */
  errorCode: number;
  /** Negative leader id used by the no-leader variant. */
  leaderId: number;
  timeoutMs: number;
  pollIntervalMs: number;
  group: string;
  /** Pre-existing committed offsets the gate must leave untouched. */
  committed: Array<{ topic: string; partition: number; offset: string }>;
}

const neverReadyKindArb: fc.Arbitrary<NeverReadyKind> = fc.constantFrom(
  'coordinator-throws',
  'metadata-throws',
  'topic-missing',
  'topic-error',
  'no-partitions',
  'partition-error',
  'no-leader',
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  kind: neverReadyKindArb,
  // A genuinely non-zero Kafka error code for the *-error variants.
  errorCode: fc.integer({ min: 1, max: 100 }),
  // A negative leader id (no elected leader) for the no-leader variant.
  leaderId: fc.integer({ min: -10, max: -1 }),
  // Small budgets keep the property fast while still exercising the full
  // poll-until-deadline loop. waitedMs ends up ~timeoutMs.
  timeoutMs: fc.integer({ min: 1, max: 20 }),
  pollIntervalMs: fc.integer({ min: 1, max: 10 }),
  group: fc.string({ minLength: 1, maxLength: 12 }),
  committed: fc.array(
    fc.record({
      topic: fc.string({ minLength: 1, maxLength: 10 }),
      partition: fc.integer({ min: 0, max: 16 }),
      offset: fc.bigInt({ min: 0n, max: 1_000_000n }).map((b) => b.toString()),
    }),
    { maxLength: 8 },
  ),
});

// ── Fake KafkaClient ──────────────────────────────────────────────────────────
//
// A minimal stand-in that implements only the surface the gate touches
// (findCoordinator + metadata) plus the offset-mutating operations the gate
// must NEVER call (commitOffset/fetchOffset). It records call counts and holds
// the broker-stored committed offsets so the test can prove they are untouched.
class FakeKafkaClient {
  commitOffsetCalls = 0;
  fetchOffsetCalls = 0;
  findCoordinatorCalls = 0;
  metadataCalls = 0;

  /** Broker-stored committed offsets keyed by `${topic}/${partition}`. */
  readonly committedOffsets = new Map<string, bigint>();

  constructor(private readonly scenario: Scenario) {
    for (const c of scenario.committed) {
      this.committedOffsets.set(`${c.topic}/${c.partition}`, BigInt(c.offset));
    }
  }

  /** Stable, comparable snapshot of the committed-offset store. */
  snapshot(): string {
    return [...this.committedOffsets.entries()]
      .map(([k, v]) => `${k}=${v.toString()}`)
      .sort()
      .join('|');
  }

  async findCoordinator(_group: string): Promise<{ nodeId: number; host: string; port: number }> {
    this.findCoordinatorCalls++;
    if (this.scenario.kind === 'coordinator-throws') {
      throw new Error('FindCoordinator unavailable');
    }
    return { nodeId: 1, host: '127.0.0.1', port: 9092 };
  }

  async metadata(_topics: string[]): Promise<ClusterMeta> {
    this.metadataCalls++;
    const { kind, errorCode, leaderId } = this.scenario;
    if (kind === 'metadata-throws') {
      throw new Error('metadata unavailable');
    }
    const base: ClusterMeta = { brokers: [], controllerId: 1, topics: [] };
    switch (kind) {
      case 'topic-missing':
        // No __consumer_offsets topic at all.
        return base;
      case 'topic-error':
        return {
          ...base,
          topics: [{ error: errorCode, name: CONSUMER_OFFSETS_TOPIC, partitions: [] }],
        };
      case 'no-partitions':
        return {
          ...base,
          topics: [{ error: 0, name: CONSUMER_OFFSETS_TOPIC, partitions: [] }],
        };
      case 'partition-error':
        return {
          ...base,
          topics: [
            {
              error: 0,
              name: CONSUMER_OFFSETS_TOPIC,
              partitions: [{ error: errorCode, partition: 0, leader: 1, replicas: [1], isr: [1] }],
            },
          ],
        };
      case 'no-leader':
        return {
          ...base,
          topics: [
            {
              error: 0,
              name: CONSUMER_OFFSETS_TOPIC,
              partitions: [{ error: 0, partition: 0, leader: leaderId, replicas: [1], isr: [1] }],
            },
          ],
        };
      default:
        return base;
    }
  }

  // Offset-mutating operations the gate must never invoke. If the gate ever
  // calls these, the committed-offset store changes and/or the call counter
  // trips, failing the property.
  async commitOffset(_group: string, topic: string, partition: number, offset: bigint): Promise<void> {
    this.commitOffsetCalls++;
    this.committedOffsets.set(`${topic}/${partition}`, offset);
  }

  async fetchOffset(_group: string, _topic: string, _partition: number): Promise<bigint> {
    this.fetchOffsetCalls++;
    return -1n;
  }
}

// Feature: platform-leadership-gaps, Property 24: A gate timeout preserves committed offsets and does not consume
// Validates: Requirements 9.2
describe('Property 24: a gate timeout preserves committed offsets and does not consume', () => {
  it('on any never-ready scenario, await() times out without consuming and leaves committed offsets untouched', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const fake = new FakeKafkaClient(scenario);
        const before = fake.snapshot();

        const gate = new CoordinatorReadinessGate(fake as unknown as KafkaClient, {
          group: scenario.group,
          timeoutMs: scenario.timeoutMs,
          pollIntervalMs: scenario.pollIntervalMs,
        });

        const result = await gate.await();

        // Req 9.2: readiness was never reached -> caller must NOT begin consuming.
        assert.equal(result.ready, false);
        // __consumer_offsets was never observed as stable.
        assert.equal(result.offsetsTopicStable, false);
        // Committed offsets are preserved (the gate is read-only).
        assert.equal(result.offsetsPreserved, true);
        // waitedMs is a real, non-negative measurement.
        assert.ok(result.waitedMs >= 0, `waitedMs should be >= 0, got ${result.waitedMs}`);

        // findCoordinatorOk reflects the scenario: false only when the
        // coordinator lookup itself never succeeds.
        if (scenario.kind === 'coordinator-throws') {
          assert.equal(result.findCoordinatorOk, false);
        } else {
          assert.equal(result.findCoordinatorOk, true);
        }

        // "Does not consume" / "preserves committed offsets": the gate must
        // never have touched any offset-mutating operation...
        assert.equal(fake.commitOffsetCalls, 0, 'gate must not commit offsets');
        assert.equal(fake.fetchOffsetCalls, 0, 'gate must not fetch offsets');
        // ...and the broker-stored committed offsets are byte-for-byte unchanged.
        assert.equal(fake.snapshot(), before);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('a timeout decision is independent of the pre-existing committed offsets (they are always preserved)', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const fake = new FakeKafkaClient(scenario);
        const before = fake.snapshot();

        const gate = new CoordinatorReadinessGate(fake as unknown as KafkaClient, {
          group: scenario.group,
          timeoutMs: scenario.timeoutMs,
          pollIntervalMs: scenario.pollIntervalMs,
        });

        const result = await gate.await();

        // Regardless of how many offsets were committed beforehand, a timeout
        // never begins consuming and never alters the committed-offset store.
        assert.equal(result.ready, false);
        assert.equal(result.offsetsPreserved, true);
        assert.equal(fake.snapshot(), before);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
