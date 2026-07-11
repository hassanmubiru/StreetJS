// packages/cli/src/env.ts
// Dependency-free `.env` loader for the `street` CLI.
//
// The scaffolds ship a `.env.example` and instruct users to copy it to `.env`,
// and the generated app reads `process.env`. Historically the CLI never loaded
// `.env`, so a user's `.env` was silently ignored (JWT_SECRET/SESSION_KEY unset,
// DB config missing) — a real first-run friction. This loader is applied once at
// CLI startup so `street dev`/`start`/`migrate:run`/etc. all see the project's
// `.env`.
//
// Precedence: a variable already present in `process.env` (real shell/CI env)
// ALWAYS wins — `.env` only fills what is absent (standard dotenv behavior).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Parse `.env` file contents into key/value pairs. Supports:
 *   KEY=value
 *   KEY="quoted value"   / KEY='quoted value'
 *   optional leading `export `
 *   `#` comments (whole-line and trailing on unquoted values)
 *   blank lines
 * Values keep internal spaces; surrounding quotes are stripped.
 */
export function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // strip an unquoted trailing comment
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `<dir>/<file>` (default `.env`) into `process.env`, without overriding
 * variables already present. Returns the number of variables applied. A missing
 * file is a no-op (returns 0).
 */
export function loadEnvFile(dir: string, file = '.env'): number {
  const path = resolve(dir, file);
  if (!existsSync(path)) return 0;
  let applied = 0;
  try {
    const parsed = parseEnv(readFileSync(path, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) {
      if (process.env[k] === undefined) {
        process.env[k] = v;
        applied++;
      }
    }
  } catch {
    // A malformed .env must not crash the CLI; leave process.env as-is.
    return applied;
  }
  return applied;
}
