// @streetjs/registry-server — storage of published plugin versions.
//
// Each accepted version stores four things together (per the design): the signed
// manifest, the publisher's Ed25519 public key (PEM), the tarball blob, and the
// indexed metadata (name, version, categories, tags, version history). The store
// only ever receives FULLY-VALIDATED versions from the service layer, so a
// rejected publish can never mutate it — previously published valid versions are
// preserved (Req 4.4/4.10).
/**
 * In-memory registry store. Insertion is keyed by `name` then `version`; the
 * service layer guarantees only validated, non-duplicate versions reach `put`.
 */
export class RegistryStore {
    plugins = new Map();
    /** True iff `name@version` already exists (duplicate detection, Req 4.10). */
    hasVersion(name, version) {
        return this.plugins.get(name)?.versions.has(version) ?? false;
    }
    /** Insert a fully-validated version. Indexes categories/tags + version history. */
    put(record, opts = {}) {
        let entry = this.plugins.get(record.name);
        if (!entry) {
            entry = { name: record.name, versions: new Map(), categories: new Set(), tags: new Set() };
            this.plugins.set(record.name, entry);
        }
        entry.versions.set(record.version, record);
        for (const c of opts.categories ?? record.categories)
            entry.categories.add(c);
        for (const t of opts.tags ?? record.tags)
            entry.tags.add(t);
        if (opts.description !== undefined)
            entry.description = opts.description;
    }
    /** Fetch one stored version, or `undefined` if not present. */
    get(name, version) {
        return this.plugins.get(name)?.versions.get(version);
    }
    /** All known plugin names. */
    names() {
        return [...this.plugins.keys()];
    }
    /** Version history for a plugin, sorted ascending by semver-ish order. */
    versions(name) {
        const entry = this.plugins.get(name);
        if (!entry)
            return [];
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
    summary(name) {
        const entry = this.plugins.get(name);
        if (!entry || entry.versions.size === 0)
            return undefined;
        const allVersions = [...entry.versions.keys()].sort(compareVersionStrings);
        return {
            name: entry.name,
            latestVersion: allVersions[allVersions.length - 1],
            description: entry.description,
            categories: [...entry.categories].sort(),
            tags: [...entry.tags].sort(),
            versions: allVersions,
        };
    }
    /** Summaries for every plugin, in stable name order. */
    summaries() {
        return this.names()
            .sort()
            .map((n) => this.summary(n))
            .filter((s) => s !== undefined);
    }
}
/** Numeric-aware comparison of dotted version strings (fallback to string order). */
function compareVersionStrings(a, b) {
    const pa = a.split('.').map((x) => Number.parseInt(x, 10));
    const pb = b.split('.').map((x) => Number.parseInt(x, 10));
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] ?? 0;
        const y = pb[i] ?? 0;
        if (Number.isFinite(x) && Number.isFinite(y) && x !== y)
            return x < y ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}
//# sourceMappingURL=store.js.map