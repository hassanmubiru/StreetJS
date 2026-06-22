// saas-membership-gate.pbt.test.ts
// Property-based test for the SaaS starter overlay's membership gate (Property 2).
//
//   **Property 2: Membership gate** — a user resolves an org as active IFF a
//   memberships(org_id, user_id) row exists; otherwise 403.
//
//   **Validates: Requirements 1.2, 2.1**
//
// The membership-gate logic is NOT a top-level runtime export of create.ts — it
// is shipped as overlay TEMPLATE STRINGS in `TEMPLATES.saas.extraFiles`
// (`src/modules/members/membership.service.ts` and `src/middleware/tenant.ts`).
// To drive the property through the *real* scaffolded code (rather than a
// re-implementation), this test extracts those template strings, transpiles them
// with the bundled TypeScript compiler, substitutes a tiny stub for the two
// `streetjs` exception classes they import, and dynamically imports the result.
// The 403 contract is exercised through the real `tenantResolver` middleware,
// whose stubbed `ForbiddenException` carries `status = 403` to mirror the
// framework's documented behaviour.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import ts from 'typescript';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

import { TEMPLATES } from '../commands/create.js';

type Role = 'owner' | 'admin' | 'member';

interface ActiveOrg {
  id: string;
  slug: string;
  role: Role;
}

interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
}

interface OrgRef {
  id: string;
  slug: string;
}

interface Hints {
  slug?: string;
  headerId?: string;
  sessionOrg?: string;
}

/** The two repository contracts the real MembershipService constructor expects. */
interface MemberReadRepo {
  listByOrg(orgId: string): Promise<Membership[]>;
  findMembership(orgId: string, userId: string): Promise<Membership | null>;
}
interface OrgLookupRepo {
  findBySlug(slug: string): Promise<OrgRef | null>;
  findById(id: string): Promise<OrgRef | null>;
}

interface MembershipServiceLike {
  resolveActiveOrg(userId: string, hints: Hints): Promise<ActiveOrg | null>;
}

/** Minimal request context shape consumed by the real tenantResolver. */
interface TestCtx {
  user?: { id: string };
  params: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  state: Record<string, unknown>;
  org?: ActiveOrg;
}

type MembershipServiceCtor = new (members: MemberReadRepo, orgs: OrgLookupRepo) => MembershipServiceLike;
type TenantMiddleware = (ctx: TestCtx, next: () => Promise<void>) => Promise<void>;
type TenantResolverFactory = (deps: { members: MembershipServiceLike }) => TenantMiddleware;

// The stub standing in for `streetjs`'s exception classes. ForbiddenException
// carries status 403 to mirror the framework contract the overlay relies on.
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
  const js = ts.transpileModule(entry!.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return js.replace(/from\s+['"]streetjs['"]/g, `from './${stubFileName}'`);
}

let MembershipService: MembershipServiceCtor;
let tenantResolver: TenantResolverFactory;
let tempDir: string;

before(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'saas-membership-gate-'));

  const stubFile = 'streetjs-stub.mjs';
  writeFileSync(join(tempDir, stubFile), STREETJS_STUB, 'utf8');

  const memFile = join(tempDir, 'membership.service.mjs');
  writeFileSync(memFile, compileOverlay('src/modules/members/membership.service.ts', stubFile), 'utf8');

  const tenFile = join(tempDir, 'tenant.mjs');
  writeFileSync(tenFile, compileOverlay('src/middleware/tenant.ts', stubFile), 'utf8');

  const memMod = await import(pathToFileURL(memFile).href);
  MembershipService = memMod.MembershipService as MembershipServiceCtor;

  const tenMod = await import(pathToFileURL(tenFile).href);
  tenantResolver = tenMod.tenantResolver as TenantResolverFactory;

  assert.equal(typeof MembershipService, 'function', 'MembershipService must load from the overlay template');
  assert.equal(typeof tenantResolver, 'function', 'tenantResolver must load from the overlay template');
});

