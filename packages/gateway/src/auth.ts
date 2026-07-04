/**
 * @streetjs/gateway — authentication & authorization.
 *
 * Two pure, dependency-light stages:
 *
 *   1. {@link authenticate} resolves an {@link Identity} (or `null`) from a
 *      request according to an {@link AuthPolicy}. Credential *verification* is
 *      always injected via {@link AuthDeps} (or a policy-level `verify`) so this
 *      module never embeds crypto, key stores, or a hard dependency on the
 *      streetjs JWT implementation.
 *   2. {@link authorize} enforces an {@link AuthorizationPolicy} against a
 *      resolved identity, throwing {@link UnauthenticatedError} /
 *      {@link ForbiddenError} on denial and returning `void` on allow.
 *
 * {@link isAuthorized} mirrors {@link authorize} as a non-throwing boolean for
 * ergonomic call sites and unit tests.
 */

import type {
  AuthPolicy,
  AuthorizationPolicy,
  GatewayRequest,
  Headers,
  Identity,
} from "./types.js";
import { ForbiddenError, UnauthenticatedError } from "./errors.js";

// ── Injected verifiers ──────────────────────────────────────────────────────────

/**
 * Injectable credential resolvers. Each resolver maps an extracted credential to
 * an {@link Identity} (authenticated) or `null` (unknown/invalid). Any of them may
 * be synchronous or asynchronous. Keeping these external lets the gateway plug in
 * streetjs JWT, an API-key store, or a session backend without this module
 * depending on them directly.
 */
export interface AuthDeps {
  /** Verify a bearer token, resolving to an identity or `null`. */
  readonly verifyJwt?: (token: string) => Promise<Identity | null> | Identity | null;
  /** Resolve an API key to an identity or `null`. */
  readonly apiKeys?: (key: string) => Promise<Identity | null> | Identity | null;
  /** Resolve a session id to an identity or `null`. */
  readonly sessions?: (sid: string) => Promise<Identity | null> | Identity | null;
}

// ── Header helpers ────────────────────────────────────────────────────────────────

/**
 * Read a single header value. Header keys are lower-cased by convention; when a
 * header appears multiple times (`string[]`) the first entry is used.
 */
