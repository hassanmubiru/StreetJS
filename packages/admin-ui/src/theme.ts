// Shared, dependency-free UI primitives + theming for @streetjs/admin-ui.
// CSS-variable driven with built-in dark mode; no CSS-in-JS runtime.

import { createElement, type ReactNode } from 'react';

export type ClassNames = Record<string, string | undefined>;

/** createElement alias to keep component code terse and JSX-free. */
export const h = createElement;

export const streetAdminCss = `
.street-admin {
  --st-bg: #ffffff; --st-fg: #111827; --st-muted: #6b7280;
  --st-border: #e5e7eb; --st-accent: #2563eb; --st-accent-fg: #ffffff;
  --st-row: #f9fafb; --st-radius: 8px;
  color: var(--st-fg); background: var(--st-bg); font-family: system-ui, sans-serif;
  border: 1px solid var(--st-border); border-radius: var(--st-radius); padding: 12px;
}
@media (prefers-color-scheme: dark) {
  .street-admin:not([data-theme="light"]) {
    --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af; --st-border: #374151;
    --st-accent: #3b82f6; --st-row: #111827;
  }
}
.street-admin[data-theme="dark"] {
  --st-bg: #0b1220; --st-fg: #f3f4f6; --st-muted: #9ca3af; --st-border: #374151;
  --st-accent: #3b82f6; --st-row: #111827;
}
.street-admin table { width: 100%; border-collapse: collapse; font-size: 14px; }
.street-admin th, .street-admin td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--st-border); }
.street-admin tbody tr:nth-child(odd) { background: var(--st-row); }
.street-admin caption { text-align: left; font-weight: 600; padding: 4px 0 10px; }
.street-admin select, .street-admin button { padding: 6px 10px; border: 1px solid var(--st-border);
  border-radius: var(--st-radius); background: var(--st-bg); color: var(--st-fg); font-size: 14px; }
.street-admin button { background: var(--st-accent); color: var(--st-accent-fg); border: none; cursor: pointer; }
.street-admin button:disabled { opacity: .6; cursor: not-allowed; }
.street-admin .st-muted { color: var(--st-muted); font-size: 13px; }
.street-admin .st-badge { display: inline-block; padding: 2px 8px; border-radius: 999px;
  background: var(--st-row); border: 1px solid var(--st-border); font-size: 12px; margin: 0 4px 4px 0; }
`;

/** Injects the default stylesheet once. Optional — consumers may supply their own CSS. */
export function StreetAdminStyles(): ReactNode {
  return h('style', { 'data-street-admin-styles': '' }, streetAdminCss);
}

/** Generic loading / error / empty wrapper shared by the table views. */
export function AsyncState(props: { loading: boolean; error?: unknown; empty: boolean; emptyText?: string; children: ReactNode }): ReactNode {
  if (props.loading) return h('p', { className: 'st-muted', role: 'status' }, 'Loading…');
  if (props.error) {
    const msg = props.error instanceof Error ? props.error.message : String(props.error);
    return h('p', { role: 'alert', style: { color: 'crimson' } }, msg);
  }
  if (props.empty) return h('p', { className: 'st-muted' }, props.emptyText ?? 'Nothing to show.');
  return props.children as ReactNode;
}
