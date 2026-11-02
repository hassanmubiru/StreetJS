// saas-apikey-revocation.pbt.test.ts
// Property-based test for the SaaS starter overlay's API-key revocation/expiry
// gate (Property 6).
//
//   **Property 6: Revocation and expiry** — any key with `revoked_at` set or
//   `expires_at < now()` yields 401; otherwise the key authenticates.
//
//   **Validates: Requirements 5.3, 5.4, 5.5**
//
// The API-key logic is NOT a top-level runtime export of create.ts — it is
// shipped as overlay TEMPLATE STRINGS in `TEMPLATES.saas.extraFiles`
// (`src/modules/apikeys/apikey.service.ts` and `src/middleware/apiKeyAuth.ts`).
// To drive the property through the *real* scaffolded code (rather than a
// re-implementation), this test extracts those template strings, transpiles them
// with the bundled TypeScript compiler, substitutes a tiny stub for the
// `streetjs` exception classes they import, and dynamically imports the result.
// The 401 contract is exercised through the real `apiKeyAuth` middleware, whose
// stubbed `UnauthorizedException` carries `status = 401` to mirror the
// framework's documented behaviour.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

type Scope = string;

/** A persisted API key row (mirrors the overlay's ApiKeyRow). */
interface ApiKeyRow {
  id: string;
  org_id: string;
  created_by: string;
  name: string;
  prefix: string;
  key_hash: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** The persistence contract the real ApiKeyService constructor expects. */
interface ApiKeyRepository {
  insert(values: {
    org_id: string;
    created_by: string;
    name: string;
    prefix: string;
    key_hash: string;
    scopes: Scope[];
    expires_at: Date | null;
  }): Promise<ApiKeyRow>;
  findByHash(keyHash: string): Promise<ApiKeyRow | null>;
  listByOrg(orgId: string): Promise<ApiKeyRow[]>;
  touchLastUsed(id: string, when: Date): Promise<void>;
  setRevoked(orgId: string, keyId: string, when: Date): Promise<void>;
}

interface ApiKeyServiceLike {
  verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null>;
  revoke(orgId: string, actorId: string, keyId: string): Promise<void>;
}

/** Minimal request context shape consumed by the real apiKeyAuth middleware. */
interface TestCtx {
  headers: Record<string, string | undefined>;
  org?: { id: string };
  scopes?: Scope[];
}

type ApiKeyServiceCtor = new (
  repo: ApiKeyRepository,
  audit?: unknown,
  environment?: string,
) => ApiKeyServiceLike;
type ApiKeyAuthMiddleware = (ctx: TestCtx, next: () => Promise<void>) => Promise<void>;
type ApiKeyAuthFactory = (
  deps: { keys: ApiKeyServiceLike },
  options?: { requiredScopes?: Scope[] },
) => ApiKeyAuthMiddleware;

// The stub standing in for `streetjs`'s exception classes. UnauthorizedException
// carries status 401 to mirror the framework contract the overlay relies on.
const STREETJS_STUB = `
export class StreetException extends Error {
  constructor(status, message) { super(message); this.status = status; this.name = 'StreetException'; }
}
export class ForbiddenException extends Error {
  constructor(message = 'Forbidden') { super(message); this.status = 403; this.name = 'ForbiddenException'; }
}
export class UnauthorizedException extends Error {
  constructor(message = 'Unauthorized') { super(message); this.status = 401; this.name = 'UnauthorizedException'; }
}
export class ConflictException extends Error {
  constructor(message = 'Conflict') { super(message); this.status = 409; this.name = 'ConflictException'; }
}
export class NotFoundException extends Error {
  constructor(message = 'Not Found') { super(message); this.status = 404; this.name = 'NotFoundException'; }
}
`;

/** Extract an overlay template, transpile it to ESM, and point its `streetjs`
 *  import at the local stub. Returns the emitted JavaScript source. */
function compileOverlay(relPath: string, stubFileName: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === relPath);
  assert.ok(entry, `overlay template "${relPath}" must be registered in TEMPLATES.saas.extraFiles`);
  const js = transpileModule(entry!.content, {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  return js.replace(/from\s+['"]streetjs['"]/g, `from './${stubFileName}'`);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

let ApiKeyService: ApiKeyServiceCtor;
let apiKeyAuth: ApiKeyAuthFactory;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'saas-apikey-revocation-'));

  const stubFile = 'streetjs-stub.mjs';
  writeFileSync(join(tempDir, stubFile), STREETJS_STUB, 'utf8');

  const svcFile = join(tempDir, 'apikey.service.mjs');
  writeFileSync(svcFile, compileOverlay('src/modules/apikeys/apikey.service.ts', stubFile), 'utf8');

  const authFile = join(tempDir, 'apiKeyAuth.mjs');
  writeFileSync(authFile, compileOverlay('src/middleware/apiKeyAuth.ts', stubFile), 'utf8');

  const svcMod = await import(pathToFileURL(svcFile).href);
  ApiKeyService = svcMod.ApiKeyService as ApiKeyServiceCtor;

  const authMod = await import(pathToFileURL(authFile).href);
  apiKeyAuth = authMod.apiKeyAuth as ApiKeyAuthFactory;

  assert.equal(typeof ApiKeyService, 'function', 'ApiKeyService must load from the overlay template');
  assert.equal(typeof apiKeyAuth, 'function', 'apiKeyAuth must load from the overlay template');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Property 6: API key revocation and expiry (Requirements 5.3, 5.4, 5.5)', () => {
  // Each generated key declares whether it is revoked and how its expiry sits
  // relative to "now". Offsets are kept well clear of zero to avoid flakiness
  // around the boundary comparison `expires_at < now()`.
  const ONE_HOUR = 3_600_000;
  const expiryArb = fc.constantFrom(
    ...(['none', 'expired', 'future'] as const),
  );
  const keyArb = fc.record({
    orgId: fc.stringMatching(/^org_[a-z0-9]{1,6}$/),
    scopes: fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}:(read|write)$/), { maxLength: 4 }),
    revoked: fc.boolean(),
    expiry: expiryArb,
  });

  it('verify() and apiKeyAuth yield 401 IFF a key is revoked or expired, else authenticate', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(keyArb, { minLength: 1, maxLength: 8 }),
        fc.nat({ max: 7 }),
        async (rawKeys, probeIdx) => {
          const now = Date.now();

          // Materialize each generated key into a persisted row + the plaintext
          // a client would present. The secret is unique per key (index-salted),
          // so each key_hash is distinct.
          const rows: ApiKeyRow[] = [];
          const plaintexts: string[] = [];
          rawKeys.forEach((k, i) => {
            const secret = `secret_${i}_abcdefgh012345`;
            const prefix = `sk_test_${secret.slice(0, 4)}`;
            const expiresAt =
              k.expiry === 'none'
                ? null
                : k.expiry === 'expired'
                  ? new Date(now - ONE_HOUR).toISOString()
                  : new Date(now + ONE_HOUR).toISOString();
            rows.push({
              id: `key_${i}`,
              org_id: k.orgId,
              created_by: 'actor_1',
              name: `key ${i}`,
              prefix,
              key_hash: sha256(secret),
              scopes: k.scopes,
              last_used_at: null,
              expires_at: expiresAt,
              revoked_at: k.revoked ? new Date(now - ONE_HOUR).toISOString() : null,
              created_at: new Date(now - 2 * ONE_HOUR).toISOString(),
            });
            plaintexts.push(`${prefix}.${secret}`);
          });

          // In-memory repository backing the real ApiKeyService.
          let autoId = rows.length;
          const repo: ApiKeyRepository = {
            async insert(values) {
              const row: ApiKeyRow = {
                id: `key_${autoId++}`,
                org_id: values.org_id,
                created_by: values.created_by,
                name: values.name,
                prefix: values.prefix,
                key_hash: values.key_hash,
                scopes: values.scopes,
                last_used_at: null,
                expires_at: values.expires_at ? values.expires_at.toISOString() : null,
                revoked_at: null,
                created_at: new Date().toISOString(),
              };
              rows.push(row);
              return row;
            },
            async findByHash(keyHash) {
              return rows.find((r) => r.key_hash === keyHash) ?? null;
            },
            async listByOrg(orgId) {
              return rows.filter((r) => r.org_id === orgId);
            },
            async touchLastUsed(id, when) {
              const r = rows.find((x) => x.id === id);
              if (r) r.last_used_at = when.toISOString();
            },
            async setRevoked(orgId, keyId, when) {
              const r = rows.find((x) => x.id === keyId && x.org_id === orgId);
              if (r) r.revoked_at = when.toISOString();
            },
          };

          const svc = new ApiKeyService(repo);

          const probe = rows[probeIdx % rows.length]!;
          const probePlaintext = plaintexts[probeIdx % rows.length]!;

          // Oracle: the gate is CLOSED (401) iff the key is revoked OR expired.
          const isRevoked = probe.revoked_at !== null;
          const isExpired =
            probe.expires_at !== null && new Date(probe.expires_at).getTime() < now;
          const shouldReject = isRevoked || isExpired;

          // (1) Drive the property through the real ApiKeyService.verify.
          const result = await svc.verify(probePlaintext);
          if (shouldReject) {
            assert.equal(result, null, 'revoked or expired key must NOT verify');
          } else {
            assert.ok(result, 'a live key must verify');
            assert.equal(result!.orgId, probe.org_id, 'verified key must be scoped to its org');
            assert.deepEqual(result!.scopes, probe.scopes, 'verified key must carry its scopes');
          }

          // (2) Confirm the gate maps to the 401 contract via the real middleware.
          const mw = apiKeyAuth({ keys: svc });
          const ctx: TestCtx = { headers: { 'x-api-key': probePlaintext } };
          let threw = false;
          let status = 0;
          try {
            await mw(ctx, async () => {
              return;
            });
          } catch (e) {
            threw = true;
            status = (e as { status?: number }).status ?? 0;
          }

          if (shouldReject) {
            assert.equal(threw, true, 'revoked/expired key: apiKeyAuth must reject');
            assert.equal(status, 401, 'closed gate must yield a 401 Unauthorized response');
            assert.equal(ctx.org, undefined, 'no org may be established for a rejected key');
          } else {
            assert.equal(threw, false, 'live key: apiKeyAuth must not reject');
            assert.ok(ctx.org, 'live key must establish the active org');
            assert.equal(ctx.org!.id, probe.org_id);

            // (3) Revoking a live key must immediately close the gate (Req 5.3).
            await svc.revoke(probe.org_id, 'actor_1', probe.id);
            const afterRevoke = await svc.verify(probePlaintext);
            assert.equal(afterRevoke, null, 'a key must not verify after revoke()');

            const ctx2: TestCtx = { headers: { 'x-api-key': probePlaintext } };
            let threw2 = false;
            let status2 = 0;
            try {
              await mw(ctx2, async () => {
                return;
              });
            } catch (e) {
              threw2 = true;
              status2 = (e as { status?: number }).status ?? 0;
            }
            assert.equal(threw2, true, 'apiKeyAuth must reject a revoked key');
            assert.equal(status2, 401, 'a revoked key must yield 401');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
