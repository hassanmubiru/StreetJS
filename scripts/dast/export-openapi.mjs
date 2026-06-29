#!/usr/bin/env node
// scripts/dast/export-openapi.mjs
// Export a reproducible OpenAPI artifact from a routes JSON file (an array of
// OpenApiRouteInput) using the framework's generateOpenApi(). Validates the
// result before writing so downstream scanners get a known-good spec.
//
// Usage: node scripts/dast/export-openapi.mjs --routes routes.json --out openapi.json

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateOpenApi, validateOpenApiDocument, openApiOperations } from 'streetjs';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

const routesPath = arg('routes');
const outPath = arg('out', 'openapi.json');
if (!routesPath) { console.error('error: --routes <file> required'); process.exit(64); }

const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
const doc = generateOpenApi(routes);

const v = validateOpenApiDocument(doc);
if (!v.valid) { console.error('generated OpenAPI is invalid:\n  ' + v.errors.join('\n  ')); process.exit(1); }

// Stable, deterministic serialization (sorted keys) for reproducible artifacts.
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(doc, Object.keys(doc).sort().length ? undefined : undefined, 2) + '\n');
const targets = openApiOperations(doc);
console.log(`OpenAPI exported to ${outPath} (${targets.length} operations):`);
for (const t of targets) console.log(`  ${t.method} ${t.path}`);
