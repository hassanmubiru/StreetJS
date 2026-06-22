// saas-tenant-isolation.pbt.test.ts
// Property-based test for the SaaS starter's multi-tenant isolation guarantee.
//
//   Property 1 (Tenant isolation): for every request authenticated with an
//   active org `o`, every row returned OR mutated by a tenant-scoped repository
//   satisfies `row.org_id = o.id`. No query crosses tenants.
//   **Validates: Requirements 1.1**
//
// The tenant-scoping logic ships as overlay template content scaffolded into a
// generated project's `src/middleware/tenant.ts` (it is NOT a top-level export of
// create.ts). To exercise the real scaffolded behavior we read the registered
// template string, transpile it to JS, neutralize its `streetjs` import (only the
// `ForbiddenException` value matters for `orgScopedRepo`), load it as a module,
// and run fast-check against the exported `orgScopedRepo` helper — the pure
// function that enforces `WHERE org_id = ctx.org.id` on reads and stamps
// `org_id = ctx.org.id` on writes.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

/** A tenant-scoped row: carries the `org_id` discriminator the wrapper enforces. */
interface Row {
  org_id: string;
  id: string;
}

/** The subset of the repository contract `orgScopedRepo` wraps and returns. */
interface Repo {
  find(filter: Record<string, unknown>): Promise<Row[]>;
  findOne(filter: Record<string, unknown>): Promise<Row | null>;
  insert(values: Partial<Row>): Promise<Row>;
  update(filter: Record<string, unknown>, values: Partial<Row>): Promise<Row>;
}

/** Signature of the scaffolded `orgScopedRepo` helper under test. */
type OrgScopedRepoFn = (repo: Repo, ctx: { org?: { id: string } }) => Repo;

/**
 * Extract `src/middleware/tenant.ts` from the saas overlay, transpile it, and
 * load the exported `orgScopedRepo`. Returns the function plus a cleanup handle.
 */
