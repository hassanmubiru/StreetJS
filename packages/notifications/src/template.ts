// src/template.ts
// Pure {{variable}} template rendering + in-memory stores. No I/O.

import type { NotificationTemplate, TemplateStore } from './types.js';

/**
 * Render a template string, replacing `{{ key }}` (and dotted `{{ a.b }}`)
 * placeholders with values from `data`. Missing/undefined values render as the
 * empty string. Values are coerced with `String(...)`; objects are JSON-encoded.
 * This is intentionally logic-free (no conditionals/loops) so it is safe and
 * deterministic — richer templating belongs in a dedicated engine.
 */
export function renderTemplate(template: string, data: Record<string, unknown> = {}): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = resolvePath(data, path);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function resolvePath(data: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** In-memory {@link TemplateStore}. */
export class InMemoryTemplateStore implements TemplateStore {
  private readonly templates = new Map<string, NotificationTemplate>();

  constructor(initial: Record<string, NotificationTemplate> = {}) {
    for (const [id, tpl] of Object.entries(initial)) this.templates.set(id, tpl);
  }

  set(id: string, template: NotificationTemplate): this {
    this.templates.set(id, template);
    return this;
  }

  get(id: string): NotificationTemplate | undefined {
    return this.templates.get(id);
  }
}
