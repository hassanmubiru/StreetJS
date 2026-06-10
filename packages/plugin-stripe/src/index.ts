// @streetjs/plugin-stripe
// Official Street Framework plugin for Stripe payments.
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. Request building (bearer auth + form-encoded body) is pure and
// offline-verifiable; the network send uses node:https.

import { StripePlugin, stripePluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  StripePlugin,
  StripeClient,
  stripePluginManifest,
  validateStripeConfig,
  STRIPE_PLUGIN_NAME,
  STRIPE_PLUGIN_VERSION,
} from 'streetjs';
export type { StripePluginConfig, StripeHttpRequest } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = stripePluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default StripePlugin;
