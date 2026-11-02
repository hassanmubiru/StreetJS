// saas-apikey-list.test.ts
// Unit tests for the SaaS starter API-key overlay covering the listing view and
// the missing/empty X-API-Key header path.
//
// The overlay logic (ApiKeyService, apiKeyAuth) ships as TEMPLATE-STRING source
// inside TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts — it is
// scaffolded into generated projects, not exported as runtime symbols from the
// CLI. To exercise the real behaviour in isolation we extract each template,
// transpile it with the TypeScript compiler the CLI already depends on, rewrite
// its `streetjs` import to a faithful local stub of the framework exceptions, and
// dynamically import the result. In-memory fakes stand in for the repository.
//
// Covers (Requirements 5.6, 5.8):
//   - ApiKeyService.list: returned views carry id/name/prefix/scopes/timestamps
//     and NEVER expose key_hash nor any plaintext secret field
//   - apiKeyAuth: a missing X-API-Key header -> 401 (UnauthorizedException)
//   - apiKeyAuth: an empty X-API-Key header value -> 401 (UnauthorizedException)

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { TEMPLATES } from '../commands/create.js';

/** Faithful stub of the streetjs HTTP exceptions the overlay imports. Mirrors
 * the real shape from packages/core/src/http/exceptions.ts: a numeric `status`
 * and `name` set to the constructor name. */
const STREETJS_STUB = `
class StreetException extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
    this.name = this.constructor.name;
  }
}
export class BadRequestException extends StreetException { constructor(m = 'Bad Request', d) { super(400, m, d); } }
export class UnauthorizedException extends StreetException { constructor(m = 'Unauthorized') { super(401, m); } }
export class ForbiddenException extends StreetException { constructor(m = 'Forbidden') { super(403, m); } }
export class NotFoundException extends StreetException { constructor(m = 'Not Found') { super(404, m); } }
export class ConflictException extends StreetException { constructor(m = 'Conflict', d) { super(409, m, d); } }
`;

/** Pull a scaffolded overlay file's source out of the saas template registry. */
function templateSource(path: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(entry, `expected saas template to register ${path}`);
  return entry!.content;
}

/** Transpile one overlay template to an ESM module on disk (with its `streetjs`
 * import rewritten to the local stub) and dynamically import it. */