after(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Property 2: membership gate (Requirements 1.2, 2.1)', () => {
  const roleArb = fc.constantFrom(...(['owner', 'admin', 'member'] as const));
  const slugArb = fc.stringMatching(/^[a-z]{1,8}$/);
  const userArb = fc.stringMatching(/^u[0-9]{1,4}$/);
  // 11 chars — cannot be produced by slugArb, so it never matches a real org.
  const UNKNOWN_SLUG = 'zzzznoexist';
  const modeArb = fc.constantFrom(
    ...(['slug', 'headerId', 'sessionOrg', 'unknown', 'none'] as const),
  );

  it('a user resolves an org as active IFF a membership row exists, else 403', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(slugArb, { minLength: 1, maxLength: 5 }),
        fc.uniqueArray(userArb, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({ oi: fc.nat({ max: 8 }), ui: fc.nat({ max: 8 }), role: roleArb }),
          { maxLength: 12 },
        ),
        fc.nat({ max: 8 }),
        fc.record({ mode: modeArb, oi: fc.nat({ max: 8 }) }),
        async (orgSlugs, users, rawMemberships, probeUi, sel) => {
          // Build the org universe (ids are distinct from user ids by construction).
          const orgs: OrgRef[] = orgSlugs.map((slug, i) => ({ id: `org_${i}_${slug}`, slug }));

          // Build the membership relation, deduped by (org_id, user_id).
          const memberships: Membership[] = [];
          const seen = new Set<string>();
          let mid = 0;
          for (const rm of rawMemberships) {
            const org = orgs[rm.oi % orgs.length]!;
            const user = users[rm.ui % users.length]!;
            const key = `${org.id}::${user}`;
            if (seen.has(key)) continue;
            seen.add(key);
            memberships.push({ id: `m${mid++}`, org_id: org.id, user_id: user, role: rm.role });
          }

          const probeUser = users[probeUi % users.length]!;

          // Derive the candidate org + the matching resolution hints / request ctx.
          let candidate: OrgRef | null = null;
          const hints: Hints = {};
          const ctx: TestCtx = { user: { id: probeUser }, params: {}, headers: {}, state: {} };

          if (sel.mode === 'none') {
            // no hints at all -> no candidate
          } else if (sel.mode === 'unknown') {
            hints.slug = UNKNOWN_SLUG;
            ctx.params['slug'] = UNKNOWN_SLUG;
          } else {
            const org = orgs[sel.oi % orgs.length]!;
            candidate = org;
            if (sel.mode === 'slug') {
              hints.slug = org.slug;
              ctx.params['slug'] = org.slug;
            } else if (sel.mode === 'headerId') {
              hints.headerId = org.id;
              ctx.headers['x-org-id'] = org.id;
            } else {
              hints.sessionOrg = org.id;
              ctx.state['session'] = { activeOrgId: org.id };
            }
          }

          // Oracle: the gate is open IFF a candidate resolves AND the probe user
          // has a membership row for it.
          let membership: Membership | null = null;
          if (candidate) {
            const c = candidate;
            membership = memberships.find((m) => m.org_id === c.id && m.user_id === probeUser) ?? null;
          }
          const hasMembership = membership !== null;

          // In-memory repositories backing the real MembershipService.
          const orgById = new Map(orgs.map((o) => [o.id, o] as const));
          const orgBySlug = new Map(orgs.map((o) => [o.slug, o] as const));
          const memberRepo: MemberReadRepo = {
            async listByOrg(orgId) {
              return memberships.filter((m) => m.org_id === orgId);
            },
            async findMembership(orgId, userId) {
              return memberships.find((m) => m.org_id === orgId && m.user_id === userId) ?? null;
            },
          };
          const orgRepo: OrgLookupRepo = {
            async findBySlug(slug) {
              return orgBySlug.get(slug) ?? null;
            },
            async findById(id) {
              return orgById.get(id) ?? null;
            },
          };

          const ms = new MembershipService(memberRepo, orgRepo);

          // (1) Drive the property through the real resolveActiveOrg.
          const result = await ms.resolveActiveOrg(probeUser, hints);
          if (hasMembership) {
            assert.ok(result, 'membership present must resolve an active org');
            assert.equal(result!.id, candidate!.id);
            assert.equal(result!.slug, candidate!.slug);
            assert.equal(result!.role, membership!.role, 'resolved role must match the membership row');
          } else {
            assert.equal(result, null, 'no membership row must close the gate (null active org)');
          }

          // (2) Confirm the gate maps to the 403 contract via the real middleware.
          const mw = tenantResolver({ members: ms });
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

          if (hasMembership) {
            assert.equal(threw, false, 'membership present: tenantResolver must not reject');
            assert.ok(ctx.org, 'tenantResolver must establish exactly one active org');
            assert.equal(ctx.org!.id, candidate!.id);
            assert.equal(ctx.org!.role, membership!.role);
          } else {
            assert.equal(threw, true, 'no membership: tenantResolver must reject');
            assert.equal(status, 403, 'closed gate must yield a 403 Forbidden response');
            assert.equal(ctx.org, undefined, 'no active org may be established on a closed gate');
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
