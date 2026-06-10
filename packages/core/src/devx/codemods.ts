// src/devx/codemods.ts
// Codemod engine powering `street upgrade`. Each codemod is a pure source→source
// transform with a deterministic change count, so upgrades are previewable
// (dry-run) and testable offline. Dependency-free (Node core only).
//
// Two contracts hold for every codemod:
//   • Idempotence (Req 8.6): applying a codemod to its own output is a
//     byte-for-byte no-op. Whole-word renames give this for free — the second
//     pass finds zero remaining `from` tokens.
//   • Safe-on-failure (Req 8.7): a codemod that cannot parse its input, or whose
//     transform would conflict, leaves the source untouched and reports the
//     reason via `CodemodResult.skipped` instead of producing a partial/garbled
//     edit.

export interface CodemodResult {
  code: string;
  changed: boolean;
  changes: number;
  /** Present iff the codemod declined to transform the source. When set, `code`
   *  equals the original input byte-for-byte and `changed` is false (Req 8.7). */
  skipped?: { reason: string };
}

/** The migration area a codemod belongs to (mirrors `BreakingArea`). */
export type CodemodArea = 'routing' | 'middleware' | 'plugin-api';

export interface Codemod {
  id: string;
  description: string;
  /** Migration area, when the codemod targets a specific breaking-change area. */
  area?: CodemodArea;
  apply(source: string): CodemodResult;
}

/** Escape a string for use as a literal inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word match test for an identifier token. */
function containsIdentifier(source: string, name: string): boolean {
  return new RegExp(`\\b${escapeRe(name)}\\b`).test(source);
}

/**
 * Lightweight, dependency-free lexical balance check. Returns `null` when the
 * source is well-formed enough to transform, or a human-readable reason when it
 * is not (unterminated string/template/comment, or mismatched/unbalanced
 * brackets). This is intentionally conservative: it understands JS/TS string,
 * template-literal (including `${…}` interpolation), and comment lexing so that
 * brackets appearing inside those contexts are not miscounted. It is a guard,
 * not a parser — it never rewrites code, it only decides whether a transform is
 * safe to attempt (Req 8.7).
 */
function findParseObstruction(src: string): string | null {
  const n = src.length;
  // Stack of open code-bracket contexts. 'interp' marks a `${` opened inside a
  // template literal, whose matching `}` returns us to template-text scanning.
  type Frame = 'paren' | 'square' | 'brace' | 'interp' | 'template';
  const stack: Frame[] = [];
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];

    // ── Inside a template literal's text region ──
    if (top === 'template') {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { stack.pop(); i += 1; continue; }
      if (c === '$' && src[i + 1] === '{') { stack.push('interp'); i += 2; continue; }
      i += 1;
      continue;
    }

    // ── Code context (root, (), [], {}, or inside ${…}) ──
    const c = src[i];

    // Line comment.
    if (c === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    // Block comment.
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) return 'unterminated block comment';
      i = end + 2;
      continue;
    }
    // String literal.
    if (c === '"' || c === "'") {
      i += 1;
      let closed = false;
      while (i < n) {
        const ch = src[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === c) { i += 1; closed = true; break; }
        if (ch === '\n') return 'unterminated string literal';
        i += 1;
      }
      if (!closed) return 'unterminated string literal';
      continue;
    }
    // Template literal start.
    if (c === '`') { stack.push('template'); i += 1; continue; }

    // Brackets.
    if (c === '(') { stack.push('paren'); i += 1; continue; }
    if (c === '[') { stack.push('square'); i += 1; continue; }
    if (c === '{') { stack.push('brace'); i += 1; continue; }
    if (c === ')') {
      if (top !== 'paren') return "unbalanced bracket: unexpected ')'";
      stack.pop(); i += 1; continue;
    }
    if (c === ']') {
      if (top !== 'square') return "unbalanced bracket: unexpected ']'";
      stack.pop(); i += 1; continue;
    }
    if (c === '}') {
      if (top === 'brace' || top === 'interp') { stack.pop(); i += 1; continue; }
      return "unbalanced bracket: unexpected '}'";
    }

    i += 1;
  }

  if (stack.length > 0) {
    const top = stack[stack.length - 1];
    if (top === 'template') return 'unterminated template literal';
    if (top === 'interp') return 'unterminated template-literal interpolation';
    return 'unbalanced brackets: source ends with unclosed grouping';
  }
  return null;
}

/**
 * Build a codemod that renames a whole-word identifier (`from` → `to`) wherever
 * it appears as a standalone token. Word boundaries prevent partial matches
 * (e.g. renaming `Foo` won't touch `FooBar`).
 *
 * This is the original, guard-free factory retained for the built-in renames.
 */
export function renameIdentifierCodemod(id: string, from: string, to: string, description: string): Codemod {
  const re = new RegExp(`\\b${escapeRe(from)}\\b`, 'g');
  return {
    id,
    description,
    apply(source: string): CodemodResult {
      let changes = 0;
      const code = source.replace(re, () => { changes++; return to; });
      return { code, changed: changes > 0, changes };
    },
  };
}

/**
 * Build a *safe* whole-word rename codemod for a migration area. Compared with
 * `renameIdentifierCodemod`, it adds the Req 8.7 guards before touching source:
 *
 *   1. Parseability — if the source has an unterminated string/template/comment
 *      or unbalanced brackets, the file is left unchanged and the reason is
 *      reported. (We never emit a partial edit into an unparseable file.)
 *   2. Conflict — if BOTH the old name and the new name already occur as
 *      standalone tokens, renaming would collapse two distinct identifiers into
 *      one. The file is left unchanged and the conflict is reported.
 *
 * Idempotence (Req 8.6) follows from the whole-word rename: a re-run finds no
 * `from` tokens (only `to`), so the conflict guard does not trigger and zero
 * changes are made — byte-for-byte identical output.
 */
