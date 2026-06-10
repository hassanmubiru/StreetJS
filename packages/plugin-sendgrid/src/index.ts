// @streetjs/plugin-sendgrid
// Official Street Framework plugin for SendGrid v3 email.
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. Request building (endpoint, bearer auth, JSON body) is pure and
// offline-verifiable; the network send uses node:https.

import { SendGridPlugin, sendGridPluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  SendGridPlugin,
  SendGridClient,
  sendGridPluginManifest,
  validateSendGridConfig,
  SENDGRID_PLUGIN_NAME,
  SENDGRID_PLUGIN_VERSION,
} from 'streetjs';
export type { SendGridPluginConfig, MailMessage, SendGridRequest } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = sendGridPluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default SendGridPlugin;
