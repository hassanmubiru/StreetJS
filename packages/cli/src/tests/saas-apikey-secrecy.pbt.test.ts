// saas-apikey-secrecy.pbt.test.ts
// Property-based test for the SaaS starter's API key secrecy guarantee.
//
//   Property 4 (API key secrecy): for every created key k, the database stores
//   ONLY a display `prefix` and `SHA256(secret)`; the plaintext is returned
//   exactly once from create() and is unrecoverable from stored data.
//   **Validates: Requirements 5.1**
//
// `ApiKeyService` ships as overlay template content scaffolded into a generated
// project's `src/modules/apikeys/apikey.service.ts` (it is NOT a top-level export
// of create.ts). To exercise the real scaffolded behavior we read the registered
// template string, transpile it to JS, load it as a module, and drive
// `ApiKeyService.create` through an in-memory `ApiKeyRepository` fake. We then
// assert that the persisted row holds only `prefix` + `key_hash = sha256(secret)`
// (never the plaintext or the raw secret), that `create` hands back the plaintext
// exactly once, and that the secret cannot be reconstructed from stored fields.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

/** A persisted API key row (mirrors the overlay's ApiKeyRow). */
interface ApiKeyRow {
  id: string;
  org_id: string;
  created_by: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** The values the service passes to repo.insert (no plaintext/secret here). */
interface InsertValues {
  org_id: string;
  created_by: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: string[];
  expires_at: Date | null;
}

/** Minimal shape of the scaffolded ApiKeyService used by this test. */
interface ApiKeyServiceLike {
  create(
    orgId: string,
    actorId: string,
    input: { name: string; scopes: string[]; expiresAt?: Date },
  ): Promise<{ id: string; plaintext: string }>;
}

type ApiKeyServiceCtor = new (repo: unknown, audit?: unknown, environment?: string) => ApiKeyServiceLike;

/** SHA-256 hex digest — the same one-way transform the overlay stores at rest. */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Extract `src/modules/apikeys/apikey.service.ts` from the saas overlay,
 * transpile it, and load the exported `ApiKeyService`. The module imports only
 * `node:crypto`, so no import rewriting is required.
 */
async function loadApiKeyService(): Promise<{ ApiKeyService: ApiKeyServiceCtor; cleanup: () => void }> {
  const svcFile = TEMPLATES.saas.extraFiles?.find((f) => f.path === 'src/modules/apikeys/apikey.service.ts');
  assert.ok(svcFile, 'saas overlay must register src/modules/apikeys/apikey.service.ts');

  const js = ts.transpileModule(svcFile!.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const dir = mkdtempSync(join(tmpdir(), 'street-apikey-pbt-'));
  const file = join(dir, 'apikey.service.mjs');
  writeFileSync(file, js, 'utf8');
  const mod = await import(pathToFileURL(file).href);
  return {
    ApiKeyService: mod.ApiKeyService as ApiKeyServiceCtor,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * In-memory ApiKeyRepository fake. Captures exactly what the service persists so
 * the test can assert no plaintext/secret ever reaches storage.
 */
class FakeApiKeyRepository {
  public lastInsert: InsertValues | null = null;
  public lastRow: ApiKeyRow | null = null;
  private seq = 0;

  async insert(values: InsertValues): Promise<ApiKeyRow> {
    this.lastInsert = values;
    const row: ApiKeyRow = {
      id: `key_${++this.seq}`,
      org_id: values.org_id,
      created_by: values.created_by,
      name: values.name,
      prefix: values.prefix,
      key_hash: values.key_hash,
      scopes: values.scopes,
      last_used_at: null,
      expires_at: values.expires_at ? values.expires_at.toISOString() : null,
      revoked_at: null,
      created_at: new Date(0).toISOString(),
    };
    this.lastRow = row;
    return row;
  }

  async findByHash(): Promise<ApiKeyRow | null> {
    return null;
  }
  async listByOrg(): Promise<ApiKeyRow[]> {
    return this.lastRow ? [this.lastRow] : [];
  }
  async touchLastUsed(): Promise<void> {}
  async setRevoked(): Promise<void> {}
}

const orgIdArb = fc.stringMatching(/^org_[a-z0-9]{1,6}$/);
const actorIdArb = fc.stringMatching(/^user_[a-z0-9]{1,6}$/);
const nameArb = fc.string({ minLength: 1, maxLength: 24 });
const scopesArb = fc.array(fc.stringMatching(/^[a-z]+:[a-z]+$/), { maxLength: 5 });

describe('Property 4: API key secrecy (ApiKeyService.create) — Validates: Requirements 5.1', () => {
  let ApiKeyService: ApiKeyServiceCtor;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadApiKeyService();
    ApiKeyService = loaded.ApiKeyService;
    cleanup = loaded.cleanup;
    assert.equal(typeof ApiKeyService, 'function', 'ApiKeyService must be importable from the overlay');
  });

  after(() => cleanup());

  it('stores only prefix + SHA256(secret); plaintext returned once and unrecoverable from stored data', async () => {
    await fc.assert(
      fc.asyncProperty(orgIdArb, actorIdArb, nameArb, scopesArb, async (orgId, actorId, name, scopes) => {
        const repo = new FakeApiKeyRepository();
        const svc = new ApiKeyService(repo, undefined, 'test');

        const { id, plaintext } = await svc.create(orgId, actorId, { name, scopes });

        // create() returns the plaintext exactly once, with an id for the row.
        assert.ok(id, 'create must return a row id');
        assert.equal(typeof plaintext, 'string', 'create must return the plaintext string');

        const stored = repo.lastInsert;
        assert.ok(stored, 'create must persist exactly one row');

        // Plaintext is "<prefix>.<secret>"; recover the secret the service hashed.
        const dot = plaintext.indexOf('.');
        assert.ok(dot > 0, 'plaintext must be <prefix>.<secret>');
        const prefixPart = plaintext.slice(0, dot);
        const secret = plaintext.slice(dot + 1);
        assert.ok(secret.length > 0, 'plaintext must carry a non-empty secret');

        // The display prefix is stored verbatim and matches the plaintext prefix.
        assert.equal(stored!.prefix, prefixPart, 'stored prefix must equal the plaintext prefix');

        // The stored hash is SHA256(secret) — never the secret or the plaintext.
        assert.equal(stored!.key_hash, sha256(secret), 'stored key_hash must be SHA256(secret)');
        assert.equal(stored!.key_hash.length, 64, 'SHA-256 hex digest is 64 chars');
        assert.notEqual(stored!.key_hash, secret, 'key_hash must not be the raw secret');
        assert.notEqual(stored!.key_hash, plaintext, 'key_hash must not be the plaintext');

        // Unrecoverable: no persisted field contains the plaintext or the secret.
        const persisted = JSON.stringify(repo.lastRow);
        assert.ok(!persisted.includes(secret), 'stored row must not contain the raw secret');
        assert.ok(!persisted.includes(plaintext), 'stored row must not contain the plaintext');
      }),
      { numRuns: 200 },
    );
  });
});
