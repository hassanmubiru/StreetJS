// saas-audit-viewer.test.ts
// Unit tests for the SaaS starter audit-log viewer + append-only enforcement.
//
// The AuditService overlay ships as a TEMPLATE-STRING source inside
// TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts (at
// src/modules/audit/audit.service.ts) — it is scaffolded into generated
// projects, not exported as a runtime symbol from the CLI. To exercise the real
// behaviour in isolation we extract the template, transpile it with the
// TypeScript compiler the CLI already depends on, rewrite its `streetjs` import
// to a faithful local stub of the framework exceptions, and dynamically import
// the result. A fake AuditRepository backs the service.
//
// Covers (Requirements 6.3, 6.4, 6.5):
//   - list: a viewer who is neither owner nor admin is denied 403 and gets no
//     entries (the repository is never queried).
//   - list: owner/admin receive only rows for their org (org-scoped filtering).
//   - list: the page size is capped at AUDIT_PAGE_MAX (100) — an over-limit
//     request and the default both reach the repository with limit 100.
//   - update()/remove(): both are rejected (append-only) and the underlying
//     row is preserved unchanged.

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

/** A row as it lives in the audit_logs table. */
interface Row {
  id: string;
  org_id: string;
  actor_id: string;
  action: string;
  target: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

/** Build a fake append-only AuditRepository over an in-memory row store. It
 * records every listByOrg call so tests can assert org scoping and the page
 * cap, and applies the same org filter + newest-first order the contract
 * promises. It exposes NO update/delete, mirroring the immutable contract. */
function makeRepo(seed: Row[]) {
  const store: Row[] = [...seed];
  const listCalls: { orgId: string; limit: number; before?: string }[] = [];
  const repo = {
    async appendInTx(_tx: unknown, values: Omit<Row, 'id' | 'created_at'>): Promise<Row> {
      const row: Row = { id: `a${store.length + 1}`, created_at: new Date().toISOString(), ...values };
      store.push(row);
      return row;
    },
    async listByOrg(orgId: string, opts: { limit: number; before?: string }): Promise<Row[]> {
      listCalls.push({ orgId, limit: opts.limit, before: opts.before });
      return store
        .filter((r) => r.org_id === orgId)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, opts.limit);
    },
  };
  return { repo, store, listCalls };
}

/** A no-op unit-of-work that just runs the work in a fake transaction. */
const uow = {
  async transaction<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    return work({ tx: true });
  },
};

const ACTIVE = 'org-active';
const OTHER = 'org-other';

function seedRows(): Row[] {
  return [
    { id: 'r1', org_id: ACTIVE, actor_id: 'u1', action: 'apikey.create', target: 'k1', meta: null, created_at: '2024-01-01T00:00:00.000Z' },
    { id: 'r2', org_id: ACTIVE, actor_id: 'u1', action: 'member.invite', target: 'e@x.com', meta: { role: 'member' }, created_at: '2024-01-02T00:00:00.000Z' },
    { id: 'r3', org_id: OTHER, actor_id: 'u9', action: 'member.remove', target: 'u8', meta: null, created_at: '2024-01-03T00:00:00.000Z' },
  ];
}

