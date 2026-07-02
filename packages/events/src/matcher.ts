// src/matcher.ts
// @streetjs/events — runtime wildcard matching for event subscriptions.
//
// Semantics (kept identical to the type-level `MatchingEventNames` in event.ts):
//   - patterns and names are dot-delimited segment lists;
//   - `*`  matches EXACTLY ONE segment;
//   - `**` matches ONE OR MORE segments;
//   - a pattern with no `*` matches only the exact name (string equality).
//
// Pure, zero-dependency, and total (never throws) for any string inputs.

/** True when `pattern` contains a `*` segment (i.e. it is a wildcard pattern). */
export function isWildcard(pattern: string): boolean {
  return pattern.includes('*');
}

/**
 * Match a concrete event `name` against a subscription `pattern`.
 *
 * Fast path: a pattern without `*` is compared by exact string equality. Empty
 * names never match a wildcard (every event has at least one segment).
 */
export function matchesPattern(name: string, pattern: string): boolean {
  if (!isWildcard(pattern)) {
    return name === pattern;
  }
  return matchSegments(pattern.split('.'), name.split('.'));
}

/**
 * Recursive segment matcher supporting `*` (exactly one segment) and `**` (one
 * or more segments, with backtracking so `a.**.b` style patterns resolve
 * correctly). Not exported; callers use {@link matchesPattern}.
 */
function matchSegments(pat: readonly string[], name: readonly string[]): boolean {
  if (pat.length === 0) {
    return name.length === 0;
  }

  const head = pat[0]!;
  const patRest = pat.slice(1);

  if (head === '**') {
    // `**` consumes one or more name segments; try each split (backtracking).
    if (name.length === 0) {
      return false;
    }
    for (let take = 1; take <= name.length; take += 1) {
      if (matchSegments(patRest, name.slice(take))) {
        return true;
      }
    }
    return false;
  }

  if (name.length === 0) {
    return false;
  }

  // `*` matches any single segment; a literal segment must match exactly.
  if (head === '*' || head === name[0]) {
    return matchSegments(patRest, name.slice(1));
  }

  return false;
}
