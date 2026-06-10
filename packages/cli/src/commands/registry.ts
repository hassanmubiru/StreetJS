// packages/cli/src/commands/registry.ts
// `street registry publish|install|search|list` — drive the Network Plugin
// Registry service (@streetjs/registry-server) over its `/api/v1` REST API.
//
//   street registry publish   --manifest <path> --tarball <path> --key <pem>
//                             [--token <apiKey>] [--public-key <pem>]
//                             [--categories a,b] [--tags a,b] [--description "…"]
//   street registry install   <name>[@<version>] [--out <dir>]
//   street registry search    [query] [--category <c>] [--tag <t>]
//                             [--page <n>] [--page-size <n>]
//   street registry list       [--page <n>] [--page-size <n>]
//
// The registry base URL comes from `--registry`, else `STREET_REGISTRY_URL`,
// else `http://localhost:8787`. Publish authenticates with a bearer token
// (`--token` or `STREET_REGISTRY_TOKEN`). Manifest signing and download-time
// integrity verification reuse the core signing primitives (signManifest,
// verifyManifest, manifestChecksum) so the CLI and the registry agree,
// byte-for-byte, on what a valid signed manifest is (Req 4.2/4.3).
//
// _Design: Components → Network Plugin Registry (CLI + guides). Requirements: 4.1, 4.7_

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import type { CliContext } from '../index.js';

/** Shape of the structured error every registry endpoint returns on rejection. */
interface RegistryErrorBody {
  error?: { code?: string; message?: string; field?: string };
}

export class RegistryCommand {
  async execute(ctx: CliContext): Promise<void> {
    const sub = ctx.args.positional[0];
    switch (sub) {
      case 'publish':
        await this.publish(ctx);
        break;
      case 'install':
        await this.install(ctx);
        break;
      case 'search':
        await this.search(ctx);
        break;
      case 'list':
        await this.list(ctx);
        break;
      default:
        this.printUsage();
        process.exitCode = 1;
    }
  }

