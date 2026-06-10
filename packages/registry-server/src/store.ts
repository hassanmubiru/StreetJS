// @streetjs/registry-server — storage of published plugin versions.
//
// Each accepted version stores four things together (per the design): the signed
// manifest, the publisher's Ed25519 public key (PEM), the tarball blob, and the
// indexed metadata (name, version, categories, tags, version history). The store
// only ever receives FULLY-VALIDATED versions from the service layer, so a
// rejected publish can never mutate it — previously published valid versions are
// preserved (Req 4.4/4.10).

import type { PluginManifest } from 'streetjs';
import type { PluginSummary, PluginVersion } from './types.js';

/** A single stored version: everything needed to serve download/verify. */
export interface StoredVersion {
  name: string;
  version: string;
  manifest: PluginManifest;
  publicKeyPem: string;
  /** Raw tarball bytes. */
  tarball: Buffer;
  /** SHA-256 hex of `tarball` recorded at publish time. */
  tarballChecksum: string;
  categories: string[];
  tags: string[];
  publishedAt: string;
}

/** All versions of one plugin, keyed by version string. */
interface PluginEntry {
  name: string;
  versions: Map<string, StoredVersion>;
  categories: Set<string>;
  tags: Set<string>;
  description?: string;
}

/**
 * In-memory registry store. Insertion is keyed by `name` then `version`; the
 * service layer guarantees only validated, non-duplicate versions reach `put`.
 */
export class RegistryStore {
  private readonly plugins = new Map<string, PluginEntry>();

  /** True iff `name@version` already exists (duplicate detection, Req 4.10). */
  hasVersion(name: string, version: string): boolean {
    return this.plugins.get(name)?.versions.has(version) ?? true
      ? (this.plugins.get(name)?.versions.has(version) ?? false)
      : false;
  }

  /** Insert a fully-validated version. Indexes categories/tags + version history. */
  put(record: StoredVersion, opts: { categories?: string[]; tags?: string[]; description?: string } = {}): void {
    let entry = this.plugins.get(record.name);
    if (!entry) {
      entry = { name: record.name, versions: new Map(), categories: new Set(), tags: new Set() };
      this.plugins.set(record.name, entry);
    }
    entry.versions.set(record.version, record);
    for (const c of opts.categories ?? record.categories) entry.categories.add(c);
    for (const t of opts.tags ?? record.tags) entry.tags.add(t);
    if (opts.description !== undefined) entry.description = opts.description;
  }

  /** Fetch one stored version, or `undefined` if not present. */
  get(name: string, version: string): StoredVersion | undefined {
    return this.plugins.get(name)?.versions.get(version);
  }

  /** All known plugin names. */
  names(): string[] {
    return [...this.plugins.keys()];
  }

  /** Version history for a plugin, sorted ascending by semver-ish order. */
  versions(name: string): PluginVersion[] {
    const entry = this.plugins.get(name);
    if (!entry) return [];
    return [...entry.versions.values()]
      .sort((a, b) => compareVersionStrings(a.version, b.version))
      .map((v) => ({
        name: v.name,
        version: v.version,
        capabilities: [...(v.manifest.capabilities ?? [])],
        dependencies: { ...(v.manifest.dependencies ?? {}) },
        tarballChecksum: v.tarballChecksum,
        publishedAt: v.publishedAt,
      }));
  }

  /** A condensed summary for one plugin (latest version + indexed metadata). */
  summary(name: string): PluginSummary | undefined {
    const entry = this.plugins.get(name);
    if (!entry || entry.versions.size === 0) return undefined;
    const allVersions = [...entry.versions.keys()].sort(compareVersionStrings);
    return {
      name: entry.name,
      latestVersion: allVersions[allVersions.length - 1]!,
      description: entry.description,
      categories: [...entry.categories].sort(),
      tags: [...entry.tags].sort(),
      versions: allVersions,
    };
  }

  /** Summaries for every plugin, in stable name order. */
  summaries(): PluginSummary[] {
    return this.names()
      .sort()
      .map((n) => this.summary(n))
      .filter((s): s is PluginSummary => s !== undefined);
  }
}

/** Numeric-aware comparison of dotted version strings (fallback to string order). */
function compareVersionStrings(a: string, b: string): number {
  const pa = a.split('.').map((x) => Number.parseInt(x, 10));
  const pb = b.split('.').map((x) => Number.parseInt(x, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isFinite(x) && Number.isFinite(y) && x !== y) return x < y ? -1 : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}
