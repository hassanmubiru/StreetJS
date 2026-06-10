// @streetjs/plugin-auth0
// Official Street Framework plugin for Auth0 identity (OAuth2 client-credentials).
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. Request building (OAuth2 token endpoint, JSON body) is pure and
// offline-verifiable; the network send uses node:https.

import { Auth0Plugin, auth0PluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  Auth0Plugin,
  Auth0Client,
  auth0PluginManifest,
  validateAuth0Config,
  AUTH0_PLUGIN_NAME,
  AUTH0_PLUGIN_VERSION,
} from 'streetjs';
export type { Auth0PluginConfig, Auth0HttpRequest } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = auth0PluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default Auth0Plugin;
