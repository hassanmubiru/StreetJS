#!/usr/bin/env node
// scripts/enterprise/generate-openapi.mjs
// Generates the published OpenAPI specification for the Enterprise Console API
// (Req 6.9) from the built core package, and verifies the generated document
// covers every exposed console operation before writing it.
//
// Output: docs/enterprise-console.openapi.json
//
// Usage: node scripts/enterprise/generate-openapi.mjs
// Requires the core package to be built first (npm --workspace streetjs run build).

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const coreDist = resolve(repoRoot, 'packages', 'core', 'dist', 'enterprise', 'console', 'index.js');
const outPath = resolve(repoRoot, 'docs', 'enterprise-console.openapi.json');

const { consoleOpenApiSpec, CONSOLE_ROUTES } = await import(coreDist);

const spec = consoleOpenApiSpec();

// Coverage check: every exposed console operation must appear in the spec.
const specOps = new Set();
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of Object.keys(item)) {
    specOps.add(`${method.toUpperCase()} ${path}`);
  }
}
const missing = [];
for (const route of CONSOLE_ROUTES) {
  const openApiPath = route.pattern.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, '{$1}');
  const key = `${route.method.toUpperCase()} ${openApiPath}`;
  if (!specOps.has(key)) missing.push(key);
}
if (missing.length > 0) {
  console.error(`OpenAPI generation incomplete — missing operations:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

writeFileSync(outPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
console.log(
  `Generated ${outPath}\n  operations: ${specOps.size}  (covers all ${CONSOLE_ROUTES.length} console routes)`,
);
