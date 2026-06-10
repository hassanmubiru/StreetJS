// src/platform/plugins/host.ts
// Formal plugin system for Street: a local plugin host that handles
// registration, capability/permission metadata, dependency + version-constraint
// resolution, lifecycle orchestration (install/enable/disable/remove), discovery,
// and offline manifest integrity + Ed25519 signature verification.
//
// Built only on node:crypto — no third-party dependencies and no network. The
// network-based fetch/extract flow lives in registry.ts; this module is the
// in-process host that everything else (CLI, registry installer) drives.

import { createHash, verify as cryptoVerify, sign as cryptoSign, type KeyLike } from 'node:crypto';
import type { MiddlewareFn } from '../../core/types.js';
import { PluginModule, type SandboxedApp } from './sdk.js';

// ── Manifest & metadata ─────────────────────────────────────────────────────

/** Permissions a plugin may request; the host grants a subset. */
export type PluginPermission = 'middleware' | 'events' | 'net' | 'fs' | 'db' | 'secrets';

export interface PluginManifest {
  name: string;
  version: string;
  /** Free-form capability tags used for discovery (e.g. 'payments', 'email'). */
  capabilities?: string[];
  /** Permissions the plugin needs to load; must be a subset of granted. */
  permissions?: PluginPermission[];
  /** Other plugins this one depends on: name → semver range. */
  dependencies?: Record<string, string>;
  /** SHA-256 hex of the canonical manifest body (integrity). */
  checksum?: string;
  /** Base64 Ed25519 signature over the checksum (authenticity). */
  signature?: string;
}

export class PluginError extends Error {}
export class PluginPermissionError extends PluginError {}
export class PluginDependencyError extends PluginError {}
export class PluginSignatureError extends PluginError {}
export class PluginStateError extends PluginError {}
/** Thrown when a plugin manifest is missing or malformed during installation. */
export class PluginManifestError extends PluginError {}

// ── Minimal semver ──────────────────────────────────────────────────────────

interface SemVer { major: number; minor: number; patch: number; }

/** Parse "1.2.3" (ignoring any "-prerelease"/"+build" suffix). */
export function parseSemver(v: string): SemVer {
  const core = v.trim().replace(/^v/, '').split(/[-+]/)[0]!;
  const [maj, min, pat] = core.split('.');
  const n = (x: string | undefined): number => {
    const r = Number.parseInt(x ?? '0', 10);
    return Number.isFinite(r) ? r : 0;
  };
  return { major: n(maj), minor: n(min), patch: n(pat) };
}

/** Compare two versions: -1 if a<b, 0 if equal, 1 if a>b. */
export function compareSemver(a: string, b: string): number {
  const x = parseSemver(a), y = parseSemver(b);
  if (x.major !== y.major) return x.major < y.major ? -1 : 1;
  if (x.minor !== y.minor) return x.minor < y.minor ? -1 : 1;
  if (x.patch !== y.patch) return x.patch < y.patch ? -1 : 1;
  return 0;
}

/**
 * Does `version` satisfy `range`? Supports: '' / '*' (any), exact ("1.2.3"),
 * caret ("^1.2.3"), tilde ("~1.2.3"), and comparators (>=, >, <=, <).
 */
export function satisfiesVersion(version: string, range: string): boolean {
  const r = range.trim();
  if (r === '' || r === '*' || r === 'x') return true;

  const ge = (v: string, base: string): boolean => compareSemver(v, base) >= 0;
  const lt = (v: string, base: string): boolean => compareSemver(v, base) < 0;

  if (r.startsWith('^')) {
    const b = parseSemver(r.slice(1));
    let upper: string;
    if (b.major > 0) upper = `${b.major + 1}.0.0`;
    else if (b.minor > 0) upper = `0.${b.minor + 1}.0`;
    else upper = `0.0.${b.patch + 1}`;
    return ge(version, r.slice(1)) && lt(version, upper);
  }
  if (r.startsWith('~')) {
    const b = parseSemver(r.slice(1));
    const upper = `${b.major}.${b.minor + 1}.0`;
    return ge(version, r.slice(1)) && lt(version, upper);
  }
  if (r.startsWith('>=')) return compareSemver(version, r.slice(2).trim()) >= 0;
  if (r.startsWith('<=')) return compareSemver(version, r.slice(2).trim()) <= 0;
  if (r.startsWith('>')) return compareSemver(version, r.slice(1).trim()) > 0;
  if (r.startsWith('<')) return compareSemver(version, r.slice(1).trim()) < 0;
  return compareSemver(version, r) === 0;
}

