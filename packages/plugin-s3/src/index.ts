// @streetjs/plugin-s3
// Official Street Framework plugin for AWS S3 object storage.
//
// The plugin class extends `PluginModule` (the core SDK) and is the canonical,
// dependency-free reference implementation shipped from `streetjs`. This package
// repackages it as a standalone, registry-publishable unit with its own signed
// manifest. AWS SigV4 request signing is deterministic and offline-verifiable;
// the network transport is handled by the framework's S3 storage adapter.

import { S3Plugin, s3PluginManifest } from 'streetjs';
import type { PluginManifest } from 'streetjs';

export {
  S3Plugin,
  s3PluginManifest,
  validateS3Config,
  S3_PLUGIN_NAME,
  S3_PLUGIN_VERSION,
} from 'streetjs';
export type { S3PluginConfig } from 'streetjs';

/** The unsigned plugin manifest (sign with `signManifest` / `npm run sign`). */
export const manifest: PluginManifest = s3PluginManifest();

/** The PluginModule subclass that the host registers and loads. */
export default S3Plugin;
