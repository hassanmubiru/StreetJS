// @streetjs/plugin-twilio
// Official Street Framework plugin for Twilio SMS.
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. The request building (HTTP Basic auth + form body) is pure and
// offline-verifiable; the network send uses node:https.

import { TwilioPlugin, twilioPluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  TwilioPlugin,
  TwilioClient,
  twilioPluginManifest,
  validateTwilioConfig,
  TWILIO_PLUGIN_NAME,
  TWILIO_PLUGIN_VERSION,
} from 'streetjs';
export type { TwilioPluginConfig, TwilioHttpRequest, SmsMessage } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = twilioPluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default TwilioPlugin;