// ── Manifest integrity & signing ──────────────────────────────────────────────

/** Deterministic, key-sorted JSON of the signable manifest body (excludes checksum/signature). */
function canonicalManifest(m: PluginManifest): string {
  const body = {
    name: m.name,
    version: m.version,
    capabilities: [...(m.capabilities ?? [])].sort(),
    permissions: [...(m.permissions ?? [])].sort(),
    dependencies: Object.fromEntries(Object.entries(m.dependencies ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
  return JSON.stringify(body);
}

/** Compute the SHA-256 hex checksum of a manifest's canonical body. */
export function manifestChecksum(m: PluginManifest): string {
  return createHash('sha256').update(canonicalManifest(m)).digest('hex');
}

/** Sign a manifest with an Ed25519 private key; returns a manifest with checksum + signature set. */
export function signManifest(m: PluginManifest, privateKey: KeyLike): PluginManifest {
  const checksum = manifestChecksum(m);
  const signature = cryptoSign(null, Buffer.from(checksum, 'utf8'), privateKey).toString('base64');
  return { ...m, checksum, signature };
}

/**
 * Verify a manifest's integrity (checksum matches body) and authenticity
 * (Ed25519 signature over the checksum verifies against `publicKey`). Returns
 * true only if both hold. With no signature/publicKey, only integrity is checked.
 */
export function verifyManifest(m: PluginManifest, publicKey?: KeyLike): boolean {
  const expected = manifestChecksum(m);
  if (m.checksum !== undefined && m.checksum !== expected) return false;
  if (publicKey) {
    if (!m.signature) return false;
    try {
      return cryptoVerify(
        null,
        Buffer.from(expected, 'utf8'),
        publicKey,
        Buffer.from(m.signature, 'base64'),
      );
    } catch {
      return false;
    }
  }
  return true;
}

// ── Plugin host ────────────────────────────────────────────────────────────

export type PluginState = 'registered' | 'enabled' | 'disabled';

interface PluginEntry {
  plugin: PluginModule;
  manifest: PluginManifest;
  state: PluginState;
  installed: boolean;
}

/** A SandboxedApp whose capabilities are gated by the plugin's granted permissions. */
class GatedSandbox implements SandboxedApp {
  readonly middlewares: MiddlewareFn[] = [];
  readonly listeners: Array<{ event: string; handler: (...args: unknown[]) => void }> = [];
  constructor(private readonly perms: Set<PluginPermission>, private readonly pluginName: string) {}

  use(middleware: MiddlewareFn): void {
    if (!this.perms.has('middleware')) {
      throw new PluginPermissionError(`Plugin "${this.pluginName}" lacks 'middleware' permission`);
    }
    this.middlewares.push(middleware);
  }
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.perms.has('events')) {
      throw new PluginPermissionError(`Plugin "${this.pluginName}" lacks 'events' permission`);
    }
    this.listeners.push({ event, handler });
  }
}

export interface PluginHostOptions {
  /** Permissions the host grants. '*' grants all. Default: none (plugins needing perms fail). */
  grantedPermissions?: PluginPermission[] | '*';
  /** Public key for verifying signed manifests. When set, registration requires a valid signature. */
  publicKey?: KeyLike;
}

const ALL_PERMS: PluginPermission[] = ['middleware', 'events', 'net', 'fs', 'db', 'secrets'];

/**
 * In-process plugin host. Register plugins with manifests, then enable them —
 * the host validates signatures (if configured), dependency presence + version
 * constraints, and permission grants, and drives lifecycle hooks in dependency
 * order. Disabling/removing respects reverse dependency order.
 */
export class PluginHost {
  private readonly entries = new Map<string, PluginEntry>();
  private readonly sandboxes = new Map<string, GatedSandbox>();
  private readonly granted: Set<PluginPermission>;
  private readonly publicKey: KeyLike | undefined;

  constructor(opts: PluginHostOptions = {}) {
    this.granted = new Set(opts.grantedPermissions === '*' ? ALL_PERMS : (opts.grantedPermissions ?? []));
    this.publicKey = opts.publicKey;
  }

  /** Register a plugin + manifest. Validates name/version match and signature (if a public key is set). */
  register(plugin: PluginModule, manifest: PluginManifest): void {
    if (manifest.name !== plugin.name || manifest.version !== plugin.version) {
      throw new PluginError(`Manifest (${manifest.name}@${manifest.version}) does not match plugin (${plugin.name}@${plugin.version})`);
    }
    if (this.entries.has(plugin.name)) {
      throw new PluginStateError(`Plugin "${plugin.name}" is already registered`);
    }
    if (this.publicKey && !verifyManifest(manifest, this.publicKey)) {
      throw new PluginSignatureError(`Plugin "${plugin.name}" failed manifest signature verification`);
    }
    this.entries.set(plugin.name, { plugin, manifest, state: 'registered', installed: false });
  }

  /**
   * Whether this host enforces manifest signature verification. True when the
   * host was constructed with a trusted `publicKey`, in which case `register()`
   * rejects any plugin whose manifest signature does not validate.
   */
  verifiesSignatures(): boolean { return this.publicKey !== undefined; }

  /** Discovery: all registered plugin names. */
  list(): string[] { return [...this.entries.keys()]; }
  has(name: string): boolean { return this.entries.has(name); }
  state(name: string): PluginState | undefined { return this.entries.get(name)?.state; }
  manifestOf(name: string): PluginManifest | undefined { return this.entries.get(name)?.manifest; }

  /** Discovery: registered plugins exposing a given capability tag. */
  findByCapability(capability: string): string[] {
    return [...this.entries.entries()]
      .filter(([, e]) => (e.manifest.capabilities ?? []).includes(capability))
      .map(([name]) => name);
  }

  /** Middlewares contributed by an enabled plugin (in registration order). */
  middlewaresOf(name: string): MiddlewareFn[] {
    return this.sandboxes.get(name)?.middlewares ?? [];
  }

  /**
   * Enable a plugin: verify permissions, ensure all dependencies are registered
   * and version-compatible and enabled (auto-enabling them first, in dependency
   * order), then run onInstall (once) and onLoad against a gated sandbox.
   */
  async enable(name: string): Promise<void> {
    await this._enable(name, new Set());
  }

  private async _enable(name: string, visiting: Set<string>): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new PluginDependencyError(`Plugin "${name}" is not registered`);
    if (entry.state === 'enabled') return;
    if (visiting.has(name)) {
      throw new PluginDependencyError(`Circular plugin dependency detected at "${name}"`);
    }
    visiting.add(name);

    // Permission check.
    for (const perm of entry.manifest.permissions ?? []) {
      if (!this.granted.has(perm)) {
        throw new PluginPermissionError(`Plugin "${name}" requires ungranted permission "${perm}"`);
      }
    }

    // Dependency resolution + version constraints (enable deps first).
    for (const [dep, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      const depEntry = this.entries.get(dep);
      if (!depEntry) throw new PluginDependencyError(`Plugin "${name}" depends on missing plugin "${dep}"`);
      if (!satisfiesVersion(depEntry.manifest.version, range)) {
        throw new PluginDependencyError(
          `Plugin "${name}" requires "${dep}@${range}" but ${dep}@${depEntry.manifest.version} is registered`,
        );
      }
      await this._enable(dep, visiting);
    }

    const sandbox = new GatedSandbox(new Set(entry.manifest.permissions ?? []), name);
    this.sandboxes.set(name, sandbox);

    if (!entry.installed) {
      if (entry.plugin.onInstall) await entry.plugin.onInstall();
      entry.installed = true;
    }
    if (entry.plugin.onLoad) await entry.plugin.onLoad(sandbox);
    entry.state = 'enabled';
    visiting.delete(name);
  }

  /** Disable a plugin. Fails if an enabled plugin still depends on it. */
  async disable(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) throw new PluginDependencyError(`Plugin "${name}" is not registered`);
    if (entry.state !== 'enabled') return;
    const dependents = this._enabledDependentsOf(name);
    if (dependents.length > 0) {
      throw new PluginDependencyError(`Cannot disable "${name}": still required by ${dependents.join(', ')}`);
    }
    const sandbox = this.sandboxes.get(name);
    if (entry.plugin.onUnload && sandbox) await entry.plugin.onUnload(sandbox);
    this.sandboxes.delete(name);
    entry.state = 'disabled';
  }

  /** Remove a plugin from the host. Must be disabled (or never enabled) first. */
  async remove(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.state === 'enabled') {
      throw new PluginStateError(`Cannot remove enabled plugin "${name}"; disable it first`);
    }
    this.entries.delete(name);
    this.sandboxes.delete(name);
  }

  private _enabledDependentsOf(name: string): string[] {
    return [...this.entries.entries()]
      .filter(([other, e]) => other !== name
        && e.state === 'enabled'
        && Object.keys(e.manifest.dependencies ?? {}).includes(name))
      .map(([other]) => other);
  }
}
