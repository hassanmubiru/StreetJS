// saas-tenant-edge.test.ts
// Edge-case unit tests for the SaaS starter tenancy overlay.
//
// The overlay logic (tenantResolver, orgScopedRepo, OrgService) ships as
// TEMPLATE-STRING source inside TEMPLATES.saas.extraFiles in
// packages/cli/src/commands/create.ts — it is scaffolded into generated
// projects, not exported as runtime symbols from the CLI. To exercise the real
// behaviour in isolation we extract each template, transpile it with the
// TypeScript compiler the CLI already depends on, rewrite its `streetjs` import
// to a faithful local stub of the framework exceptions, and dynamically import
// the result. Fakes stand in for the membership service / repositories.
//
// Covers (Requirements 1.3, 1.4, 1.5, 2.2):
//   - tenantResolver: no resolvable active org -> 403, no active org established
//   - orgScopedRepo: writes stamp the active org_id, OVERRIDING the payload
//   - orgScopedRepo: cross-tenant read/update of a foreign row -> 403, unchanged
//   - OrgService.create: duplicate slug -> 409 with nothing written

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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
  const transpiled = ts.transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const rewritten = transpiled.replace(/from ['"]streetjs['"]/g, "from './streetjs.mjs'");
  const abs = join(dir, outFile);
  writeFileSync(abs, rewritten, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

describe('saas overlay — tenancy edge cases', () => {
  let dir: string;
  // Loaded real overlay symbols (typed loosely: they arrive via dynamic import).
  let tenantResolver: any;
  let orgScopedRepo: any;
  let OrgService: any;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-tenant-edge-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    const tenant = await loadOverlay(dir, 'src/middleware/tenant.ts', 'tenant.mjs');
    const orgs = await loadOverlay(dir, 'src/modules/orgs/org.service.ts', 'org.service.mjs');
    tenantResolver = tenant['tenantResolver'];
    orgScopedRepo = tenant['orgScopedRepo'];
    OrgService = orgs['OrgService'];
    assert.equal(typeof tenantResolver, 'function', 'tenantResolver must be exported by the overlay');
    assert.equal(typeof orgScopedRepo, 'function', 'orgScopedRepo must be exported by the overlay');
    assert.equal(typeof OrgService, 'function', 'OrgService must be exported by the overlay');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 1.3 — a tenant-scoped request without exactly one resolvable
  // active org (here: resolveActiveOrg yields null) is rejected with 403 and no
  // active org is established.
  describe('tenantResolver no-active-org', () => {
    it('rejects with 403 and never calls next or sets ctx.org', async () => {
      const members = { resolveActiveOrg: async () => null };
      const mw = tenantResolver({ members });
      const ctx: any = { user: { id: 'u1' }, params: {}, headers: {}, state: {} };
      let nextCalled = false;

      await assert.rejects(
        () => mw(ctx, async () => { nextCalled = true; }),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.equal(nextCalled, false, 'next must not run when no active org resolves');
      assert.equal(ctx.org, undefined, 'no active org may be established on a 403');
    });

    it('rejects an unauthenticated request with 401 before resolution', async () => {
      let resolveCalls = 0;
      const members = { resolveActiveOrg: async () => { resolveCalls++; return null; } };
      const mw = tenantResolver({ members });
      const ctx: any = { params: {}, headers: {}, state: {} }; // no ctx.user

      await assert.rejects(
        () => mw(ctx, async () => {}),
        (err: any) => err.name === 'UnauthorizedException' && err.status === 401,
      );
      assert.equal(resolveCalls, 0, 'membership resolution must not run without a user');
    });

    it('orgScopedRepo refuses to build without an active org (403)', () => {
      const repo = { find: async () => [], findOne: async () => null, insert: async (v: any) => v, update: async (_f: any, v: any) => v };
      assert.throws(
        () => orgScopedRepo(repo, { /* no ctx.org */ } as any),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
    });
  });

  // Requirement 1.4 — writes stamp the active org_id, overriding any payload
  // value; Requirement 1.5 — reads/updates of a foreign row are denied (403)
  // and the row is left unchanged.
  describe('orgScopedRepo tenant stamping & isolation', () => {
    const ACTIVE = 'org-active';
    const OTHER = 'org-other';

    function makeRepo() {
      const calls: { insert: any[]; update: any[] } = { insert: [], update: [] };
      let foreignRow: any = { id: 'row1', org_id: OTHER, name: 'foreign' };
      const repo = {
        // find returns a deliberately mixed set to prove stray rows are excluded.
        find: async (_filter: any) => [
          { id: 'a', org_id: ACTIVE, name: 'mine' },
          { id: 'b', org_id: OTHER, name: 'theirs' },
        ],
        findOne: async (_filter: any) => foreignRow,
        insert: async (values: any) => { calls.insert.push(values); return { id: 'new', ...values }; },
        update: async (filter: any, values: any) => { calls.update.push({ filter, values }); foreignRow = { ...foreignRow, ...values }; return foreignRow; },
      };
      return { repo, calls, getForeignRow: () => foreignRow };
    }

    it('stamps the active org_id on insert, overriding a payload org_id', async () => {
      const { repo, calls } = makeRepo();
      const scoped = orgScopedRepo(repo, { org: { id: ACTIVE, slug: 'a', role: 'owner' } } as any);

      await scoped.insert({ name: 'thing', org_id: OTHER });

      assert.equal(calls.insert.length, 1);
      assert.equal(calls.insert[0].org_id, ACTIVE, 'payload org_id must be overridden by the active org');
      assert.equal(calls.insert[0].name, 'thing', 'non-tenant fields are preserved');
    });

    it('excludes rows from other tenants on reads', async () => {
      const { repo } = makeRepo();
      const scoped = orgScopedRepo(repo, { org: { id: ACTIVE, slug: 'a', role: 'owner' } } as any);

      const rows = await scoped.find({});
      assert.deepEqual(rows.map((r: any) => r.org_id), [ACTIVE], 'only active-tenant rows survive');
    });

    it('denies reading a foreign row with 403', async () => {
      const { repo } = makeRepo();
      const scoped = orgScopedRepo(repo, { org: { id: ACTIVE, slug: 'a', role: 'owner' } } as any);

      await assert.rejects(
        () => scoped.findOne({ id: 'row1' }),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
    });

    it('denies updating a foreign row with 403 and leaves it unchanged', async () => {
      const ctx = makeRepo();
      const scoped = orgScopedRepo(ctx.repo, { org: { id: ACTIVE, slug: 'a', role: 'owner' } } as any);

      await assert.rejects(
        () => scoped.update({ id: 'row1' }, { name: 'hijacked' }),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.equal(ctx.calls.update.length, 0, 'no update may reach the repo for a cross-tenant row');
      assert.equal(ctx.getForeignRow().name, 'foreign', 'the foreign row must be left unchanged');
    });
  });

  // Requirement 2.2 — creating an organization with an existing slug is rejected
  // with 409 and NO organizations or memberships row is written.
  describe('OrgService.create duplicate slug', () => {
    it('throws 409 and writes neither an org nor a membership row', async () => {
      const orgInserts: any[] = [];
      const memberInserts: any[] = [];
      const orgs = {
        findBySlug: async () => ({ id: 'existing', name: 'Acme', slug: 'acme', owner_id: 'u0', created_at: 'now' }),
        findForUser: async () => [],
        insert: async (v: any) => { orgInserts.push(v); return { id: 'x', created_at: 'now', ...v }; },
      };
      const members = { insert: async (v: any) => { memberInserts.push(v); return { id: 'm', ...v }; } };
      const svc = new OrgService(orgs, members);

      await assert.rejects(
        () => svc.create('u1', { name: 'Acme', slug: 'acme' }),
        (err: any) => err.name === 'ConflictException' && err.status === 409,
      );
      assert.equal(orgInserts.length, 0, 'no organizations row may be written on a duplicate slug');
      assert.equal(memberInserts.length, 0, 'no memberships row may be written on a duplicate slug');
    });

    it('persists the org plus an owner membership when the slug is free', async () => {
      const orgInserts: any[] = [];
      const memberInserts: any[] = [];
      const orgs = {
        findBySlug: async () => null,
        findForUser: async () => [],
        insert: async (v: any) => { orgInserts.push(v); return { id: 'org-new', created_at: 'now', ...v }; },
      };
      const members = { insert: async (v: any) => { memberInserts.push(v); return { id: 'm', ...v }; } };
      const svc = new OrgService(orgs, members);

      const org = await svc.create('u1', { name: 'Beta', slug: 'beta' });

      assert.equal(org.id, 'org-new');
      assert.equal(orgInserts.length, 1, 'exactly one organizations row is written');
      assert.equal(orgInserts[0].owner_id, 'u1');
      assert.equal(memberInserts.length, 1, 'exactly one memberships row is written');
      assert.deepEqual(
        { org_id: memberInserts[0].org_id, user_id: memberInserts[0].user_id, role: memberInserts[0].role },
        { org_id: 'org-new', user_id: 'u1', role: 'owner' },
        'the creator is granted the owner role in the new org',
      );
    });
  });
});