  // ── publish ────────────────────────────────────────────────────────────────
  private async publish(ctx: CliContext): Promise<void> {
    const manifestPath = this.flag(ctx, 'manifest');
    const tarballPath = this.flag(ctx, 'tarball');
    const keyPath = this.flag(ctx, 'key');
    const token = this.flag(ctx, 'token') ?? process.env['STREET_REGISTRY_TOKEN'];

    if (!manifestPath || !tarballPath || !keyPath) {
      console.error('[street] Usage: street registry publish --manifest <path> --tarball <path> --key <private-key.pem> [--token <apiKey>]');
      process.exitCode = 1;
      return;
    }
    if (!token) {
      console.error('[street] A publisher bearer token is required (use --token or STREET_REGISTRY_TOKEN).');
      process.exitCode = 1;
      return;
    }

    const core = await import('streetjs');

    // Load + sign the manifest with the publisher's Ed25519 private key.
    let manifest: import('streetjs').PluginManifest;
    let signed: import('streetjs').PluginManifest;
    let publicKeyPem: string;
    let tarballBase64: string;
    try {
      manifest = JSON.parse(await readFile(resolve(ctx.cwd, manifestPath), 'utf8'));
      const privatePem = await readFile(resolve(ctx.cwd, keyPath), 'utf8');
      const privateKey = createPrivateKey(privatePem);
      signed = core.signManifest(manifest, privateKey);

      // The public key is either supplied explicitly or derived from the private key.
      const pubPath = this.flag(ctx, 'public-key');
      publicKeyPem = pubPath
        ? await readFile(resolve(ctx.cwd, pubPath), 'utf8')
        : createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();

      const tarball = await readFile(resolve(ctx.cwd, tarballPath));
      tarballBase64 = tarball.toString('base64');
    } catch (err) {
      console.error(`[street] Failed to prepare publish payload: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }

    const body = {
      manifest: signed,
      publicKeyPem,
      tarballBase64,
      categories: this.csv(this.flag(ctx, 'categories')),
      tags: this.csv(this.flag(ctx, 'tags')),
      description: this.flag(ctx, 'description'),
    };

    const url = `${this.apiBase(ctx)}/plugins`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error(`[street] Could not reach the registry at ${url}: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }

    const json = (await res.json().catch(() => ({}))) as RegistryErrorBody & {
      name?: string;
      version?: string;
      tarballChecksum?: string;
      publishedAt?: string;
    };

    if (!res.ok) {
      const e = json.error;
      console.error(`[street] Publish rejected (${res.status}): ${e?.code ?? 'ERROR'} — ${e?.message ?? 'unknown error'}${e?.field ? ` [field: ${e.field}]` : ''}`);
      process.exitCode = 1;
      return;
    }

    console.log(`[street] Published ${json.name}@${json.version}`);
    console.log(`[street]   tarball checksum: ${json.tarballChecksum}`);
    console.log(`[street]   published at:     ${json.publishedAt}`);
  }

  // ── install ──────────────────────────────────────────────────────────────
  private async install(ctx: CliContext): Promise<void> {
    const spec = ctx.args.positional[1];
    if (!spec) {
      console.error('[street] Usage: street registry install <name>[@<version>] [--out <dir>]');
      process.exitCode = 1;
      return;
    }
    const atIdx = spec.lastIndexOf('@');
    // A leading '@' (scoped name) is not a version separator.
    const hasVersion = atIdx > 0;
    const name = hasVersion ? spec.slice(0, atIdx) : spec;
    let version = hasVersion ? spec.slice(atIdx + 1) : (this.flag(ctx, 'version') ?? 'latest');

    const core = await import('streetjs');
    const apiBase = this.apiBase(ctx);

    // Resolve "latest" by inspecting the published version history.
    if (version === 'latest') {
      const resolved = await this.resolveLatest(apiBase, name);
      if (!resolved) {
        console.error(`[street] No published versions found for "${name}".`);
        process.exitCode = 1;
        return;
      }
      version = resolved;
    }

    const url = `${apiBase}/plugins/${this.encodeName(name)}/${encodeURIComponent(version)}/download`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      console.error(`[street] Could not reach the registry at ${url}: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }

    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as RegistryErrorBody;
      console.error(`[street] Install failed (${res.status}): ${json.error?.code ?? 'ERROR'} — ${json.error?.message ?? 'unknown error'}`);
      process.exitCode = 1;
      return;
    }

    const pkg = (await res.json()) as {
      name: string;
      version: string;
      manifest: import('streetjs').PluginManifest;
      publicKeyPem: string;
      tarballBase64: string;
      tarballChecksum: string;
    };

    // Consumer-side integrity validation before writing anything (Req 4.3):
    //  1. manifest checksum matches its canonical body,
    //  2. Ed25519 signature verifies against the recorded public key,
    //  3. tarball bytes hash to the recorded checksum.
    let publicKey;
    try {
      publicKey = createPublicKey(pkg.publicKeyPem);
    } catch (err) {
      console.error(`[street] Install failed: recorded public key is invalid: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }
    const checksumOk = pkg.manifest.checksum === core.manifestChecksum(pkg.manifest);
    const signatureOk = core.verifyManifest(pkg.manifest, publicKey);
    const tarball = Buffer.from(pkg.tarballBase64, 'base64');
    const tarballOk = createHash('sha256').update(tarball).digest('hex') === pkg.tarballChecksum;

    if (!checksumOk || !signatureOk || !tarballOk) {
      console.error('[street] Install aborted: integrity verification failed.');
      console.error(`[street]   manifest checksum: ${checksumOk ? 'ok' : 'FAILED'}`);
      console.error(`[street]   signature:         ${signatureOk ? 'ok' : 'FAILED'}`);
      console.error(`[street]   tarball checksum:  ${tarballOk ? 'ok' : 'FAILED'}`);
      process.exitCode = 1;
      return;
    }

    // Write the verified package into the install directory.
    const outDir = resolve(ctx.cwd, this.flag(ctx, 'out') ?? join('plugins', this.safeDir(pkg.name)));
    try {
      await mkdir(outDir, { recursive: true });
      await writeFile(join(outDir, 'manifest.json'), JSON.stringify(pkg.manifest, null, 2));
      await writeFile(join(outDir, 'package.tgz'), tarball);
    } catch (err) {
      console.error(`[street] Install failed writing to ${outDir}: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }

    console.log(`[street] Installed ${pkg.name}@${pkg.version} (signature + checksum verified)`);
    console.log(`[street]   location: ${outDir}`);
  }

  // ── search ──────────────────────────────────────────────────────────────
  private async search(ctx: CliContext): Promise<void> {
    const q = ctx.args.positional[1];
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    const category = this.flag(ctx, 'category');
    const tag = this.flag(ctx, 'tag');
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    this.appendPaging(ctx, params);

    const url = `${this.apiBase(ctx)}/plugins/search?${params.toString()}`;
    await this.fetchAndPrintSummaries(url, 'search');
  }

  // ── list ──────────────────────────────────────────────────────────────
  private async list(ctx: CliContext): Promise<void> {
    const params = new URLSearchParams();
    this.appendPaging(ctx, params);
    const qs = params.toString();
    const url = `${this.apiBase(ctx)}/plugins${qs ? `?${qs}` : ''}`;
    await this.fetchAndPrintSummaries(url, 'list');
  }

  // ── shared helpers ────────────────────────────────────────────────────────
  private async fetchAndPrintSummaries(url: string, label: string): Promise<void> {
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      console.error(`[street] Could not reach the registry at ${url}: ${this.msg(err)}`);
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as RegistryErrorBody;
      console.error(`[street] ${label} failed (${res.status}): ${json.error?.message ?? 'unknown error'}`);
      process.exitCode = 1;
      return;
    }
    const page = (await res.json()) as {
      items: Array<{ name: string; latestVersion: string; description?: string; categories: string[]; tags: string[] }>;
      page: number;
      pageSize: number;
      total: number;
    };

    if (page.items.length === 0) {
      console.log('[street] No plugins found.');
      return;
    }
    console.log(`\n  Plugins (page ${page.page}, ${page.items.length} of ${page.total})\n`);
    for (const it of page.items) {
      console.log(`  ${it.name.padEnd(28)} ${it.latestVersion.padEnd(10)} ${it.description ?? ''}`);
      if (it.categories.length || it.tags.length) {
        console.log(`  ${''.padEnd(28)} ${''.padEnd(10)} categories: [${it.categories.join(', ')}] tags: [${it.tags.join(', ')}]`);
      }
    }
    console.log('');
  }

  private async resolveLatest(apiBase: string, name: string): Promise<string | undefined> {
    const url = `${apiBase}/plugins/${this.encodeName(name)}/versions`;
    try {
      const res = await fetch(url);
      if (!res.ok) return undefined;
      const versions = (await res.json()) as Array<{ version: string }>;
      if (!Array.isArray(versions) || versions.length === 0) return undefined;
      return versions.map((v) => v.version).sort(compareSemver).at(-1);
    } catch {
      return undefined;
    }
  }

  private apiBase(ctx: CliContext): string {
    const base = this.flag(ctx, 'registry') ?? process.env['STREET_REGISTRY_URL'] ?? 'http://localhost:8787';
    return `${base.replace(/\/+$/, '')}/api/v1`;
  }

  /** Encode a (possibly scoped) plugin name path-segment-by-segment, keeping the `/`. */
  private encodeName(name: string): string {
    return name.split('/').map(encodeURIComponent).join('/');
  }

  private appendPaging(ctx: CliContext, params: URLSearchParams): void {
    const page = this.flag(ctx, 'page');
    const pageSize = this.flag(ctx, 'page-size');
    if (page) params.set('page', page);
    if (pageSize) params.set('pageSize', pageSize);
  }

  private flag(ctx: CliContext, name: string): string | undefined {
    const v = ctx.args.flags[name];
    return typeof v === 'string' ? v : undefined;
  }

  private csv(value: string | undefined): string[] | undefined {
    if (!value) return undefined;
    return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  private safeDir(name: string): string {
    return name.replace(/^@/, '').replace(/\//g, '__');
  }

  private msg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }

  private printUsage(): void {
    console.error(`[street] Usage:
  street registry publish --manifest <path> --tarball <path> --key <private-key.pem> [--token <apiKey>]
  street registry install <name>[@<version>] [--out <dir>]
  street registry search [query] [--category <c>] [--tag <t>] [--page <n>] [--page-size <n>]
  street registry list [--page <n>] [--page-size <n>]

Global:
  --registry <url>   Registry base URL (default: $STREET_REGISTRY_URL or http://localhost:8787)`);
  }
}

/** Compare two MAJOR.MINOR.PATCH[-pre] versions; numeric core ordering, releases > prereleases. */
function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i]! - pb.core[i]!;
  }
  // A release (no prerelease) outranks a prerelease of the same core.
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === '') return 1;
  if (pb.pre === '') return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

function parseSemver(v: string): { core: number[]; pre: string } {
  const [coreAndPre] = v.split('+');
  const [core, pre = ''] = coreAndPre!.split('-');
  const parts = core!.split('.').map((n) => Number.parseInt(n, 10) || 0);
  return { core: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre };
}
