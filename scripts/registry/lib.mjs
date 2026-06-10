// scripts/registry/lib.mjs
//
// Shared helpers for the Network Plugin Registry publish→install E2E harness
// (Requirement 4.8). These back two scripts:
//
//   • verify.mjs — the CommandRunner driver. Runs the docker prerequisite probe
//     and, when a container runtime is available, executes e2e.mjs through the
//     zero-dependency `CommandRunner`, which emits the single machine-readable
//     `registry.publish-install.artifact.json`.
//
//   • e2e.mjs   — the real end-to-end harness. Starts the @streetjs/registry
//     server IN A CONTAINER, then drives a full publish→install round trip
//     against it (Ed25519-sign → publish → download → consumer-side verify),
//     mirroring the design's "publish → install" sequence.
//
// Honest BLOCKED (Requirement 1.5 / Testing Strategy → Honest BLOCKED): when no
// container runtime is available the driver records an honest BLOCKED with the
// specific missing prerequisite — never a mock, never a false VERIFIED.
//
// Zero runtime dependencies: only Node core (`node:child_process`, `node:net`).

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** The container image the registry server runs in. Pinned major for reproducibility. */
export const REGISTRY_IMAGE = 'node:20-alpine';

/** The repo root, derived from this file's location (scripts/registry/ → ../../). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The port the registry server listens on inside the container. */
export const CONTAINER_PORT = 8787;

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
  const r = spawnSync('docker', ['pull', image], { encoding: 'utf8', stdio: 'inherit', timeout: 180_000 });
  return r.status === 0;
}

/**
 * Probe the container-runtime prerequisites for the registry E2E in declared
 * order and return the FIRST missing one as a `BlockedReason`
 * (`{ missingPrerequisite, kind }`), or `null` when a container is available
 * (Requirement 1.5 / 4.8). The probe also ensures the base image is obtainable
 * so that an offline environment with no cached image is honestly BLOCKED
 * rather than reported as a hard failure.
 *
 * @returns {{ missingPrerequisite: string, kind: 'runtime'|'service' } | null}
 */
export function probeContainerPrerequisites() {
  if (!hasBinary('docker')) {
    return { missingPrerequisite: 'docker', kind: 'runtime' };
  }
  if (!dockerDaemonUp()) {
    return { missingPrerequisite: 'docker-daemon', kind: 'service' };
  }
  if (!imagePresent(REGISTRY_IMAGE) && !pullImage(REGISTRY_IMAGE)) {
    return { missingPrerequisite: `docker-image:${REGISTRY_IMAGE}`, kind: 'service' };
  }
  return null;
}

/** Resolve an ephemeral free TCP port on the loopback interface. */
export function findFreePort() {
  return new Promise((resolveP, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolveP(port));
    });
  });
}

/**
 * Poll `url` until it responds (any HTTP status) or the deadline passes.
 * Returns true once a response is received, false on timeout.
 */
export async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 1_000, perRequestMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Use a manual, REF'd abort timer rather than `AbortSignal.timeout()`: the
    // latter uses an unref'd timer, so a request that is pending against a
    // not-yet-ready port (e.g. docker-proxy has bound the host port but the
    // container app is still booting) would leave nothing keeping the event loop
    // alive, and Node would exit cleanly mid-wait. A ref'd timer guarantees the
    // loop stays alive for the duration of each attempt.
    const ac = new AbortController();
    const abortTimer = setTimeout(() => ac.abort(), perRequestMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      // Any response (even 404) means the server is up and routing.
      if (res) return true;
    } catch {
      // not up yet
    } finally {
      clearTimeout(abortTimer);
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Run a docker command synchronously, returning `{ ok, stdout, stderr }`. */
export function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: opts.timeoutMs ?? 120_000 });
  return {
    ok: r.status === 0,
    stdout: String(r.stdout ?? '').trim(),
    stderr: String(r.stderr ?? '').trim(),
    status: r.status,
  };
}
