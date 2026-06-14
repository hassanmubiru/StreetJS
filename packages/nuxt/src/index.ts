// @streetjs/nuxt — Nuxt 3 integration for StreetJS. Re-exports the Vue
// composables from @streetjs/vue and adds a Nuxt plugin factory that provides a
// StreetJS client to the whole app. Consumes @streetjs/client only, never core
// internals (RFC 0002). Vue is a peer dependency; Nuxt is not imported directly
// (we avoid a hard @nuxt/kit dependency) — the factory works against the minimal
// Nuxt plugin surface so it stays compatible without coupling to Nuxt internals.

import type { App } from 'vue';
import {
  installStreetClient,
  type StreetClient,
  type StreetClientConfig,
} from '@streetjs/vue';

/** Minimal shape of the object Nuxt passes to a plugin (`nuxtApp`). */
export interface NuxtAppLike {
  vueApp: App;
  provide?: (name: string, value: unknown) => void;
}

/** A Nuxt plugin function: receives `nuxtApp`, returns optionally injected values. */
export type NuxtPlugin = (nuxtApp: NuxtAppLike) => void | { provide?: Record<string, unknown> };

/**
 * Build a Nuxt plugin that installs a StreetJS client on the app. Wrap the
 * result with Nuxt's `defineNuxtPlugin` in your `plugins/streetjs.ts`:
 *
 * ```ts
 * import { defineNuxtPlugin } from '#app';
 * import { createStreetNuxtPlugin } from '@streetjs/nuxt';
 * export default defineNuxtPlugin(createStreetNuxtPlugin({ baseUrl: '/api' }));
 * ```
 *
 * The client is also exposed via `nuxtApp.$street` for non-composable access.
 */
export function createStreetNuxtPlugin(
  clientOrConfig: StreetClient | StreetClientConfig,
): NuxtPlugin {
  return (nuxtApp: NuxtAppLike) => {
    const client = installStreetClient(nuxtApp.vueApp, clientOrConfig);
    return { provide: { street: client } };
  };
}

// Re-export the full Vue composable surface so Nuxt users import from one place.
export {
  provideStreetClient,
  installStreetClient,
  useApi,
  useQuery,
  useSession,
  useAuth,
  useSearch,
  useRealtime,
  useChannel,
  useAI,
  createStreetClient,
} from '@streetjs/vue';
export type {
  QueryComposable,
  StreetClient,
  StreetClientConfig,
} from '@streetjs/vue';
