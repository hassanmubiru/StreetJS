// @streetjs/plugin-htmx — HTMX request detection + response-header helpers.
// All functions are pure: they read/return plain header objects, so they're
// trivially unit-testable and framework-agnostic.

import { escapeHtml } from './view-engine.js';

export type HeaderBag = Record<string, string | string[] | undefined>;

function header(headers: HeaderBag, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

/** True when the request was issued by HTMX (the `HX-Request: true` header). */
export function isHtmxRequest(headers: HeaderBag): boolean {
  return (header(headers, 'HX-Request') ?? '').toLowerCase() === 'true';
}

/** True for an HTMX history-restore (no-cache) request. */
export function isHtmxHistoryRestore(headers: HeaderBag): boolean {
  return (header(headers, 'HX-History-Restore-Request') ?? '').toLowerCase() === 'true';
}

/** The element id that triggered the request (HX-Trigger), if any. */
export function htmxTriggerId(headers: HeaderBag): string | undefined {
  return header(headers, 'HX-Trigger');
}

/** The user's current URL (HX-Current-URL), if present. */
export function htmxCurrentUrl(headers: HeaderBag): string | undefined {
  return header(headers, 'HX-Current-URL');
}

export interface HxResponseInit {
  /** Client-side redirect (full navigation) — HX-Redirect. */
  redirect?: string;
  /** Client-side redirect without a full reload — HX-Location. */
  location?: string;
  /** Push a new URL into history — HX-Push-Url (string) or false to disable. */
  pushUrl?: string | false;
  /** Replace the current URL — HX-Replace-Url. */
  replaceUrl?: string;
  /** Force a full client refresh — HX-Refresh. */
  refresh?: boolean;
  /** Retarget the swap to a different element — HX-Retarget (CSS selector). */
  retarget?: string;
  /** Change the swap style — HX-Reswap (e.g. "beforeend"). */
  reswap?: string;
  /** Reselect part of the response — HX-Reselect (CSS selector). */
  reselect?: string;
  /** Trigger client events — HX-Trigger. String, array, or name→detail map. */
  trigger?: string | string[] | Record<string, unknown>;
  /** Trigger events after the settle step — HX-Trigger-After-Settle. */
  triggerAfterSettle?: string | string[] | Record<string, unknown>;
  /** Trigger events after the swap step — HX-Trigger-After-Swap. */
  triggerAfterSwap?: string | string[] | Record<string, unknown>;
}

function triggerValue(t: NonNullable<HxResponseInit['trigger']>): string {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.join(', ');
  return JSON.stringify(t);
}

/** Build the HX-* response headers for an HtmxResponseInit. Pure. */
export function hxHeaders(init: HxResponseInit): Record<string, string> {
  const h: Record<string, string> = {};
  if (init.redirect != null) h['HX-Redirect'] = init.redirect;
  if (init.location != null) h['HX-Location'] = init.location;
  if (init.pushUrl != null) h['HX-Push-Url'] = init.pushUrl === false ? 'false' : init.pushUrl;
  if (init.replaceUrl != null) h['HX-Replace-Url'] = init.replaceUrl;
  if (init.refresh) h['HX-Refresh'] = 'true';
  if (init.retarget != null) h['HX-Retarget'] = init.retarget;
  if (init.reswap != null) h['HX-Reswap'] = init.reswap;
  if (init.reselect != null) h['HX-Reselect'] = init.reselect;
  if (init.trigger != null) h['HX-Trigger'] = triggerValue(init.trigger);
  if (init.triggerAfterSettle != null) h['HX-Trigger-After-Settle'] = triggerValue(init.triggerAfterSettle);
  if (init.triggerAfterSwap != null) h['HX-Trigger-After-Swap'] = triggerValue(init.triggerAfterSwap);
  return h;
}

/**
 * A hidden CSRF form field. Pass the token from the StreetJS session/CSRF layer.
 * The field name defaults to "_csrf" (override to match your CSRF middleware).
 */
export function csrfField(token: string, fieldName = '_csrf'): string {
  return `<input type="hidden" name="${escapeHtml(fieldName)}" value="${escapeHtml(token)}">`;
}
