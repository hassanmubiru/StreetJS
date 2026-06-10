// scripts/reliability/lib.mjs
//
// Shared helpers for the Kafka cold-start + chaos Layer-B verification harness
// (Requirement 9.4–9.8, task 15.5). These back two scripts:
//
//   • verify.mjs           — the CommandRunner driver. Probes the broker / docker
//     prerequisites and, when a broker is runnable, executes the parameterized
//     chaos suite (kafka-cold-start.sh) at the full-scale targets through the
//     zero-dependency `CommandRunner`, then emits one machine-readable
//     Verification Artifact per capability:
//       kafka.coldstart, kafka.chaos.broker-restart,
//       kafka.chaos.network-interruption, kafka.chaos.connection-loss,
//       kafka.chaos.slow-broker.
//
//   • kafka-cold-start.sh  — the real chaos harness it drives (writes a
//     machine-readable per-scenario summary when CHAOS_SUMMARY_PATH is set).
//
// Honest BLOCKED (Requirement 1.5 / Testing Strategy → Honest BLOCKED): when no
// broker is reachable AND no usable container runtime + Kafka image is available
// to start one, the driver records an honest BLOCKED with the specific missing
// prerequisite (kafka-broker / docker / docker-daemon / docker-image:apache/kafka:3.7.1)
// — never a mock, never a false VERIFIED.
//
// Zero runtime dependencies: Node core only (`node:child_process`, `node:net`).

import { spawnSync } from 'node:child_process';
import { Socket } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** The Kafka broker image the chaos suite boots (KRaft). Pinned for reproducibility. */
export const KAFKA_IMAGE = 'apache/kafka:3.7.1';

/** The repo root, derived from this file's location (scripts/reliability/ → ../../). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The default broker bootstrap address the harness targets. */
export const DEFAULT_BROKERS = process.env.KAFKA_BROKERS ?? '127.0.0.1:9092';

/** True iff the given executable resolves on PATH (`command -v <bin>`). */
export function hasBinary(bin) {
  const r = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' });
  return r.status === 0 && String(r.stdout ?? '').trim() !== '';
}

/** True iff the Docker daemon is reachable (`docker info`). */
export function dockerDaemonUp() {
  const r = spawnSync('docker', ['info'], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0;
}

/** True iff the image is present locally (`docker image inspect`). */
export function imagePresent(image) {
  const r = spawnSync('docker', ['image', 'inspect', image], { encoding: 'utf8', timeout: 20_000 });
  return r.status === 0;
}

/** Attempt to pull the image; returns true on success. */
export function pullImage(image) {
  const r = spawnSync('docker', ['pull', image], { encoding: 'utf8', stdio: 'inherit', timeout: 300_000 });
  return r.status === 0;
}

/**
 * Probe whether a Kafka broker is already reachable at `brokers` (the first
 * `host:port` is tried). A short TCP connect is enough to know the harness can
 * run against an existing broker without needing a container runtime.
 */
export function brokerReachable(brokers = DEFAULT_BROKERS, { timeoutMs = 2_000 } = {}) {
  const first = String(brokers).split(',')[0]?.trim();
  if (!first) return Promise.resolve(false);
  const [host, portStr] = first.split(':');
  const port = Number.parseInt(portStr ?? '9092', 10) || 9092;
  return new Promise((resolveP) => {
    const sock = new Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolveP(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host || '127.0.0.1');
  });
}

/**
 * Probe the Kafka chaos prerequisites in declared order and return the FIRST
 * missing one as a `BlockedReason` (`{ missingPrerequisite, kind }`), or `null`
 * when the suite can run (Requirement 1.5 / 9.x).
 *
 * Order of preference:
 *   1. An already-reachable broker at `brokers` — run against it directly.
 *   2. Otherwise a usable container runtime (docker present + daemon up) plus
 *      the pinned `apache/kafka:3.7.1` image (present locally or pullable) so
 *      the harness can boot its own broker via docker-compose.
 *
 * @returns {Promise<{ missingPrerequisite: string, kind: 'runtime'|'service' } | null>}
 */
export async function probeKafkaPrerequisites({ brokers = DEFAULT_BROKERS } = {}) {
  if (await brokerReachable(brokers)) return null;
  if (!hasBinary('docker')) {
    return { missingPrerequisite: 'kafka-broker', kind: 'service' };
  }
  if (!dockerDaemonUp()) {
    return { missingPrerequisite: 'docker-daemon', kind: 'service' };
  }
  if (!imagePresent(KAFKA_IMAGE) && !pullImage(KAFKA_IMAGE)) {
    return { missingPrerequisite: `docker-image:${KAFKA_IMAGE}`, kind: 'service' };
  }
  return null;
}
