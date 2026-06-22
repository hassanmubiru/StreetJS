// src/types/street-saas.d.ts
// Ambient type augmentation for the SaaS starter overlay (overlay code — NOT framework code).
//
// The overlay's middleware and controllers attach request-scoped context that the
// framework's core `StreetContext` does not declare on its own:
//   • ctx.org    — the active organization, set by tenantResolver (full {id, slug, role})
//                  or by apiKeyAuth (id only, for /api/v1 key-authenticated requests).
//   • ctx.scopes — the API-key scopes, set by apiKeyAuth.
//   • ctx.htmx   — the htmx view helpers attached at runtime by @streetjs/plugin-htmx
//                  (HtmxPlugin.middleware in src/main.ts — see SAAS.md wiring).
//
// They are merged into the framework's StreetContext via module augmentation. The
// shapes are kept STRUCTURAL (no plugin import) so the overlay type-checks even
// before the optional htmx/admin-ui plugins are installed.

/** Active organization attached to the request context (full from tenantResolver,
 *  id-only from apiKeyAuth). */
export interface SaasActiveOrg {
  id: string;
  slug?: string;
  role?: 'owner' | 'admin' | 'member';
}

/** Minimal structural shape of the htmx helpers the dashboard overlay consumes. */
export interface SaasHtmxHelpers {
  /** Render a full page/view from a template with the given data. */
  view(template: string, data?: Record<string, unknown>, status?: number): void;
  /** The underlying view engine; `partial` renders a fragment to a string. */
  engine: { partial(template: string, data?: Record<string, unknown>): string };
}

declare module 'streetjs' {
  interface StreetContext {
    /** Active organization resolved by tenantResolver / apiKeyAuth (overlay). */
    org?: SaasActiveOrg;
    /** API-key scopes attached by apiKeyAuth (overlay). */
    scopes?: string[];
    /** htmx view helpers attached by @streetjs/plugin-htmx middleware. */
    htmx: SaasHtmxHelpers;
  }
}
