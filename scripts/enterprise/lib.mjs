// scripts/enterprise/lib.mjs
//
// Shared helpers for the Enterprise Console APIs Layer B verification harness
// (Requirement 6.10). These back three scripts:
//
//   • verify.mjs — the CommandRunner driver. Runs the container prerequisite
//     probe and, when a PostgreSQL container is available, executes e2e.mjs
//     through the zero-dependency `CommandRunner`, which emits the single
//     machine-readable `enterprise.api.artifact.json`. The driver then merges
//     the suite's passed/failed counts into the artifact (Req 6.10).
//
//   • server.mjs — the "running app": a node:http server that mounts the real
//     EnterpriseConsole REST surface and connects to the PostgreSQL container
//     through the framework's PgPool, so the suite runs against a running app +
//     real database (Req 6.10, Testing Strategy → Layer B).
//
//   • e2e.mjs   — the real end-to-end suite. Starts PostgreSQL IN A CONTAINER,
//     starts the running app against it, and drives the full enterprise console
//     surface over HTTP (authn 401, authz 403, validation 400, and the
//     happy-path tenant/policy/compliance/admin operations), tallying passed and
//     failed test counts.
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

/** The PostgreSQL container image the suite runs against. Pinned for reproducibility. */
export const POSTGRES_IMAGE = 'postgres:16-alpine';

/** The repo root, derived from this file's location (scripts/enterprise/ → ../../). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** PostgreSQL credentials seeded into the container and used by the running app. */
export const PG = Object.freeze({
  user: 'street',
  password: 'street_secret',
  database: 'street_console',
});

/**
 * The HMAC secret the running app uses to verify console JWTs and the suite uses
 * to mint them. Fixed (>= 32 chars) so both sides agree byte-for-byte. This is a
 * throwaway test secret, never a production credential.
 */
export const CONSOLE_JWT_SECRET = 'enterprise-console-layerb-secret-0123456789';

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
 * Probe the container-runtime prerequisites for the enterprise suite in declared
 * order and return the FIRST missing one as a `BlockedReason`
 * (`{ missingPrerequisite, kind }`), or `null` when a container is available
 * (Requirement 1.5 / 6.10). The probe also ensures the PostgreSQL image is
 * obtainable so an offline environment with no cached image is honestly BLOCKED
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
  if (!imagePresent(POSTGRES_IMAGE) && !pullImage(POSTGRES_IMAGE)) {
    return { missingPrerequisite: `docker-image:${POSTGRES_IMAGE}`, kind: 'service' };
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
 * Poll `url` until it responds with one of `expectStatuses` (default: any) or the
 * deadline passes. Returns true once an accepted response is received, false on
 * timeout. Uses a ref'd per-request abort timer so the event loop stays alive
 * while polling a not-yet-ready port.
 */
export async function waitForHttp(url, { timeoutMs = 60_000, intervalMs = 1_000, perRequestMs = 3_000, expectStatuses } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ac = new AbortController();
    const abortTimer = setTimeout(() => ac.abort(), perRequestMs);
    try {
      const res = await fetch(url, { signal: ac.signal });
      if (res && (!expectStatuses || expectStatuses.includes(res.status))) return true;
    } catch {
      // not up yet
    } finally {
      clearTimeout(abortTimer);
    }
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/** Run a docker command synchronously, returning `{ ok, stdout, stderr, status }`. */
export function docker(args, opts = {}) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: opts.timeoutMs ?? 120_000 });
  return {
    ok: r.status === 0,
    stdout: String(r.stdout ?? '').trim(),
    stderr: String(r.stderr ?? '').trim(),
    status: r.status,
  };
}

/** Poll a PostgreSQL container with `pg_isready` until ready or the deadline passes. */
export async function waitForPostgres(containerName, { timeoutMs = 60_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const r = docker(
      ['exec', containerName, 'pg_isready', '-U', PG.user, '-d', PG.database],
      { timeoutMs: 10_000 },
    );
    if (r.ok) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
