// src/integrations/storage.ts
// @streetjs/workflow — Storage bridge (Pillar 4, Requirement 15).
//
// This bridge exposes the `ctx.storage` surface ({@link StorageContext}) over a
// structural {@link StorageLike} contract. It depends ONLY on the structural
// shape declared in `../types.js` — never on `@streetjs/storage` itself — so the
// base package keeps its single `streetjs` runtime dependency and declares no
// hard, optional, or peer dependency on the storage pillar (Requirement 15.2).
// A live `@streetjs/storage` instance satisfies `StorageLike` structurally with
// no adapter.
//
// Behavior (Requirement 15):
//  - 15.1 When a `StorageLike` is wired, expose `put`/`get`/`delete`/`move`/`copy`.
//  - 15.3 When no `StorageLike` is wired, runs that never touch `ctx.storage`
//         proceed unaffected (the returned surface simply is never called).
//  - 15.4 A `ctx.storage` call with no bridge wired yields a descriptive
//         `WorkflowConfigError` naming the bridge and the attempted operation.
//  - 15.5 Repeating the same mutating operation (`put`/`move`/`copy`/`delete`)
//         with the same arguments within a single run yields the same observable
//         stored state. The bridge keys each mutation so a repeat is a no-op with
//         respect to the underlying store (idempotence within a Workflow_Run).
//
// The canonical `StorageLike` / `StorageContext` definitions live in
// `../types.js`; this module re-exports `StorageLike` for convenience only.

import { WorkflowConfigError } from "../errors.js";
import type { StorageContext, StorageLike } from "../types.js";

// Convenience re-export; the canonical definition remains in `../types.js`.
export type { StorageLike } from "../types.js";

/** The mutating storage operations that are keyed for within-run idempotence. */
type MutatingOp = "put" | "delete" | "move" | "copy";

/**
 * Produce a stable, collision-resistant token for an arbitrary argument so that
 * two invocations with structurally identical arguments map to the same
 * idempotence key. Strings and byte content are hashed with length included;
 * option bags are serialized best-effort.
 */
function token(value: unknown): string {
  if (value === undefined) {
    return "u";
  }
  if (typeof value === "string") {
    return `s${value.length}:${fnv1a(value)}`;
  }
  if (value instanceof Uint8Array) {
    return `b${value.length}:${fnv1aBytes(value)}`;
  }
  // Option bags / metadata — best-effort stable serialization.
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return "j:unserializable";
  }
}

/** FNV-1a 32-bit hash of a string, returned as a hex token. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** FNV-1a 32-bit hash of raw bytes, returned as a hex token. */
function fnv1aBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i += 1) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Compose the idempotence key for a mutating operation and its arguments. */
function keyOf(op: MutatingOp, args: readonly unknown[]): string {
  return `${op}:${args.map(token).join("|")}`;
}

/**
 * Build the per-run `ctx.storage` surface ({@link StorageContext}).
 *
 * @param storage - The structural {@link StorageLike} bridge, or `undefined`
 *   when no storage bridge was supplied in configuration. When `undefined`,
 *   every operation on the returned surface throws a descriptive
 *   {@link WorkflowConfigError} (Requirement 15.4).
 * @returns A {@link StorageContext} scoped to a single Workflow_Run. Mutating
 *   operations (`put`/`move`/`copy`/`delete`) are keyed so that repeating the
 *   same operation with the same arguments within this run does not re-apply the
 *   effect, preserving the same observable stored state (Requirement 15.5).
 */
export function bridgeWorkflowStorage(storage?: StorageLike): StorageContext {
  // Per-run set of already-applied mutation keys. A fresh set per bridge
  // instance scopes idempotence to a single Workflow_Run.
  const applied = new Set<string>();

  /** Raise the descriptive misconfiguration error for an unwired bridge. */
  function unwired(operation: string): never {
    throw new WorkflowConfigError(
      `ctx.storage.${operation} was called but no StorageLike bridge is configured; ` +
        `supply a storage bridge in the workflow configuration to use ctx.storage.`,
      { bridge: "storage", operation },
    );
  }

  /**
   * Apply a mutating operation at most once per (operation, arguments) tuple
   * within this run. A repeated call with identical arguments is a no-op with
   * respect to the underlying store (Requirement 15.5).
   */
  async function applyOnce(
    op: MutatingOp,
    args: readonly unknown[],
    effect: () => Promise<unknown>,
  ): Promise<void> {
    const key = keyOf(op, args);
    if (applied.has(key)) {
      return;
    }
    await effect();
    applied.add(key);
  }

  return {
    async put(key, content, options) {
      if (!storage) {
        unwired("put");
      }
      await applyOnce("put", [key, content, options], () =>
        storage.put(key, content, options),
      );
    },

    async get(key) {
      if (!storage) {
        unwired("get");
      }
      // Reads carry no stored-state effect, so they are not keyed.
      return storage.get(key);
    },

    async delete(key) {
      if (!storage) {
        unwired("delete");
      }
      await applyOnce("delete", [key], () => storage.delete(key));
    },

    async move(from, to) {
      if (!storage) {
        unwired("move");
      }
      await applyOnce("move", [from, to], () => storage.move(from, to));
    },

    async copy(from, to) {
      if (!storage) {
        unwired("copy");
      }
      await applyOnce("copy", [from, to], () => storage.copy(from, to));
    },
  };
}