async function loadOverlay(dir: string, templatePath: string, outFile: string): Promise<Record<string, unknown>> {
  const transpiled = transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const rewritten = transpiled.replace(/from ['"]streetjs['"]/g, "from './streetjs.mjs'");
  const abs = join(dir, outFile);
  writeFileSync(abs, rewritten, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

describe('saas overlay — API key listing & missing-header auth', () => {
  let dir: string;
  // Loaded real overlay symbols (typed loosely: they arrive via dynamic import).
  let ApiKeyService: any;
  let apiKeyAuth: any;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-apikey-list-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    const apikeys = await loadOverlay(dir, 'src/modules/apikeys/apikey.service.ts', 'apikey.service.mjs');
    const auth = await loadOverlay(dir, 'src/middleware/apiKeyAuth.ts', 'apiKeyAuth.mjs');
    ApiKeyService = apikeys['ApiKeyService'];
    apiKeyAuth = auth['apiKeyAuth'];
    assert.equal(typeof ApiKeyService, 'function', 'ApiKeyService must be exported by the overlay');
    assert.equal(typeof apiKeyAuth, 'function', 'apiKeyAuth must be exported by the overlay');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 5.8 — a listed key returns its safe metadata (id, name, prefix,
  // scopes, last_used_at, expires_at, revoked_at, created_at) and excludes BOTH
  // the stored key hash and the plaintext secret.
  describe('ApiKeyService.list metadata view', () => {
    // A persisted row carries secret material (key_hash) the view must never leak.
    const rows = [
      {
        id: 'k1',
        org_id: 'org-1',
        created_by: 'u1',
        name: 'CI deploy key',
        prefix: 'sk_test_AB12',
        key_hash: 'a'.repeat(64),
        scopes: ['billing:read', 'members:write'],
        last_used_at: '2024-01-02T00:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
      },
      {
        id: 'k2',
        org_id: 'org-1',
        created_by: 'u2',
        name: 'revoked key',
        prefix: 'sk_test_CD34',
        key_hash: 'b'.repeat(64),
        scopes: [],
        last_used_at: null,
        expires_at: '2025-01-01T00:00:00.000Z',
        revoked_at: '2024-06-01T00:00:00.000Z',
        created_at: '2024-05-01T00:00:00.000Z',
      },
    ];

    function makeService() {
      const repo = {
        insert: async (v: any) => ({ id: 'new', ...v }),
        findByHash: async () => null,
        listByOrg: async (orgId: string) => rows.filter((r) => r.org_id === orgId),
        touchLastUsed: async () => {},
        setRevoked: async () => {},
      };
      return new ApiKeyService(repo);
    }

    it('returns exactly the safe metadata fields for every key', async () => {
      const views = await makeService().list('org-1');

      assert.equal(views.length, 2, 'every org key is listed');
      assert.deepEqual(views[0], {
        id: 'k1',
        name: 'CI deploy key',
        prefix: 'sk_test_AB12',
        scopes: ['billing:read', 'members:write'],
        last_used_at: '2024-01-02T00:00:00.000Z',
        expires_at: null,
        revoked_at: null,
        created_at: '2024-01-01T00:00:00.000Z',
      });
      assert.deepEqual(views[1], {
        id: 'k2',
        name: 'revoked key',
        prefix: 'sk_test_CD34',
        scopes: [],
        last_used_at: null,
        expires_at: '2025-01-01T00:00:00.000Z',
        revoked_at: '2024-06-01T00:00:00.000Z',
        created_at: '2024-05-01T00:00:00.000Z',
      });
    });

    it('never exposes key_hash or any plaintext secret field', async () => {
      const views = await makeService().list('org-1');

      for (const view of views) {
        const keys = Object.keys(view);
        assert.ok(!keys.includes('key_hash'), 'key_hash must not appear on a listed view');
        assert.ok(!keys.includes('plaintext'), 'plaintext must not appear on a listed view');
        assert.ok(!keys.includes('secret'), 'secret must not appear on a listed view');
        // Guard against the hash leaking under any field name.
        for (const value of Object.values(view)) {
          assert.notEqual(value, 'a'.repeat(64), 'a stored key hash must never surface in the view');
          assert.notEqual(value, 'b'.repeat(64), 'a stored key hash must never surface in the view');
        }
      }
    });
  });

  // Requirement 5.6 — a request presenting no X-API-Key header, or an empty
  // header value, is rejected with 401 (UnauthorizedException) and verify is
  // never consulted because there is no key to check.
  describe('apiKeyAuth missing / empty header', () => {
    function makeMiddleware() {
      let verifyCalls = 0;
      const keys = { verify: async () => { verifyCalls++; return null; } };
      return { mw: apiKeyAuth({ keys }), getVerifyCalls: () => verifyCalls };
    }

    it('rejects a request with no X-API-Key header with 401', async () => {
      const { mw, getVerifyCalls } = makeMiddleware();
      const ctx: any = { headers: {} };
      let nextCalled = false;

      await assert.rejects(
        () => mw(ctx, async () => { nextCalled = true; }),
        (err: any) => err.name === 'UnauthorizedException' && err.status === 401,
      );
      assert.equal(nextCalled, false, 'next must not run when the header is missing');
      assert.equal(getVerifyCalls(), 0, 'verify must not run without a presented key');
      assert.equal(ctx.org, undefined, 'no org may be established on a 401');
    });

    it('rejects a request with an empty X-API-Key header value with 401', async () => {
      const { mw, getVerifyCalls } = makeMiddleware();
      const ctx: any = { headers: { 'x-api-key': '' } };
      let nextCalled = false;

      await assert.rejects(
        () => mw(ctx, async () => { nextCalled = true; }),
        (err: any) => err.name === 'UnauthorizedException' && err.status === 401,
      );
      assert.equal(nextCalled, false, 'next must not run for an empty header value');
      assert.equal(getVerifyCalls(), 0, 'verify must not run for an empty key');
      assert.equal(ctx.org, undefined, 'no org may be established on a 401');
    });
  });
});