describe('saas overlay — audit viewer & append-only enforcement', () => {
  let dir: string;
  let AuditService: any;
  let AUDIT_PAGE_MAX: number;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-audit-viewer-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    const mod = await loadOverlay(dir, 'src/modules/audit/audit.service.ts', 'audit.service.mjs');
    AuditService = mod['AuditService'];
    AUDIT_PAGE_MAX = mod['AUDIT_PAGE_MAX'] as number;
    assert.equal(typeof AuditService, 'function', 'AuditService must be exported by the overlay');
    assert.equal(AUDIT_PAGE_MAX, 100, 'AUDIT_PAGE_MAX must be 100');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // Requirement 6.4 — a viewer who is neither owner nor admin is denied with a
  // 403, no audit entries are returned, and the repository is never queried.
  describe('list authorization', () => {
    it('denies a member viewer with 403 and returns no entries (repo untouched)', async () => {
      const { repo, listCalls } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      await assert.rejects(
        () => svc.list({ orgId: ACTIVE, role: 'member' }),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.equal(listCalls.length, 0, 'no audit rows may be read for an unauthorized viewer');
    });

    it('returns only the active org rows for an owner viewer', async () => {
      const { repo } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      const rows = await svc.list({ orgId: ACTIVE, role: 'owner' });

      assert.ok(rows.length > 0, 'owner must receive audit entries');
      assert.deepEqual(
        [...new Set(rows.map((r: any) => r.org_id))],
        [ACTIVE],
        'only active-org rows may be returned (no cross-tenant leakage)',
      );
    });

    it('returns only the active org rows for an admin viewer', async () => {
      const { repo, listCalls } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      const rows = await svc.list({ orgId: ACTIVE, role: 'admin' });

      assert.equal(listCalls.length, 1, 'admin viewer queries the repository exactly once');
      assert.equal(listCalls[0].orgId, ACTIVE, 'the repository is queried scoped to the viewer org');
      assert.ok(rows.every((r: any) => r.org_id === ACTIVE), 'admin sees only active-org rows');
    });
  });

  // Requirement 6.3 — pages are capped at AUDIT_PAGE_MAX (100) entries per
  // request. An over-limit request and the default both reach the repository
  // with limit 100.
  describe('list pagination cap', () => {
    it('caps an over-limit request at 100', async () => {
      const { repo, listCalls } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      await svc.list({ orgId: ACTIVE, role: 'owner' }, { limit: 5000 });

      assert.equal(listCalls.length, 1);
      assert.equal(listCalls[0].limit, 100, 'a limit above the cap must be clamped to 100');
    });

    it('defaults the limit to 100 when none is provided', async () => {
      const { repo, listCalls } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      await svc.list({ orgId: ACTIVE, role: 'owner' });

      assert.equal(listCalls.length, 1);
      assert.equal(listCalls[0].limit, 100, 'a missing limit must default to 100');
    });

    it('honors an in-range limit and forwards the before cursor', async () => {
      const { repo, listCalls } = makeRepo(seedRows());
      const svc = new AuditService(repo, uow);

      await svc.list({ orgId: ACTIVE, role: 'owner' }, { limit: 25, before: '2024-02-01T00:00:00.000Z' });

      assert.equal(listCalls[0].limit, 25, 'an in-range limit is passed through unchanged');
      assert.equal(listCalls[0].before, '2024-02-01T00:00:00.000Z', 'the before cursor is forwarded');
    });
  });

  // Requirement 6.5 — audit logs are append-only: any attempt to update or
  // delete an existing row is rejected and the row is preserved unchanged.
  describe('append-only enforcement', () => {
    it('rejects update() with 403 and leaves the existing row unchanged', async () => {
      const seed = seedRows();
      const { repo, store } = makeRepo(seed);
      const svc = new AuditService(repo, uow);
      const before = JSON.parse(JSON.stringify(store));

      await assert.rejects(
        () => svc.update(),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.deepEqual(store, before, 'no audit row may be mutated by a rejected update');
    });

    it('rejects remove() with 403 and preserves the existing row', async () => {
      const seed = seedRows();
      const { repo, store } = makeRepo(seed);
      const svc = new AuditService(repo, uow);
      const before = JSON.parse(JSON.stringify(store));

      await assert.rejects(
        () => svc.remove(),
        (err: any) => err.name === 'ForbiddenException' && err.status === 403,
      );
      assert.deepEqual(store, before, 'no audit row may be deleted by a rejected remove');
    });

    it('exposes no update/delete method on the repository contract', () => {
      const { repo } = makeRepo(seedRows());
      assert.equal((repo as any).update, undefined, 'the audit repository must not expose update');
      assert.equal((repo as any).delete, undefined, 'the audit repository must not expose delete');
    });
  });
});