export function safeRenameCodemod(
  id: string,
  from: string,
  to: string,
  area: CodemodArea,
  description: string,
): Codemod {
  const re = new RegExp(`\\b${escapeRe(from)}\\b`, 'g');
  return {
    id,
    description,
    area,
    apply(source: string): CodemodResult {
      const obstruction = findParseObstruction(source);
      if (obstruction) {
        return { code: source, changed: false, changes: 0, skipped: { reason: `cannot parse source: ${obstruction}` } };
      }
      const hasFrom = containsIdentifier(source, from);
      // Nothing to do (already migrated or never present): a clean no-op.
      if (!hasFrom) return { code: source, changed: false, changes: 0 };

      if (containsIdentifier(source, to)) {
        return {
          code: source,
          changed: false,
          changes: 0,
          skipped: { reason: `conflict: target identifier "${to}" already present; renaming "${from}" would merge two distinct symbols` },
        };
      }

      let changes = 0;
      const code = source.replace(re, () => { changes++; return to; });
      return { code, changed: changes > 0, changes };
    },
  };
}

// ── Migration codemods by area (Req 8.5) ─────────────────────────────────────

/** Routing-area migrations. */
export const ROUTING_CODEMODS: Codemod[] = [
  safeRenameCodemod(
    'rename-router-context',
    'RouterContext',
    'RouteContext',
    'routing',
    'Rename the routing handler context type RouterContext to the canonical RouteContext.',
  ),
  safeRenameCodemod(
    'rename-route-handler-type',
    'RouteHandlerFn',
    'RouteHandler',
    'routing',
    'Rename the deprecated RouteHandlerFn type alias to RouteHandler.',
  ),
];

/** Middleware-area migrations. */
export const MIDDLEWARE_CODEMODS: Codemod[] = [
  safeRenameCodemod(
    'rename-middleware-next',
    'MiddlewareNext',
    'NextFunction',
    'middleware',
    'Rename the MiddlewareNext callback type to the canonical NextFunction.',
  ),
  safeRenameCodemod(
    'rename-use-middleware',
    'useMiddleware',
    'use',
    'middleware',
    'Rename the deprecated app.useMiddleware registration method to app.use.',
  ),
];

/** Plugin-API-area migrations. */
export const PLUGIN_API_CODEMODS: Codemod[] = [
  safeRenameCodemod(
    'rename-plugin-register',
    'registerPlugin',
    'usePlugin',
    'plugin-api',
    'Rename the deprecated registerPlugin host method to usePlugin.',
  ),
  safeRenameCodemod(
    'rename-plugin-context',
    'PluginContext',
    'PluginHost',
    'plugin-api',
    'Rename the PluginContext type to the canonical PluginHost.',
  ),
];

/** Built-in codemods shipped with the framework, applied in order. */
export const BUILTIN_CODEMODS: Codemod[] = [
  renameIdentifierCodemod(
    'rename-rabbitmq-transport',
    'RabbitMQTransport',
    'RabbitMqTransport',
    'Rename the deprecated RabbitMQTransport alias to the canonical RabbitMqTransport.',
  ),
];

/** Every registered codemod, across all areas. Order is stable: built-ins,
 *  then routing, middleware, and plugin-API migrations. */
export const ALL_CODEMODS: Codemod[] = [
  ...BUILTIN_CODEMODS,
  ...ROUTING_CODEMODS,
  ...MIDDLEWARE_CODEMODS,
  ...PLUGIN_API_CODEMODS,
];

/** List available codemods (id + description + optional area). */
export function listCodemods(): Array<{ id: string; description: string; area?: CodemodArea }> {
  return ALL_CODEMODS.map((c) => ({ id: c.id, description: c.description, ...(c.area ? { area: c.area } : {}) }));
}

/** Look up a codemod by id across every registered area. */
export function getCodemod(id: string): Codemod | undefined {
  return ALL_CODEMODS.find((c) => c.id === id);
}

export interface ApplyCodemodsResult {
  code: string;
  changed: boolean;
  totalChanges: number;
  perCodemod: Record<string, number>;
  /** Reasons for any codemods that declined to transform the source (Req 8.7).
   *  Keyed by codemod id; empty when every codemod ran without obstruction. */
  skipped: Record<string, string>;
}

/**
 * Apply codemods to a source string. By default the built-ins run, in order;
 * pass `ids` to select a subset (drawn from any registered area). Unknown ids
 * throw. A codemod that declines to transform (unparseable/conflicting source)
 * contributes zero changes and records its reason under `skipped` — the source
 * carried forward is the unchanged input (Req 8.7).
 */
export function applyCodemods(source: string, ids?: string[]): ApplyCodemodsResult {
  const selected = ids
    ? ids.map((id) => {
        const c = getCodemod(id);
        if (!c) throw new Error(`Unknown codemod: "${id}"`);
        return c;
      })
    : BUILTIN_CODEMODS;

  let code = source;
  let totalChanges = 0;
  const perCodemod: Record<string, number> = {};
  const skipped: Record<string, string> = {};
  for (const c of selected) {
    const r = c.apply(code);
    // A skipped codemod leaves `code` unchanged; do not adopt a partial edit.
    if (r.skipped) {
      skipped[c.id] = r.skipped.reason;
      perCodemod[c.id] = 0;
      continue;
    }
    code = r.code;
    perCodemod[c.id] = r.changes;
    totalChanges += r.changes;
  }
  return { code, changed: totalChanges > 0, totalChanges, perCodemod, skipped };
}
