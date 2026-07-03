// src/tests/purity.test.ts
// @streetjs/workflow — base-entry purity + scaffold well-formedness tests.
//
// Two guarantees are asserted here against the COMPILED artifacts, using the
// Node.js built-in test runner (`node --test dist/tests/*.test.js`):
//
//   1. Dependency isolation (Req 12.3, 22.6): the base package entry
//      `dist/index.js` imports NO pillar package (`@streetjs/storage`,
//      `@streetjs/queue`, `@streetjs/events`, `@streetjs/realtime`) and NO Redis
//      client (`redis`). Redis persistence lives only behind the dedicated
//      `@streetjs/workflow/redis` submodule, and the pillars are optional
//      structural bridges — the base entry must pull in none of them.
//
//   2. Scaffold well-formedness (Req 24.2, 31.4): the `make:workflow` /
//      `make:activity` generators emit non-empty TypeScript that imports only the
//      public `@streetjs/workflow` surface and declares the expected exports.
//
// Requirements: 12.3, 22.6, 27.1, 31.1

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { generateActivity, generateWorkflow } from "../cli/generators.js";

// ── Purity: the base entry imports no pillar package and no redis ────────────────

/** Module specifiers the base package entry must never import. */
const FORBIDDEN_MODULES = [
  "@streetjs/storage",
  "@streetjs/queue",
  "@streetjs/events",
  "@streetjs/realtime",
  "redis",
] as const;

/**
 * Remove block (`/* … *\/`) and line (`// …`) comments so the doc-comment that
 * *names* the forbidden modules for humans is not mistaken for a real import.
 * The line-comment strip preserves a leading `:` so `://` inside any residual
 * text is left intact.
 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Collect every module specifier referenced by a static `from "…"`, a bare
 * `import "…"`, a dynamic `import("…")`, or a `require("…")` in the given code.
 */
function collectImportSpecifiers(code: string): string[] {
  const specifiers: string[] = [];
  const re = /(?:\bfrom\b|\bimport\b|\brequire\b)\s*\(?\s*["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    specifiers.push(match[1] as string);
  }
  return specifiers;
}

/** A specifier is forbidden if it is a forbidden module or a subpath of one. */
function isForbidden(specifier: string): boolean {
  return FORBIDDEN_MODULES.some((mod) => specifier === mod || specifier.startsWith(`${mod}/`));
}

test("base entry `dist/index.js` imports no pillar package and no redis (Req 12.3, 22.6)", () => {
  // Resolve the COMPILED entry relative to this compiled test file:
  // dist/tests/purity.test.js → dist/index.js
  const indexPath = fileURLToPath(new URL("../index.js", import.meta.url));
  const raw = readFileSync(indexPath, "utf8");
  const code = stripComments(raw);

  const specifiers = collectImportSpecifiers(code);
  // Sanity: the base entry does import its own internal modules, so extraction
  // must have found something to make the assertions meaningful.
  assert.ok(specifiers.length > 0, "expected to find at least one import specifier in dist/index.js");

  const offenders = specifiers.filter(isForbidden);
  assert.deepEqual(
    offenders,
    [],
    `base entry must not import pillar packages or redis, but found: ${offenders.join(", ")}`,
  );

  // Defensive second check: even outside an import/require position, none of the
  // forbidden specifiers may appear as a quoted string in the comment-stripped
  // code (guards against any future dynamic wiring the regex above might miss).
  for (const mod of FORBIDDEN_MODULES) {
    assert.ok(
      !code.includes(`"${mod}"`) && !code.includes(`'${mod}'`),
      `base entry code must not reference the "${mod}" module specifier`,
    );
  }
});

// ── Scaffold well-formedness: generated code imports the public surface ──────────

test("generateWorkflow emits well-formed, public-surface-only source (Req 24.2, 31.4)", () => {
  const result = generateWorkflow("OrderProcessing");

  assert.ok(result.contents.length > 0, "generated workflow scaffold must be non-empty");
  assert.ok(
    result.path.endsWith("OrderProcessingWorkflow.ts"),
    `unexpected generated path: ${result.path}`,
  );

  // Imports only the public `@streetjs/workflow` surface.
  assert.match(result.contents, /from "@streetjs\/workflow"/);
  assert.match(result.contents, /import \{ createWorkflow \} from "@streetjs\/workflow"/);
  assert.match(result.contents, /import type \{[^}]*WorkflowContext[^}]*\} from "@streetjs\/workflow"/);

  // Declares the expected exports: the registered-name constant, the imperative
  // Workflow_Function, and the engine factory.
  assert.match(result.contents, /export const ORDER_PROCESSING_WORKFLOW = "order-processing"/);
  assert.match(result.contents, /export async function orderProcessingWorkflow\(/);
  assert.match(result.contents, /export function createOrderProcessingWorkflow\(\): WorkflowEngine/);

  // Must NOT reach past the public entry into internal or pillar modules.
  assert.doesNotMatch(result.contents, /@streetjs\/workflow\/(redis|testing)/);
  assert.doesNotMatch(result.contents, /@streetjs\/(storage|queue|events|realtime)/);
});

test("generateActivity emits well-formed, public-surface-only source (Req 24.2, 31.4)", () => {
  const result = generateActivity("ChargeCard");

  assert.ok(result.contents.length > 0, "generated activity scaffold must be non-empty");
  assert.ok(result.path.endsWith("ChargeCardActivity.ts"), `unexpected generated path: ${result.path}`);

  // Imports only the public `Activity` type from `@streetjs/workflow`.
  assert.match(result.contents, /import type \{ Activity \} from "@streetjs\/workflow"/);

  // Declares a typed Activity export honoring the AbortSignal.
  assert.match(result.contents, /export const chargeCardActivity: Activity<ChargeCardResult>/);
  assert.match(result.contents, /signal: AbortSignal/);

  assert.doesNotMatch(result.contents, /@streetjs\/(storage|queue|events|realtime)/);
});
