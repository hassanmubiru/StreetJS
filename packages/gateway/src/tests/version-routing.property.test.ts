import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { resolveVersion } from "../versioning.js";
import type { GatewayRequest, Headers, VersioningPolicy, VersionSource } from "../types.js";

/**
 * Feature: gateway, Property: version-routing
 *
 * These properties check {@link resolveVersion} against an independent reference
 * of the "first configured source that yields a known version wins" rule, and
 * against the invariant that an unknown value never resolves to a non-default
 * known version unless a configured source actually holds a known version.
 */

const KNOWN = ["v1", "v2", "v3"] as const;
const ALL_SOURCES: readonly VersionSource[] = ["path", "x-version", "accept-version"];

// ── Slot model ──────────────────────────────────────────────────────────────
// Each source's physical content is one of: a known version, an unknown value,
// or (for headers) absent. The request is materialized from these slots, then
// only the *configured* sources are consulted, in order.

type Slot =
  | { readonly kind: "known"; readonly version: string }
  | { readonly kind: "unknown" }
  | { readonly kind: "absent" };

const knownArb = fc.constantFrom(...KNOWN);
const restSegArb = fc.constantFrom("", "users", "users/42", "a/b/c");

/** Path slots: either a known `/vN[/rest]`, or a path with no known version. */
const pathSlotArb = fc.oneof(
  fc.record({ kind: fc.constant("known" as const), version: knownArb }),
  fc.constant({ kind: "unknown" as const }),
);
/** Unknown path candidates: none begin with a version known to the policy. */
const unknownPathArb = fc.constantFrom("/users", "/v9/users", "/api/thing", "/health", "/");

/** Header slots: known version, unknown string, or absent. */
const headerSlotArb: fc.Arbitrary<Slot> = fc.oneof(
  fc.record({ kind: fc.constant("known" as const), version: knownArb }),
  fc.constant({ kind: "unknown" as const }),
  fc.constant({ kind: "absent" as const }),
);
const unknownHeaderArb = fc.constantFrom("v9", "v42", "banana", "");

/** A non-empty, de-duplicated ordering of a subset of the three sources. */
const sourcesArb = fc
  .shuffledSubarray(ALL_SOURCES as VersionSource[], { minLength: 1, maxLength: 3 })
  .filter((s) => s.length > 0);

interface Scenario {
  readonly pathSlot: { kind: "known"; version: string } | { kind: "unknown" };
  readonly pathUnknown: string;
  readonly pathRest: string;
  readonly xSlot: Slot;
  readonly xUnknown: string;
  readonly aSlot: Slot;
  readonly aUnknown: string;
  readonly query: string;
  readonly sources: readonly VersionSource[];
  readonly def: string;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  pathSlot: pathSlotArb,
  pathUnknown: unknownPathArb,
  pathRest: restSegArb,
  xSlot: headerSlotArb,
  xUnknown: unknownHeaderArb,
  aSlot: headerSlotArb,
  aUnknown: unknownHeaderArb,
  query: fc.constantFrom("", "?a=1", "?full=1&x=2"),
  sources: sourcesArb,
  def: knownArb,
});

/** Materialize the request path (with query) from the path slot. */
function buildPath(s: Scenario): string {
  const base =
    s.pathSlot.kind === "known"
      ? "/" + s.pathSlot.version + (s.pathRest ? "/" + s.pathRest : "")
      : s.pathUnknown;
  return base + s.query;
}

/** Materialize the header bag from the header slots. */
function buildHeaders(s: Scenario): Headers {
  const h: Record<string, string> = {};
  if (s.xSlot.kind === "known") h["x-version"] = s.xSlot.version;
  else if (s.xSlot.kind === "unknown") h["x-version"] = s.xUnknown;
  if (s.aSlot.kind === "known") h["accept-version"] = s.aSlot.version;
  else if (s.aSlot.kind === "unknown") h["accept-version"] = s.aUnknown;
  return h;
}

/** The known version physically present at a given source (or undefined). */
function knownAt(s: Scenario, source: VersionSource): string | undefined {
  switch (source) {
    case "path":
      return s.pathSlot.kind === "known" ? s.pathSlot.version : undefined;
    case "x-version":
      return s.xSlot.kind === "known" ? s.xSlot.version : undefined;
    case "accept-version":
      return s.aSlot.kind === "known" ? s.aSlot.version : undefined;
  }
}

function makePolicy(s: Scenario): VersioningPolicy {
  return { sources: s.sources, versions: KNOWN, default: s.def };
}

function makeRequest(s: Scenario): GatewayRequest {
  const path = buildPath(s);
  return { method: "GET", url: path, path, headers: buildHeaders(s) };
}

test("Feature: gateway, Property: version-routing — first configured source with a known version wins", () => {
  fc.assert(
    fc.property(scenarioArb, (s) => {
      const result = resolveVersion(makePolicy(s), makeRequest(s));

      // Reference: walk configured sources in order; first known version wins.
      let expectedSource: VersionSource | "default" = "default";
      let expectedVersion = s.def;
      for (const src of s.sources) {
        const v = knownAt(s, src);
        if (v !== undefined) {
          expectedSource = src;
          expectedVersion = v;
          break;
        }
      }

      assert.equal(result.version, expectedVersion, "resolved version");
      assert.equal(result.source, expectedSource, "resolved source");

      // Every resolved version is a known version (default is always known here).
      assert.ok(KNOWN.includes(result.version as (typeof KNOWN)[number]));

      // strippedPath: stripped only when the path source wins, else the original path.
      const fullPath = buildPath(s);
      if (expectedSource === "path" && s.pathSlot.kind === "known") {
        const q = s.query;
        const bare = fullPath.slice(0, fullPath.length - q.length);
        const rest = bare.slice(1 + s.pathSlot.version.length);
        const expectedStripped = (rest === "" ? "/" : rest) + q;
        assert.equal(result.strippedPath, expectedStripped, "stripped path");
      } else {
        assert.equal(result.strippedPath, fullPath, "path unchanged");
      }
    }),
    { numRuns: 100 },
  );
});

test("Feature: gateway, Property: version-routing — unknown-only inputs resolve to the default", () => {
  // Force every configured source to hold a non-known value (or be absent).
  const unknownScenarioArb = scenarioArb.map((s): Scenario => ({
    ...s,
    pathSlot: { kind: "unknown" },
    xSlot: s.xSlot.kind === "known" ? { kind: "unknown" } : s.xSlot,
    aSlot: s.aSlot.kind === "known" ? { kind: "unknown" } : s.aSlot,
  }));

  fc.assert(
    fc.property(unknownScenarioArb, (s) => {
      const result = resolveVersion(makePolicy(s), makeRequest(s));
      // No configured source holds a known version → default, path untouched.
      assert.equal(result.source, "default");
      assert.equal(result.version, s.def);
      assert.equal(result.strippedPath, buildPath(s));
    }),
    { numRuns: 100 },
  );
});
