// scripts/verify-package.mjs
// Shared publish-time tarball integrity guard for every publishable workspace
// package (streetjs, @streetjs/cli, …).
//
// Catches the class of bug where a shipped module imports a file that is NOT
// included in the npm tarball — which makes a clean `import`/CLI run crash with
// ERR_MODULE_NOT_FOUND even though the build succeeded locally (because `dist/`
// has everything but the `files` allow-list ships a subset).
//
// It performs a CLOSED-WORLD consistency check, entirely offline:
//   1. Ask npm for the exact file set that WOULD be published for the package
//      in the current working directory (`npm pack --dry-run --json`).
//   2. For every published `.js` file, statically scan its relative
//      `import`/`export ... from`/dynamic-`import()` specifiers (string and
//      comment regions are masked out so generated code emitted as template
//      literals never produces a false positive).
//   3. Assert every referenced relative module is also in the published set.
//
// Any missing reference fails with a precise list. Run per package via
// `npm run verify:pack -w <package>` (each package's `verify:pack` script calls
// `node ../../scripts/verify-package.mjs`), and it is wired into `prepublishOnly`.
//
// The package is selected by the current working directory, so the same script
// serves every workspace package without modification.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

// The package to inspect is the current working directory (npm sets this to the
// package dir for `npm run -w <package>` and for `prepublishOnly`).
const pkgRoot = process.cwd();

/** Return the list of package-relative paths npm would publish. */
function publishedFiles() {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const parsed = JSON.parse(raw);
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = entry?.files ?? [];
  return files.map((f) => normalize(f.path));
}

// Match relative specifiers in: import ... from '.', export ... from '.',
// and dynamic import('.'). Only relative specifiers (./ or ../) are checked;
// bare specifiers (deps like `streetjs`) are resolved by Node from node_modules
// at install time and are out of scope for a tarball-completeness check.
const SPECIFIER_RE =
  /(?:import|export)\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/**
 * Build a byte mask over `src` where 1 marks a position inside a string
 * literal, template literal, or comment. Used to discard `import`-looking text
 * that appears INSIDE a string (e.g. deployment scaffolding emitted as template
 * literals) — only `import`/`export` keywords in real code positions count.
 */
function buildMask(src) {
  const n = src.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') mask[i++] = 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      mask[i++] = 1;
      mask[i++] = 1;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) mask[i++] = 1;
      if (i < n) mask[i++] = 1;
      if (i < n) mask[i++] = 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      mask[i++] = 1; // opening quote
      while (i < n) {
        if (src[i] === '\\') {
          mask[i++] = 1;
          if (i < n) mask[i++] = 1;
          continue;
        }
        const done = src[i] === quote;
        mask[i++] = 1; // body char (and the closing quote)
        if (done) break;
      }
      continue;
    }
    i++;
  }
  return mask;
}

/** Resolve a relative specifier from `fromFile` to a published-set candidate path. */
function resolveSpecifier(fromFile, spec) {
  const base = resolve(pkgRoot, dirname(fromFile), spec);
  const rel = normalize(relative(pkgRoot, base));
  // Explicit-extension imports (the convention in this codebase).
  if (/\.[cm]?js$/.test(rel)) return [rel];
  // Fall back to extensionless / directory-index resolution.
  return [`${rel}.js`, join(rel, 'index.js')];
}

function main() {
  const pkgName = (() => {
    try {
      return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).name ?? pkgRoot;
    } catch {
      return pkgRoot;
    }
  })();

  const published = new Set(publishedFiles());
  const jsFiles = [...published].filter((p) => p.endsWith('.js'));

  if (jsFiles.length === 0) {
    console.error(`verify-package(${pkgName}): no .js files in the publish set — did you build first?`);
    process.exit(1);
  }

  const missing = [];
  for (const file of jsFiles) {
    let source;
    try {
      source = readFileSync(resolve(pkgRoot, file), 'utf8');
    } catch {
      continue; // listed but unreadable; pack would have surfaced this already
    }
    const mask = buildMask(source);
    for (const m of source.matchAll(SPECIFIER_RE)) {
      // Skip matches whose import/export keyword sits inside a string or comment
      // (e.g. generated code emitted as a template literal) — not a real import.
      if (mask[m.index]) continue;
      const spec = m[1] ?? m[2];
      if (!spec) continue;
      const candidates = resolveSpecifier(file, spec);
      if (!candidates.some((c) => published.has(c))) {
        missing.push({ file, spec, candidates });
      }
    }
  }

  if (missing.length > 0) {
    console.error(
      `\n✗ verify-package(${pkgName}): ${missing.length} import(s) reference files NOT included in the npm tarball:\n`,
    );
    for (const { file, spec, candidates } of missing) {
      console.error(`  ${file}`);
      console.error(`      imports "${spec}" → expected one of: ${candidates.join(', ')}`);
    }
    console.error(
      '\nFix the "files" allow-list in package.json so every referenced module ships,\n' +
        'or remove the offending export from the public surface.\n',
    );
    process.exit(1);
  }

  console.log(
    `✓ verify-package(${pkgName}): all ${jsFiles.length} published modules resolve within the tarball ` +
      `(${published.size} files total).`,
  );
}

main();
