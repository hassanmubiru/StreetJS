// scripts/plugins/lib.mjs
//
// Shared helpers for the Official Plugin Ecosystem Layer-B integration
// verification (Requirement 5.9). These back two scripts:
//
//   • verify.mjs       — the CommandRunner driver. For each official plugin it
//     runs the plugin's prerequisite probe and, when the real backing service
//     or test account is available, executes integration.mjs through the
//     zero-dependency `CommandRunner`, which emits one machine-readable
//     `plugin.<id>.artifact.json` (pass result + plugin id + ISO-8601 timestamp).
//
//   • integration.mjs  — the real integration harness for ONE plugin. It runs
//     the plugin's client/adapter against its REAL backing service (Redis / S3 /
//     R2 via containers or cloud accounts; Twilio / SendGrid / Stripe / Auth0
//     via sandbox/test accounts). When the prerequisite is absent it prints a
//     SKIP line and exits 0 so the offline suite stays green — the driver's
//     prerequisite probe is what records the honest BLOCKED.
//
// Honest BLOCKED (Requirement 1.5 / 5.9 / Testing Strategy → Honest BLOCKED):
// when a backing service is unreachable or a test credential is absent, the
// probe returns the SPECIFIC missing prerequisite id (a credential env-var name
// for vendor accounts, or a service id for container backends). The runner then
// classifies the capability BLOCKED with that id — never a mock, never a false
// VERIFIED, never PARTIAL.
//
// Zero runtime dependencies: only Node core (`node:net`, `node:path`, `node:url`).

import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** The repo root, derived from this file's location (scripts/plugins/ → ../../). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A BlockedReason for a missing CREDENTIAL: returns the first absent env-var id
 * from `names`, or `null` when every credential is present.
 *
 * @param {string[]} names ordered list of required env-var names
 * @returns {{ missingPrerequisite: string, kind: 'credential' } | null}
 */
export function missingCredential(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v === undefined || String(v).trim() === '') {
      return { missingPrerequisite: name, kind: 'credential' };
    }
  }
  return null;
}

/**
 * Read the first defined+non-empty env var among `names`, else `undefined`.
 * Lets a plugin accept either a vendor-specific or a conventional fallback id
 * (e.g. `S3_ACCESS_KEY_ID` or `AWS_ACCESS_KEY_ID`).
 */
export function firstEnv(names) {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined && String(v).trim() !== '') return String(v);
  }
  return undefined;
}

/**
 * Probe a TCP service for reachability. Resolves true when a connection opens
 * within `timeoutMs`, false otherwise. Used for container-backed services
 * (e.g. Redis) so an unreachable backend is recorded as an honest BLOCKED
 * service rather than a hard failure.
 */
export function tcpReachable(host, port, timeoutMs = 2_000) {
  return new Promise((resolveP) => {
    const sock = createConnection({ host, port });
    let settled = false;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolveP(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/** Resolve the Redis host/port from the environment (defaults to the container's). */
export function redisTarget() {
  const url = firstEnv(['REDIS_URL']);
  if (url) {
    try {
      const u = new URL(url);
      return {
        host: u.hostname || '127.0.0.1',
        port: u.port ? Number(u.port) : 6379,
        ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
      };
    } catch {
      // fall through to discrete vars
    }
  }
  return {
    host: firstEnv(['REDIS_HOST']) ?? '127.0.0.1',
    port: Number(firstEnv(['REDIS_PORT']) ?? '6379'),
    ...(firstEnv(['REDIS_PASSWORD']) ? { password: firstEnv(['REDIS_PASSWORD']) } : {}),
  };
}

/**
 * The official plugin registry: the fixed set of capabilities verified by this
 * task (Requirement 5.1–5.4). Each entry declares its dotted capability id and
 * an async prerequisite probe returning a `BlockedReason` (the specific missing
 * service/credential id) or `null` when the real backing service/account is
 * available.
 *
 * @type {Record<string, { id: string, capabilityId: string, backing: 'container'|'account', probe: () => Promise<{ missingPrerequisite: string, kind: string } | null> }>}
 */
export const PLUGINS = {
  // ── Storage (containers / cloud object stores) ────────────────────────────
  redis: {
    id: 'redis',
    capabilityId: 'plugin.redis',
    backing: 'container',
    async probe() {
      const { host, port } = redisTarget();
      const up = await tcpReachable(host, port);
      return up ? null : { missingPrerequisite: `redis-service@${host}:${port}`, kind: 'service' };
    },
  },
  s3: {
    id: 's3',
    capabilityId: 'plugin.s3',
    backing: 'account',
    async probe() {
      // S3 bucket coordinates + AWS credentials (vendor-specific or AWS fallback).
      if (!firstEnv(['S3_BUCKET'])) return { missingPrerequisite: 'S3_BUCKET', kind: 'credential' };
      if (!firstEnv(['S3_REGION', 'AWS_REGION'])) return { missingPrerequisite: 'S3_REGION', kind: 'credential' };
      if (!firstEnv(['S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'])) return { missingPrerequisite: 'S3_ACCESS_KEY_ID', kind: 'credential' };
      if (!firstEnv(['S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'])) return { missingPrerequisite: 'S3_SECRET_ACCESS_KEY', kind: 'credential' };
      return null;
    },
  },
  r2: {
    id: 'r2',
    capabilityId: 'plugin.r2',
    backing: 'account',
    async probe() {
      return missingCredential(['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']);
    },
  },

  // ── Messaging (vendor sandbox/test accounts) ──────────────────────────────
  twilio: {
    id: 'twilio',
    capabilityId: 'plugin.twilio',
    backing: 'account',
    async probe() {
      return missingCredential(['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']);
    },
  },
  sendgrid: {
    id: 'sendgrid',
    capabilityId: 'plugin.sendgrid',
    backing: 'account',
    async probe() {
      return missingCredential(['SENDGRID_API_KEY']);
    },
  },

  // ── Payments (vendor test account) ────────────────────────────────────────
  stripe: {
    id: 'stripe',
    capabilityId: 'plugin.stripe',
    backing: 'account',
    async probe() {
      // Accept the CI secret name `STRIPE_API_KEY` or the explicit test key.
      return firstEnv(['STRIPE_API_KEY', 'STRIPE_TEST_KEY'])
        ? null
        : { missingPrerequisite: 'STRIPE_API_KEY', kind: 'credential' };
    },
  },

  // ── Identity (vendor test tenant) ─────────────────────────────────────────
  auth0: {
    id: 'auth0',
    capabilityId: 'plugin.auth0',
    backing: 'account',
    async probe() {
      return missingCredential(['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET']);
    },
  },
};

/** The fixed, ordered list of official-plugin ids verified by Requirement 5.9. */
export const PLUGIN_IDS = Object.keys(PLUGINS);

/** Look up a plugin by id, throwing a labelled error for an unknown id. */
export function resolvePlugin(id) {
  const plugin = PLUGINS[id];
  if (!plugin) {
    throw new Error(`unknown plugin id '${id}' (known: ${PLUGIN_IDS.join(', ')})`);
  }
  return plugin;
}
