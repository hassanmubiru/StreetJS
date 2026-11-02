// saas-apikey-scoping.pbt.test.ts
// Property-based test for the SaaS starter overlay's API-key auth scoping
// (Property 5).
//
//   **Property 5: API key auth scoping** — for every valid key k issued for org
//   o with scopes S, a request authenticated by k has `ctx.org.id = o` and
//   access limited to `k.scopes`: a route requiring a scope in S passes, while a
//   route requiring a scope NOT in S is denied with 403.
//
//   **Validates: Requirements 5.2, 1.1**
//
// The API-key logic is NOT a top-level runtime export of create.ts — it ships as
// overlay TEMPLATE STRINGS in `TEMPLATES.saas.extraFiles`
// (`src/modules/apikeys/apikey.service.ts` and `src/middleware/apiKeyAuth.ts`).
// To drive the property through the *real* scaffolded code (rather than a
// re-implementation), this test extracts those template strings, transpiles them
// with the bundled TypeScript compiler, substitutes a tiny stub for the two
// `streetjs` exception classes the middleware imports, and dynamically imports
// the result. The 401/403 contract is exercised through the real `apiKeyAuth`
// middleware, whose stubbed `ForbiddenException` carries `status = 403` (and
// `UnauthorizedException` `status = 401`) to mirror the framework's behaviour.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

type Scope = string;

/** A persisted API key row, mirroring the overlay's ApiKeyRow shape. */
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
  create(
    orgId: string,
    actorId: string,
    input: { name: string; scopes: Scope[]; expiresAt?: Date },
  ): Promise<{ id: string; plaintext: string }>;
  verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null>;
}

/** Minimal request context shape consumed by the real apiKeyAuth. */
interface TestCtx {
  headers: Record<string, string | undefined>;
  org?: { id: string };
  scopes?: Scope[];
}

type ApiKeyServiceCtor = new (repo: ApiKeyRepository) => ApiKeyServiceLike;
type ApiKeyMiddleware = (ctx: TestCtx, next: () => Promise<void>) => Promise<void>;
type ApiKeyAuthFactory = (
  deps: { keys: ApiKeyServiceLike },
  options?: { requiredScopes?: Scope[] },
) => ApiKeyMiddleware;

// The stub standing in for `streetjs`'s exception classes. ForbiddenException
// carries status 403 and UnauthorizedException status 401 to mirror the
// framework contract the overlay relies on.
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

