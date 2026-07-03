/**
 * @streetjs/storage — provider-agnostic access control.
 *
 * The {@link AccessController} resolves an {@link AccessLevel} decision for a
 * single object operation (read / write / delete) and, when the caller lacks
 * the required access, denies the operation with an {@link AuthorizationError}
 * so no persistence or read is performed. The facade constructs one controller
 * per {@link Storage} instance and consults it as the first step of the object
 * operations it guards (see the `put`/`get` data flow in the design).
 *
 * Access decisions are delegated to the optional **structural** auth bridge
 * {@link AuthLike} carried on `config.auth`. This keeps the package free of any
 * hard dependency on `@streetjs/auth`: any object exposing a compatible
 * `can(context)` method satisfies the contract (Requirements 11.2, 17.2).
 *
 * The controller supports every {@link AccessLevel} value — `public`,
 * `private`, `signed`, `authenticated`, `role-based`, and `tenant-aware`
 * (Requirement 11.1) — and applies a single, uniform rule:
 *
 *   - **No auth bridge configured** → every operation is permitted. The
 *     framework stays permissive by default so drivers that never configure
 *     access control (the in-memory / local defaults) behave exactly as before.
 *   - **Auth bridge configured** → the bridge's `can(context)` decision governs
 *     the operation. A `false` decision denies with an {@link AuthorizationError}
 *     (Requirement 11.3); any other result permits. This is where the
 *     `authenticated`, `role-based`, and `tenant-aware` levels are resolved
 *     against StreetJS authentication (Requirement 11.2).
 *   - **`public` reads** are permitted without authentication; a configured
 *     bridge may still block them by returning `false`, honoring the "unless
 *     another configured factor blocks the access" clause (Requirement 11.4).
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4_
 */

import { AuthorizationError } from "./errors.js";
import type { AccessLevel, AuthLike } from "./types.js";

// Re-export the structural auth contract from its canonical home so callers can
// import it alongside the controller. This is the SAME type declared in
// `./types.js` (re-exported, never redeclared), so it never conflicts with the
// existing public `AuthLike` export.
export type { AuthLike } from "./types.js";

/** The class of object operation an access decision governs. */
export type AccessOperation = "read" | "write" | "delete";

/**
 * The subject of a single access decision: the object `key`, the attempted
 * `operation`, the governing `accessLevel`, and the optional ownership /
 * tenancy attributes the auth bridge may key its decision on.
 */
export interface AccessContext {
  readonly key: string;
  readonly operation: AccessOperation;
  readonly accessLevel: AccessLevel;
  readonly owner?: string;
  readonly tenant?: string;
}

/** Options for constructing an {@link AccessController}. */
export interface AccessControllerOptions {
  /** The optional structural auth bridge that governs access decisions. */
  readonly auth?: AuthLike;
}

/** Read-like operations that a `public` access level permits without auth. */
const READ_OPERATIONS: ReadonlySet<AccessOperation> = new Set<AccessOperation>(["read"]);

/**
 * Resolves per-object {@link AccessLevel} decisions, denying disallowed
 * operations with an {@link AuthorizationError}.
 *
 * Construct one from `config.auth`; the facade does this once per `Storage`
 * instance and calls {@link AccessController.authorize} before delegating a
 * guarded operation to the driver. When no auth bridge is configured the
 * controller is a permissive no-op, preserving the framework's default
 * behavior for unconfigured drivers.
 */
export class AccessController {
  /** The optional structural auth bridge consulted for every decision. */
  private readonly auth?: AuthLike;

  constructor(options: AccessControllerOptions = {}) {
    this.auth = options.auth;
  }

  /**
   * Whether access control is actively enforced. This is `true` only when an
   * auth bridge is configured; callers use it to skip any preparatory work
   * (e.g. a metadata lookup to discover an object's access level) on the common
   * unconfigured path so behavior and cost are unchanged when no bridge exists.
   */
  get enforced(): boolean {
    return this.auth !== undefined;
  }

  /**
   * Decide whether `context` is permitted and throw an {@link AuthorizationError}
   * when it is not (Requirement 11.3). On permit this resolves without a value
   * and the caller proceeds; on deny it throws before any persistence or read
   * occurs so the guarded operation has no effect.
   *
   * Decision rules:
   *  - No auth bridge configured → permit (the framework is permissive by
   *    default so unconfigured drivers are unaffected).
   *  - `public` reads → permit unless the configured bridge explicitly returns
   *    `false`, in which case that "other configured factor" blocks the access
   *    (Requirement 11.4).
   *  - Otherwise → the bridge's `can(context)` decision governs; a `false`
   *    result denies, any other result permits (Requirements 11.1, 11.2).
   */
  async authorize(context: AccessContext): Promise<void> {
    // Permissive default: with no configured auth bridge nothing is denied, so
    // drivers that never configure access control behave exactly as before.
    if (this.auth === undefined) {
      return;
    }

    const decision = await this.auth.can({
      key: context.key,
      operation: context.operation,
      accessLevel: context.accessLevel,
      owner: context.owner,
      tenant: context.tenant,
    });

    // A `public` read is permitted without authentication; a bridge may still
    // block it, but only by explicitly returning `false` (Requirement 11.4).
    if (context.accessLevel === "public" && READ_OPERATIONS.has(context.operation)) {
      if (decision === false) {
        throw this.denial(context);
      }
      return;
    }

    // For every other level/operation the bridge's decision is authoritative:
    // a `false` result denies the operation (Requirement 11.3).
    if (decision === false) {
      throw this.denial(context);
    }
  }

  /** Build the descriptive {@link AuthorizationError} for a denied context. */
  private denial(context: AccessContext): AuthorizationError {
    return new AuthorizationError(
      `Access denied: operation "${context.operation}" on "${context.key}" ` +
        `is not permitted for access level "${context.accessLevel}".`,
      {
        key: context.key,
        operation: context.operation,
        accessLevel: context.accessLevel,
      },
    );
  }
}