async function loadOrgScopedRepo(): Promise<{ orgScopedRepo: OrgScopedRepoFn; cleanup: () => void }> {
  const tenantFile = TEMPLATES.saas.extraFiles?.find((f) => f.path === 'src/middleware/tenant.ts');
  assert.ok(tenantFile, 'saas overlay must register src/middleware/tenant.ts');

  const transpiled = ts.transpileModule(tenantFile!.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  // Replace the `streetjs` value import with local stand-ins. `orgScopedRepo`
  // only references `ForbiddenException`; `UnauthorizedException` is used by the
  // sibling `tenantResolver` and is stubbed for the module to load cleanly.
  const js = transpiled.replace(
    /import\s*\{[^}]*\}\s*from\s*['"]streetjs['"];?/,
    'class ForbiddenException extends Error {} class UnauthorizedException extends Error {}',
  );

  const dir = mkdtempSync(join(tmpdir(), 'street-tenant-pbt-'));
  const file = join(dir, 'tenant.mjs');
  writeFileSync(file, js, 'utf8');
  const mod = await import(pathToFileURL(file).href);
  return {
    orgScopedRepo: mod.orgScopedRepo as OrgScopedRepoFn,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const orgIdArb = fc.stringMatching(/^org_[a-z0-9]{1,6}$/);
const idArb = fc.stringMatching(/^[a-z]{1,8}$/);

describe('Property 1: tenant isolation (orgScopedRepo) — Validates: Requirements 1.1', () => {
  let orgScopedRepo: OrgScopedRepoFn;
  let cleanup: () => void = () => {};

  before(async () => {
    const loaded = await loadOrgScopedRepo();
    orgScopedRepo = loaded.orgScopedRepo;
    cleanup = loaded.cleanup;
    assert.equal(typeof orgScopedRepo, 'function', 'orgScopedRepo must be importable from the overlay');
  });

  after(() => cleanup());

  it('reads (find) never cross tenants and return every active-org row', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(orgIdArb, { minLength: 2, maxLength: 5 }),
        fc.array(fc.record({ id: idArb, org: fc.nat() }), { maxLength: 30 }),
        fc.nat(),
        async (orgs, rowSpecs, activeIdx) => {
          const activeOrgId = orgs[activeIdx % orgs.length]!;
          const store: Row[] = rowSpecs.map((s, i) => ({
            id: `${s.id}_${i}`,
            org_id: orgs[s.org % orgs.length]!,
          }));
          // Worst case: the backing store ignores the filter and returns ALL
          // rows from EVERY tenant. The wrapper alone must enforce isolation.
          const backing: Repo = {
            find: async () => store.slice(),
            findOne: async () => null,
            insert: async (v) => v as Row,
            update: async (_f, v) => v as Row,
          };
          const scoped = orgScopedRepo(backing, { org: { id: activeOrgId } });
          const rows = await scoped.find({});
          for (const r of rows) {
            assert.equal(r.org_id, activeOrgId, 'find must not return rows from another tenant');
          }
          const expected = store.filter((r) => r.org_id === activeOrgId).length;
          assert.equal(rows.length, expected, 'find must return every active-org row');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('reads (findOne) return an active-org row or deny a foreign-tenant row', async () => {
    await fc.assert(
      fc.asyncProperty(orgIdArb, orgIdArb, idArb, async (activeOrgId, rowOrgId, id) => {
        const row: Row = { id, org_id: rowOrgId };
        const backing: Repo = {
          find: async () => [],
          findOne: async () => row,
          insert: async (v) => v as Row,
          update: async (_f, v) => v as Row,
        };
        const scoped = orgScopedRepo(backing, { org: { id: activeOrgId } });
        if (rowOrgId === activeOrgId) {
          const got = await scoped.findOne({ id });
          assert.ok(got && got.org_id === activeOrgId, 'findOne must return the active-org row');
        } else {
          await assert.rejects(() => scoped.findOne({ id }), 'cross-tenant findOne must be denied');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('writes (insert) stamp org_id to the active org, overriding any payload org_id', async () => {
    await fc.assert(
      fc.asyncProperty(orgIdArb, orgIdArb, idArb, async (activeOrgId, payloadOrgId, id) => {
        let captured: Partial<Row> | null = null;
        const backing: Repo = {
          find: async () => [],
          findOne: async () => null,
          insert: async (v) => {
            captured = v;
            return v as Row;
          },
          update: async (_f, v) => v as Row,
        };
        const scoped = orgScopedRepo(backing, { org: { id: activeOrgId } });
        const out = await scoped.insert({ id, org_id: payloadOrgId });
        assert.equal(captured!.org_id, activeOrgId, 'insert must stamp the active org_id');
        assert.equal(out.org_id, activeOrgId, 'inserted row must belong to the active org');
      }),
      { numRuns: 200 },
    );
  });

  it('writes (update) mutate only active-org rows, stamp org_id, and deny cross-tenant rows', async () => {
    await fc.assert(
      fc.asyncProperty(orgIdArb, orgIdArb, idArb, orgIdArb, async (activeOrgId, existingOrgId, id, payloadOrgId) => {
        let updateValues: Partial<Row> | null = null;
        let updateCalled = false;
        const existing: Row = { id, org_id: existingOrgId };
        const backing: Repo = {
          find: async () => [],
          findOne: async () => existing,
          insert: async (v) => v as Row,
          update: async (_f, v) => {
            updateCalled = true;
            updateValues = v;
            return v as Row;
          },
        };
        const scoped = orgScopedRepo(backing, { org: { id: activeOrgId } });
        if (existingOrgId === activeOrgId) {
          const out = await scoped.update({ id }, { org_id: payloadOrgId });
          assert.equal(updateValues!.org_id, activeOrgId, 'update must stamp the active org_id');
          assert.equal(out.org_id, activeOrgId, 'updated row must remain in the active org');
        } else {
          await assert.rejects(() => scoped.update({ id }, { org_id: payloadOrgId }), 'cross-tenant update must be denied');
          assert.equal(updateCalled, false, 'a cross-tenant update must not mutate the row');
        }
      }),
      { numRuns: 200 },
    );
  });
});
