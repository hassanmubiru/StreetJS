#!/usr/bin/env node
// scripts/gen-core-compat.mjs
// Generates the @streetjs/core compatibility package (packages/core-compat) from
// the real `streetjs` package's exports map. @streetjs/core is now a thin
// re-export shim of `streetjs`, kept for backward compatibility.
//
// Run: node scripts/gen-core-compat.mjs

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const corePkg = JSON.parse(readFileSync(join(repoRoot, 'packages/core/package.json'), 'utf8'));
const VERSION = corePkg.version;
const outDir = join(repoRoot, 'packages/core-compat');
const distDir = join(outDir, 'dist');

// subpath ("." | "./http" ...) -> stub basename ("index" | "http" ...)
const baseName = (sub) => (sub === '.' ? 'index' : sub.replace(/^\.\//, '').replace(/\//g, '__'));
// subpath -> the `streetjs` specifier to re-export from
const specifier = (sub) => (sub === '.' ? 'streetjs' : `streetjs/${sub.replace(/^\.\//, '')}`);

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const compatExports = {};
const files = ['dist/**/*.js', 'dist/**/*.d.ts', 'README.md'];

for (const sub of Object.keys(corePkg.exports)) {
  const name = baseName(sub);
  const spec = specifier(sub);
  // Pure re-export. No default exports exist in the public entries, so `export *`
  // carries the full named API. Identical surface to importing `streetjs` directly.
  writeFileSync(join(distDir, `${name}.js`), `export * from '${spec}';\n`);
  writeFileSync(join(distDir, `${name}.d.ts`), `export * from '${spec}';\n`);
  compatExports[sub] = {
    // The stub re-exports `streetjs[/sub]`, whose own exports map resolves the
    // browser/import conditions — so one stub serves every condition.
    browser: `./dist/${name}.js`,
    import: `./dist/${name}.js`,
    types: `./dist/${name}.d.ts`,
  };
}

const pkg = {
  name: '@streetjs/core',
  version: VERSION,
  description:
    'DEPRECATED — use `streetjs` instead. Backward-compatibility shim that re-exports the streetjs package.',
  type: 'module',
  main: './dist/index.js',
  types: './dist/index.d.ts',
  exports: compatExports,
  files,
  // Pinned to the exact streetjs version so the surfaces never drift.
  dependencies: { streetjs: VERSION },
  keywords: ['streetjs', 'deprecated', 'compatibility', 'framework'],
  author: 'street contributors',
  license: 'MIT',
  homepage: 'https://hassanmubiru.github.io/street/',
  repository: { type: 'git', url: 'git+https://github.com/hassanmubiru/StreetJS.git' },
  bugs: { url: 'https://github.com/hassanmubiru/StreetJS/issues' },
  engines: { node: '>=20.0.0' },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
};
writeFileSync(join(outDir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

writeFileSync(
  join(outDir, 'README.md'),
  `# @streetjs/core (deprecated)

> **Deprecated.** This package has been renamed to **\`streetjs\`**.
> It now re-exports \`streetjs\` unchanged and is kept only for backward
> compatibility. Please migrate:

\`\`\`diff
- npm install @streetjs/core
+ npm install streetjs
\`\`\`

\`\`\`diff
- import { streetApp } from '@streetjs/core';
+ import { streetApp } from 'streetjs';
\`\`\`

The export surface is identical — every named export and subpath
(\`@streetjs/core/http\`, \`/router\`, \`/database\`, …) maps 1:1 to the same
export in \`streetjs\`. See the migration guide: docs/migration.md.
`
);

console.log(`Generated @streetjs/core compat package (${Object.keys(compatExports).length} subpaths) at ${outDir}`);
