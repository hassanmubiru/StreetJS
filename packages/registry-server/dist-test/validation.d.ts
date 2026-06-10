import type { PluginManifest } from 'streetjs';
import type { RegistryError } from './types.js';
/**
 * Validate manifest metadata. Returns `null` when well-formed, otherwise a
 * field-specific {@link RegistryError}.
 */
export declare function validateManifestMetadata(manifest: unknown): RegistryError | null;
/** Narrow an already-validated manifest to `PluginManifest`. */
export declare function asManifest(manifest: unknown): PluginManifest;
//# sourceMappingURL=validation.d.ts.map