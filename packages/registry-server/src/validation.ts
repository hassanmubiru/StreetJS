// @streetjs/registry-server — manifest metadata validation (Req 4.5/4.10).
//
// Validates the structural metadata of a `PluginManifest` BEFORE any signature
// or storage work: identity (name), version (semver MAJOR.MINOR.PATCH), declared
// dependencies (name → range map), and declared capabilities (string[]). A
// missing required field or a malformed value yields a field-specific
// INVALID_MANIFEST error so the offending metadata is identified (Req 4.10).

import type { PluginManifest } from 'streetjs';
import type { RegistryError } from './types.js';

const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function err(message: string, field: string): RegistryError {
  return { code: 'INVALID_MANIFEST', message, field };
}

/**
 * Validate manifest metadata. Returns `null` when well-formed, otherwise a
 * field-specific {@link RegistryError}.
 */
export function validateManifestMetadata(manifest: unknown): RegistryError | null {
  if (manifest === null || typeof manifest !== 'object') {
    return err('Manifest must be an object', 'manifest');
  }
  const m = manifest as Record<string, unknown>;

  // Identity / name (required, non-empty string).
  if (typeof m.name !== 'string' || m.name.trim() === '') {
    return err('Manifest "name" is required and must be a non-empty string', 'name');
  }

  // Version (required, semver MAJOR.MINOR.PATCH).
  if (typeof m.version !== 'string' || m.version.trim() === '') {
    return err('Manifest "version" is required and must be a non-empty string', 'version');
  }
  if (!SEMVER_RE.test(m.version.trim())) {
    return err('Manifest "version" must be semver MAJOR.MINOR.PATCH', 'version');
  }

  // Declared capabilities (optional; when present must be string[]).
  if (m.capabilities !== undefined) {
    if (!Array.isArray(m.capabilities) || !m.capabilities.every((c) => typeof c === 'string' && c.trim() !== '')) {
      return err('Manifest "capabilities" must be an array of non-empty strings', 'capabilities');
    }
  }

  // Declared dependencies (optional; when present must be a Record<string,string>).
  if (m.dependencies !== undefined) {
    if (typeof m.dependencies !== 'object' || m.dependencies === null || Array.isArray(m.dependencies)) {
      return err('Manifest "dependencies" must be an object of name → range', 'dependencies');
    }
    for (const [dep, range] of Object.entries(m.dependencies as Record<string, unknown>)) {
      if (dep.trim() === '') {
        return err('Manifest "dependencies" contains an empty dependency name', 'dependencies');
      }
      if (typeof range !== 'string' || range.trim() === '') {
        return err(`Manifest dependency "${dep}" must map to a non-empty version range`, `dependencies.${dep}`);
      }
    }
  }

  // Declared permissions (optional; when present must be string[]).
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions) || !m.permissions.every((p) => typeof p === 'string')) {
      return err('Manifest "permissions" must be an array of strings', 'permissions');
    }
  }

  return null;
}

/** Narrow an already-validated manifest to `PluginManifest`. */
export function asManifest(manifest: unknown): PluginManifest {
  return manifest as PluginManifest;
}
