// Generate buildable source for the deprecated @streetjs/core shim: one re-export
// file per subpath it declares in `exports`, each forwarding to the matching
// `streetjs/<subpath>`. Makes the shim cold-buildable in the workspace so the
// whole monorepo is reproducible. Run once; sources are then committed.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = 'packages/core-compat';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const subpaths = Object.keys(pkg.exports); // ".", "./http", ...
mkdirSync(join(root, 'src'), { recursive: true });

for (const sp of subpaths) {
  const name = sp === '.' ? 'index' : sp.replace(/^\.\//, '');
  const target = sp === '.' ? 'streetjs' : `streetjs/${name}`;
  const file = join(root, 'src', `${name}.ts`);
  writeFileSync(file,
    `// @streetjs/core (DEPRECATED) — re-exports streetjs${sp === '.' ? '' : '/' + name}.\n` +
    `// Use \`${target}\` directly instead.\n` +
    `export * from '${target}';\n`);
}
console.log(`generated ${subpaths.length} re-export source files in ${root}/src`);
