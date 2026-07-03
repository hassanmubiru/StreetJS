/**
 * @streetjs/storage — attribute search / filtering over the flat key space
 * (task 18.1).
 *
 * Object stores expose only a flat key space plus per-object metadata, so
 * search is implemented as a provider-agnostic filter over the two mandatory
 * driver primitives {@link StorageDriver.list} and {@link StorageDriver.stat}:
 *
 * 1. Enumerate candidate keys with `driver.list(prefix)` (the prefix filter is
 *    pushed down to the driver; an absent prefix lists the whole key space).
 * 2. For each candidate, read its typed metadata with `driver.stat(key)`.
 * 3. Keep the object only when it satisfies **every** supplied filter
 *    (conjunctive / AND semantics — Requirement 16.2); when no object satisfies
 *    the filters the result is the empty set (Requirement 16.3).
 *
 * The supported filters mirror {@link SearchFilters} (Requirement 16.1):
 *
 * - `prefix`         — key begins with the prefix (pushed to `driver.list`).
 * - `contentType`    — exact content-type match.
 * - `owner`          — exact owner match.
 * - `tenant`         — exact tenant match.
 * - `minSize`        — size ≥ minSize (inclusive lower bound).
 * - `maxSize`        — size ≤ maxSize (inclusive upper bound).
 * - `updatedAfter`   — updatedAt ≥ updatedAfter (inclusive lower time bound).
 * - `updatedBefore`  — updatedAt ≤ updatedBefore (inclusive upper time bound).
 * - `metadata`       — every supplied custom field deep-equals the object's
 *                      corresponding `custom` field.
 *
 * Reserved internal key spaces used by the cross-cutting layers
 * (`.versions/`, `.multipart/`, `.resumable/`, `.archive/`) are excluded from
 * results unless the supplied `prefix` explicitly targets one of them, so a
 * broad search returns only user-visible objects and never leaks framework
 * bookkeeping keys.
 *
 * The result preserves the {@link StorageListItem} shape returned by
 * `driver.list`, so `search` composes with the rest of the facade surface.
 *
 * _Requirements: 16.1, 16.2, 16.3_
 */

import type { StorageDriver } from "./driver.js";
import type { SearchFilters, StorageListItem, StorageObjectMetadata } from "./types.js";

/**
 * Reserved key prefixes that hold framework bookkeeping (version snapshots,
 * multipart parts, resumable session bytes, archived copies). These are hidden
 * from search results unless the caller explicitly searches within one of them.
 */
const RESERVED_KEY_PREFIXES: readonly string[] = [
  ".versions/",
  ".multipart/",
  ".resumable/",
  ".archive/",
];

/**
 * Return the stored objects that satisfy **every** supplied filter, evaluated
 * over `driver.list` + `driver.stat`.
 *
 * The prefix filter is delegated to `driver.list`; the remaining filters are
 * applied against each candidate's metadata. Objects whose metadata cannot be
 * read (e.g. removed concurrently between `list` and `stat`) are skipped. When
 * no object satisfies the filters, an empty array is returned (Requirement
 * 16.3).
 *
 * @param driver  The storage driver to search over.
 * @param filters The conjunctive set of {@link SearchFilters} to apply.
 * @returns The matching objects as {@link StorageListItem}s.
 */
export async function searchObjects(
  driver: StorageDriver,
  filters: SearchFilters = {},
): Promise<StorageListItem[]> {
  const prefix = filters.prefix ?? "";
  const candidates = await driver.list(prefix);

  const matches: StorageListItem[] = [];
  for (const item of candidates) {
    // Defensive re-filter: never surface keys outside the requested prefix even
    // if a driver interprets `list` loosely.
    if (prefix !== "" && !item.key.startsWith(prefix)) {
      continue;
    }
    // Hide reserved bookkeeping keys unless the search explicitly targets them.
    if (isReservedKey(item.key) && !prefixTargetsReserved(prefix)) {
      continue;
    }

    const metadata = await driver.stat(item.key);
    if (metadata === null) {
      // Object vanished between list and stat, or has no metadata — not a match.
      continue;
    }
    if (matchesFilters(metadata, filters)) {
      matches.push(item);
    }
  }

  return matches;
}

/** Whether `key` lives in one of the reserved internal key spaces. */
function isReservedKey(key: string): boolean {
  return RESERVED_KEY_PREFIXES.some((reserved) => key.startsWith(reserved));
}

/** Whether the requested `prefix` explicitly targets a reserved key space. */
function prefixTargetsReserved(prefix: string): boolean {
  return RESERVED_KEY_PREFIXES.some((reserved) => prefix.startsWith(reserved));
}

/**
 * Return true only when `metadata` satisfies every supplied filter (AND
 * semantics). Absent filter fields impose no constraint.
 */
function matchesFilters(metadata: StorageObjectMetadata, filters: SearchFilters): boolean {
  if (filters.contentType !== undefined && metadata.contentType !== filters.contentType) {
    return false;
  }
  if (filters.owner !== undefined && metadata.owner !== filters.owner) {
    return false;
  }
  if (filters.tenant !== undefined && metadata.tenant !== filters.tenant) {
    return false;
  }
  if (filters.minSize !== undefined && metadata.size < filters.minSize) {
    return false;
  }
  if (filters.maxSize !== undefined && metadata.size > filters.maxSize) {
    return false;
  }
  if (filters.updatedAfter !== undefined && metadata.updatedAt < filters.updatedAfter) {
    return false;
  }
  if (filters.updatedBefore !== undefined && metadata.updatedAt > filters.updatedBefore) {
    return false;
  }
  if (filters.metadata !== undefined && !matchesCustomMetadata(metadata.custom, filters.metadata)) {
    return false;
  }
  return true;
}

/**
 * Return true when every field required by `required` is present in the
 * object's `custom` metadata and deep-equals the required value.
 */
function matchesCustomMetadata(custom: unknown, required: Record<string, unknown>): boolean {
  if (custom === null || typeof custom !== "object") {
    return Object.keys(required).length === 0;
  }
  const source = custom as Record<string, unknown>;
  for (const [field, value] of Object.entries(required)) {
    if (!deepEqual(source[field], value)) {
      return false;
    }
  }
  return true;
}

/**
 * Structural deep-equality used to compare custom metadata values. Handles
 * primitives, arrays, and plain objects so nested custom fields compare by
 * value rather than reference.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((element, index) => deepEqual(element, b[index]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) {
    return false;
  }
  return aKeys.every((key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]));
}
