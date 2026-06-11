// scripts/verify-package.mjs
// Publish-time tarball integrity guard.
//
// Catches the class of bug where the root barrel (or any shipped module) imports
// a file that is NOT included in the npm tarball — which makes a clean
// `import('streetjs')` crash with ERR_MODULE_NOT_FOUND even though the build
// succeeded locally (because `dist/` has everything but `files` ships a subset).
//
// It performs a CLOSED-WORLD consistency check, entirely offline:
//   1. Ask npm for the exact file set that WOULD be published
//      (`npm pack --dry-run --json`).
//   2. For every published `.js` file, statically scan its relative
//      `import`/`export ... from`/dynamic-`import()` specifiers.
//   3. Assert every referenced relative module is also in the published set.
//
// Any missing reference fails the build with a precise list, so a broken tarball
// can never be published. Run via `npm run verify:pack` (wired into
// `prepublishOnly`).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const pkgRoot = resolve(dirname(new URL(import.meta.url).pathname), '..');

/** Return the list of repo-relative paths npm would publish. */
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
// bare specifiers (deps) are resolved by Node from node_modules at install time.
const SPECIFIER_RE =
  /(?:import|export)\b[^'"]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|import\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;

/**
 * Blank out comments and string/template literals so the import scanner only
 * sees real top-level `import`/`export` statements — never `import` text that
 * appears inside a string (e.g. generated deployment scaffolding emitted by
 * `cloud/deployment.js`). Replaces literal/comment bodies with spaces to keep
 * offsets and line structure intact.
 */
function stripStringsAndComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    const next = src[i + 1];
    // Line comment
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      i += 2;
      continue;
    }
    // String / template literal
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i++;
          break;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i++;
      }
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
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
  const published = new Set(publishedFiles());
  const jsFiles = [...published].filter((p) => p.endsWith('.js'));

  if (jsFiles.length === 0) {
    console.error('verify-package: no .js files in the publish set — did you build first?');
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
    for (const m of source.matchAll(SPECIFIER_RE)) {
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
      `\n✗ verify-package: ${missing.length} import(s) reference files NOT included in the npm tarball:\n`,
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
    `✓ verify-package: all ${jsFiles.length} published modules resolve within the tarball ` +
      `(${published.size} files total).`,
  );
}

main();