/** In-memory ApiKeyRepository backing the real ApiKeyService. */
function makeRepo(): ApiKeyRepository {
  const rows: ApiKeyRow[] = [];
  let seq = 0;
  return {
    async insert(values) {
      const row: ApiKeyRow = {
        id: `key_${seq++}`,
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
}

let ApiKeyService: ApiKeyServiceCtor;
let apiKeyAuth: ApiKeyAuthFactory;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'saas-apikey-scoping-'));

  const stubFile = 'streetjs-stub.mjs';
  writeFileSync(join(tempDir, stubFile), STREETJS_STUB, 'utf8');

  const svcFile = join(tempDir, 'apikey.service.mjs');
  writeFileSync(svcFile, compileOverlay('src/modules/apikeys/apikey.service.ts', stubFile), 'utf8');

  const mwFile = join(tempDir, 'apiKeyAuth.mjs');
  writeFileSync(mwFile, compileOverlay('src/middleware/apiKeyAuth.ts', stubFile), 'utf8');

  const svcMod = await import(pathToFileURL(svcFile).href);
  ApiKeyService = svcMod.ApiKeyService as ApiKeyServiceCtor;

  const mwMod = await import(pathToFileURL(mwFile).href);
  apiKeyAuth = mwMod.apiKeyAuth as ApiKeyAuthFactory;

  assert.equal(typeof ApiKeyService, 'function', 'ApiKeyService must load from the overlay template');
  assert.equal(typeof apiKeyAuth, 'function', 'apiKeyAuth must load from the overlay template');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Property 5: API key auth scoping (Requirements 5.2, 1.1)', () => {
  // Plain (wildcard-free) scope vocabulary, so a scope absent from a key's set
  // is genuinely unsatisfied (no '*' or 'segment:*' grant can cover it).
  const SCOPE_VOCAB = [
    'billing:read',
    'billing:write',
    'members:read',
    'members:write',
    'audit:read',
    'settings:read',
    'settings:write',
    'keys:read',
  ] as const;

  const orgArb = fc.stringMatching(/^org_[0-9]{1,5}$/);
  const actorArb = fc.stringMatching(/^u[0-9]{1,4}$/);
  const nameArb = fc.stringMatching(/^[a-zA-Z ]{1,12}$/);
  const scopesArb = fc.subarray([...SCOPE_VOCAB]);

  /** Run the real apiKeyAuth middleware, returning {threw, status} + the ctx. */
  async function runAuth(
    svc: ApiKeyServiceLike,
    rawKey: string | undefined,
    requiredScopes: Scope[],
  ): Promise<{ ctx: TestCtx; threw: boolean; status: number; reached: boolean }> {
    const ctx: TestCtx = { headers: rawKey === undefined ? {} : { 'x-api-key': rawKey } };
    const mw = apiKeyAuth({ keys: svc }, { requiredScopes });
    let threw = false;
    let status = 0;
    let reached = false;
    try {
      await mw(ctx, async () => {
        reached = true;
      });
    } catch (e) {
      threw = true;
      status = (e as { status?: number }).status ?? 0;
    }
    return { ctx, threw, status, reached };
  }

  it('a request authenticated by key k for org o has ctx.org.id = o and access limited to k.scopes', async () => {
    await fc.assert(
      fc.asyncProperty(
        orgArb,
        actorArb,
        nameArb,
        scopesArb,
        orgArb,
        fc.nat({ max: 100 }),
        fc.nat({ max: 100 }),
        async (org, actor, name, scopes, decoyOrg, posIdx, negIdx) => {
          const repo = makeRepo();
          const svc = new ApiKeyService(repo);

          // Issue the key under test for org `o` with scope set `S`.
          const { plaintext } = await svc.create(org, actor, { name, scopes });

          // A decoy key for another org with a disjoint-ish scope ensures
          // scoping is by the presented key, not by ambient state.
          await svc.create(decoyOrg, actor, { name: 'decoy', scopes: ['keys:read'] });

          // (1) Scope-agnostic route: a valid key authenticates and is scoped to
          //     its own org `o`, with ctx.scopes exactly equal to `S`.
          {
            const { ctx, threw, reached } = await runAuth(svc, plaintext, []);
            assert.equal(threw, false, 'valid key must authenticate on a scope-agnostic route');
            assert.equal(reached, true, 'next() must run for a valid key');
            assert.ok(ctx.org, 'apiKeyAuth must establish the request org');
            assert.equal(ctx.org!.id, org, 'ctx.org.id must equal the key\'s issuing org o');
            assert.deepEqual(ctx.scopes, scopes, 'ctx.scopes must equal the key\'s scopes S');
          }

          // (2) Route requiring a scope IN S -> passes, still scoped to o.
          if (scopes.length > 0) {
            const required = scopes[posIdx % scopes.length]!;
            const { ctx, threw, reached } = await runAuth(svc, plaintext, [required]);
            assert.equal(threw, false, `key holding scope "${required}" must pass the scope gate`);
            assert.equal(reached, true, 'next() must run when the required scope is held');
            assert.equal(ctx.org!.id, org, 'access remains scoped to org o');
            assert.deepEqual(ctx.scopes, scopes, 'access remains limited to k.scopes');
          }

          // (3) Route requiring a scope NOT in S -> denied with 403.
          const missing = SCOPE_VOCAB.filter((s) => !scopes.includes(s));
          if (missing.length > 0) {
            const required = missing[negIdx % missing.length]!;
            const { threw, status, reached } = await runAuth(svc, plaintext, [required]);
            assert.equal(threw, true, `key lacking scope "${required}" must be denied`);
            assert.equal(status, 403, 'insufficient scope must yield a 403 Forbidden response');
            assert.equal(reached, false, 'next() must not run when a required scope is missing');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
