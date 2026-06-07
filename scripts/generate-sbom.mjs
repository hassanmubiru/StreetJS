#!/usr/bin/env node
// scripts/generate-sbom.mjs
// Generates a CycloneDX 1.5 SBOM for the published @streetjs packages by walking
// their production dependency trees from node_modules. Zero third-party deps.
//
// Usage: node scripts/generate-sbom.mjs [outFile]   (default: sbom.json)

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2] ?? join(repoRoot, 'sbom.json');

function readPkg(dir) {
  const p = join(dir, 'package.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

/** Resolve an installed dependency's package.json by walking up node_modules. */
function resolveDep(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const components = new Map(); // purl -> component

function walk(pkgDir) {
  const pkg = readPkg(pkgDir);
  if (!pkg) return;
  const deps = { ...(pkg.dependencies ?? {}) };
  for (const name of Object.keys(deps)) {
    const depDir = resolveDep(name, pkgDir);
    if (!depDir) continue;
    const dp = readPkg(depDir);
    if (!dp) continue;
    const purl = `pkg:npm/${encodeURIComponent(dp.name)}@${dp.version}`;
    if (components.has(purl)) continue;
    components.set(purl, {
      type: 'library',
      'bom-ref': purl,
      name: dp.name,
      version: dp.version,
      purl,
      ...(dp.license ? { licenses: [{ license: { id: String(dp.license) } }] } : {}),
    });
    walk(depDir); // transitive
  }
}

// Roots: the three workspace packages.
const roots = ['packages/core', 'packages/cli', 'packages/edge'].map((p) => join(repoRoot, p));
const rootPkgs = roots.map(readPkg).filter(Boolean);
for (const dir of roots) walk(dir);

const corePkg = readPkg(join(repoRoot, 'packages/core'));
const serialNumber = `urn:uuid:${randomUUID()}`;
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [{ vendor: 'streetjs', name: 'generate-sbom', version: '1.0.0' }],
    component: {
      type: 'application',
      name: corePkg?.name ?? '@streetjs/core',
      version: corePkg?.version ?? '0.0.0',
    },
  },
  components: [...components.values()].sort((a, b) => a.purl.localeCompare(b.purl)),
};

const json = JSON.stringify(sbom, null, 2);
writeFileSync(outFile, json);
const digest = createHash('sha256').update(json).digest('hex');
console.log(`SBOM written: ${outFile}`);
console.log(`Components: ${sbom.components.length}`);
console.log(`Roots: ${rootPkgs.map((p) => `${p.name}@${p.version}`).join(', ')}`);
console.log(`sha256: ${digest}`);