function header(headers: Headers, name: string): string | undefined {
  const raw = headers[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Extract a bearer token from an `Authorization: Bearer <token>` header. */
function bearerToken(headers: Headers): string | undefined {
  const auth = header(headers, "authorization");
  if (auth === undefined) return undefined;
  const match = /^Bearer[ \t]+(.+)$/i.exec(auth.trim());
  if (match === null) return undefined;
  const token = match[1]!.trim();
  return token.length > 0 ? token : undefined;
}

/**
 * Resolve a session id from an explicit `x-session-id` header, falling back to a
 * `session`/`sid` cookie parsed from the `cookie` header.
 */
function sessionId(headers: Headers): string | undefined {
  const explicit = header(headers, "x-session-id");
  if (explicit !== undefined && explicit.length > 0) return explicit;

  const cookie = header(headers, "cookie");
  if (cookie === undefined) return undefined;
  for (const pair of cookie.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = pair.slice(0, eq).trim().toLowerCase();
    if (key === "session" || key === "sid" || key === "sessionid") {
      const value = pair.slice(eq + 1).trim();
      if (value.length > 0) return value;
    }
  }
  return undefined;
}

// ── Authentication ────────────────────────────────────────────────────────────────

/**
 * Resolve the identity for a request under `policy`.
 *
 * - `none`     → `null` (no identity required).
 * - `custom`   → delegates to `policy.verify(req)`; `null` when no verifier.
 * - `api-key`  → reads `x-api-key`, resolving via `deps.apiKeys` then
 *                `policy.verify`; `null` when the header is absent or unresolved.
 * - `jwt`      → reads `Authorization: Bearer <token>`, resolving via
 *                `deps.verifyJwt` then `policy.verify`; `null` when the header is
 *                absent or neither verifier is provided.
 * - `session`  → reads `x-session-id`/`cookie`, resolving via `deps.sessions`
 *                then `policy.verify`; `null` when absent or unresolved.
 *
 * Never throws: an unresolved credential always yields `null`, leaving the
 * authenticated/deny decision to {@link authorize}.
 */
export async function authenticate(
  policy: AuthPolicy,
  req: GatewayRequest,
  deps?: AuthDeps,
): Promise<Identity | null> {
  switch (policy.kind) {
    case "none":
      return null;

    case "custom":
      return policy.verify ? (await policy.verify(req)) ?? null : null;

    case "api-key": {
      const key = header(req.headers, "x-api-key");
      if (key === undefined || key.length === 0) return null;
      if (deps?.apiKeys) return (await deps.apiKeys(key)) ?? null;
      if (policy.verify) return (await policy.verify(req)) ?? null;
      return null;
    }

    case "jwt": {
      const token = bearerToken(req.headers);
      if (token === undefined) return null;
      if (deps?.verifyJwt) return (await deps.verifyJwt(token)) ?? null;
      if (policy.verify) return (await policy.verify(req)) ?? null;
      return null;
    }

    case "session": {
      const sid = sessionId(req.headers);
      if (sid === undefined) return null;
      if (deps?.sessions) return (await deps.sessions(sid)) ?? null;
      if (policy.verify) return (await policy.verify(req)) ?? null;
      return null;
    }

    default: {
      // Exhaustiveness guard: unknown kinds resolve to no identity.
      const _exhaustive: never = policy.kind;
      void _exhaustive;
      return null;
    }
  }
}

// ── Authorization ─────────────────────────────────────────────────────────────────

/** True when `identity` holds at least one of the `required` values. */
function hasAny(present: readonly string[] | undefined, required: readonly string[] | undefined): boolean {
  if (required === undefined || required.length === 0) return true;
  if (present === undefined || present.length === 0) return false;
  const set = new Set(present);
  return required.some((r) => set.has(r));
}

/**
 * Enforce `policy` against a resolved `identity`, throwing on denial:
 *
 * - `public`        → always allowed.
 * - `authenticated` → allowed iff `identity !== null`, else
 *                      {@link UnauthenticatedError}.
 * - `role`          → requires an identity holding one of `policy.roles`; a
 *                      `null` identity throws {@link UnauthenticatedError},
 *                      otherwise a missing role throws {@link ForbiddenError}.
 * - `permission`    → same as `role` against `policy.permissions`.
 * - `custom`        → `policy.decide(identity, req)`; a falsy result throws
 *                      {@link ForbiddenError}.
 *
 * Design choice: for `custom`, a `false` decision always maps to
 * {@link ForbiddenError} even when `identity` is `null`. The decider owns the
 * full decision, so we keep the failure mode uniform rather than inferring
 * "unauthenticated" from a null identity.
 */
export async function authorize(
  policy: AuthorizationPolicy,
  identity: Identity | null,
  req: GatewayRequest,
): Promise<void> {
  switch (policy.kind) {
    case "public":
      return;

    case "authenticated":
      if (identity === null) throw new UnauthenticatedError();
      return;

    case "role":
      if (identity === null) throw new UnauthenticatedError();
      if (!hasAny(identity.roles, policy.roles)) throw new ForbiddenError();
      return;

    case "permission":
      if (identity === null) throw new UnauthenticatedError();
      if (!hasAny(identity.permissions, policy.permissions)) throw new ForbiddenError();
      return;

    case "custom": {
      const allowed = policy.decide ? await policy.decide(identity, req) : false;
      if (!allowed) throw new ForbiddenError();
      return;
    }

    default: {
      const _exhaustive: never = policy.kind;
      void _exhaustive;
      throw new ForbiddenError();
    }
  }
}

/**
 * Non-throwing mirror of {@link authorize}: returns `true` when access is
 * allowed and `false` when {@link authorize} would throw. Any non-auth error
 * (e.g. a decider throwing) is allowed to propagate.
 */
export async function isAuthorized(
  policy: AuthorizationPolicy,
  identity: Identity | null,
  req: GatewayRequest,
): Promise<boolean> {
  try {
    await authorize(policy, identity, req);
    return true;
  } catch (err) {
    if (err instanceof UnauthenticatedError || err instanceof ForbiddenError) return false;
    throw err;
  }
}
