// src/devx/codemods.ts
// Codemod engine powering `street upgrade`. Each codemod is a pure source→source
// transform with a deterministic change count, so upgrades are previewable
// (dry-run) and testable offline. Dependency-free.

export interface CodemodResult {
  code: string;
  changed: boolean;
  changes: number;
}

export interface Codemod {
  id: string;
  description: string;
  apply(source: string): CodemodResult;
}

/** Escape a string for use as a literal inside a RegExp. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a codemod that renames a whole-word identifier (`from` → `to`) wherever
 * it appears as a standalone token. Word boundaries prevent partial matches
 * (e.g. renaming `Foo` won't touch `FooBar`).
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

/** Built-in codemods shipped with the framework, applied in order. */
export const BUILTIN_CODEMODS: Codemod[] = [
  renameIdentifierCodemod(
    'rename-rabbitmq-transport',
    'RabbitMQTransport',
    'RabbitMqTransport',
    'Rename the deprecated RabbitMQTransport alias to the canonical RabbitMqTransport.',
  ),
];

/** List available codemods (id + description). */
export function listCodemods(): Array<{ id: string; description: string }> {
  return BUILTIN_CODEMODS.map((c) => ({ id: c.id, description: c.description }));
}

/** Look up a codemod by id. */
export function getCodemod(id: string): Codemod | undefined {
  return BUILTIN_CODEMODS.find((c) => c.id === id);
}

export interface ApplyCodemodsResult {
  code: string;
  changed: boolean;
  totalChanges: number;
  perCodemod: Record<string, number>;
}

/**
 * Apply codemods to a source string. By default all built-ins run, in order;
 * pass `ids` to select a subset. Unknown ids throw. Returns the transformed
 * code plus a per-codemod change tally.
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
  for (const c of selected) {
    const r = c.apply(code);
    code = r.code;
    perCodemod[c.id] = r.changes;
    totalChanges += r.changes;
  }
  return { code, changed: totalChanges > 0, totalChanges, perCodemod };
}
