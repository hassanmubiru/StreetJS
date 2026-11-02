// saas-dashboard-roles.test.ts
// Unit tests for the SaaS starter htmx dashboard role-gated rendering.
//
// The dashboard controllers ship as TEMPLATE-STRING source inside
// TEMPLATES.saas.extraFiles in packages/cli/src/commands/create.ts — they are
// scaffolded into generated projects, not exported as runtime symbols from the
// CLI. To exercise the real gating behaviour in isolation we reuse the harness
// established by saas-tenant-edge.test.ts: pull each controller template out of
// the registry, transpile it with the TypeScript compiler the CLI already
// depends on, rewrite its `streetjs` (decorators + types) and React UI imports
// to faithful local stubs, neutralise `reflect-metadata`, and dynamically
// import the result. The controllers' sibling-module imports are `import type`
// only, so they elide during transpile and never need stubbing.
//
// Covers (Requirements 9.2, 9.4, 9.5):
//   - DashboardController: no membership (ctx.org undefined) -> 403 forbidden
//     view rendered with NO organization data (9.4)
//   - DashboardController: a member opening an owner/admin-only view (api-keys,
//     audit) -> 403 forbidden view, NO data, underlying service never called (9.5)
//   - DashboardController: a member opening a member-permitted view renders that
//     view but OMITS the owner/admin-only actions (invite form, remove) (9.2)
//   - DashboardController: an allowed role renders the expected view template
//   - AuthRbacController: a member requesting RBAC management -> 403 (9.5), while
//     the account view (any member) renders

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { transpileModule, ModuleKind, ScriptTarget } from './ts-transpile-helper.js';
import { TEMPLATES } from '../commands/create.js';

/** No-op stubs for the streetjs decorators the controllers import. The real
 * `@Controller`/`@Get` register routes; for isolated unit testing we only need
 * the class to instantiate, so they collapse to identity decorators. The type
 * exports (StreetContext) are erased during transpile. */
const STREETJS_STUB = `
export const Controller = (..._args) => (_target) => {};
export const Get = (..._args) => (_target, _key, _desc) => {};
export const Post = (..._args) => (_target, _key, _desc) => {};
export const Delete = (..._args) => (_target, _key, _desc) => {};
`;

/** Empty stand-in for the side-effect-only `reflect-metadata` import. */
const REFLECT_METADATA_STUB = `export {};\n`;

/** Minimal stubs for the React UI component packages auth-ui.controller imports
 * as VALUE imports (the css strings). Their presence is all the controller needs. */
const AUTH_UI_STUB = `export const streetAuthCss = '/* auth-ui css */';\n`;
const ADMIN_UI_STUB = `export const streetAdminCss = '/* admin-ui css */';\n`;

/** Pull a scaffolded overlay file's source out of the saas template registry. */
function templateSource(path: string): string {
  const entry = TEMPLATES.saas.extraFiles?.find((f) => f.path === path);
  assert.ok(entry, `expected saas template to register ${path}`);
  return entry!.content;
}

/** Transpile one overlay controller template to an ESM module on disk, rewriting
 * its external imports to the local stubs, then dynamically import it. */
async function loadController(
  dir: string,
  templatePath: string,
  outFile: string,
): Promise<Record<string, unknown>> {
  const transpiled = transpileModule(templateSource(templatePath), {
    compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 },
  }).outputText;
  const rewritten = transpiled
    .replace(/from ['"]streetjs['"]/g, "from './streetjs.mjs'")
    .replace(/from ['"]reflect-metadata['"]/g, "from './reflect-metadata.mjs'")
    .replace(/['"]reflect-metadata['"]/g, "'./reflect-metadata.mjs'")
    .replace(/from ['"]@streetjs\/auth-ui['"]/g, "from './auth-ui.mjs'")
    .replace(/from ['"]@streetjs\/admin-ui['"]/g, "from './admin-ui.mjs'");
  const abs = join(dir, outFile);
  writeFileSync(abs, rewritten, 'utf8');
  return import(pathToFileURL(abs).href) as Promise<Record<string, unknown>>;
}

/** Build a fake StreetContext that records every htmx.view(...) render and
 * stubs htmx.engine.partial so list views can serialise rows without a real
 * template engine. */
function makeCtx(org: unknown) {
  const views: Array<{ template: string; data: any; status?: number }> = [];
  const ctx: any = {
    user: { id: 'u1' },
    org,
    htmx: {
      view: (template: string, data: any, status?: number) => {
        views.push({ template, data, status });
      },
      engine: {
        partial: (template: string, _data: any) => `<partial:${template}>`,
      },
    },
  };
  return { ctx, views };
}

describe('saas overlay — dashboard role-gated rendering', () => {
  let dir: string;
  let DashboardController: any;
  let AuthRbacController: any;

  // Fake services injected into the DashboardController constructor
  // (orgs, members, apiKeys, audit). Each records whether it was queried so we
  // can prove forbidden requests never reach the data layer.
  let calls: { listForUser: number; membersList: number; apiKeysList: number; auditList: number };
  function makeServices() {
    calls = { listForUser: 0, membersList: 0, apiKeysList: 0, auditList: 0 };
    const orgs = {
      listForUser: async () => {
        calls.listForUser++;
        return [{ id: 'org1', name: 'Acme', slug: 'acme', owner_id: 'u1', created_at: 'now' }];
      },
    };
    const members = {
      list: async () => {
        calls.membersList++;
        return [
          { id: 'm1', user_id: 'u1', role: 'member' },
          { id: 'm2', user_id: 'u2', role: 'admin' },
        ];
      },
    };
    const apiKeys = {
      list: async () => {
        calls.apiKeysList++;
        return [{ id: 'k1', name: 'ci', prefix: 'sk_test_AB12', scopes: ['billing:read'] }];
      },
    };
    const audit = {
      list: async () => {
        calls.auditList++;
        return [{ id: 'a1', actor_id: 'u1', action: 'apikey.create', target: 'k1', created_at: 'now' }];
      },
    };
    return { orgs, members, apiKeys, audit };
  }

  function newDashboard() {
    const { orgs, members, apiKeys, audit } = makeServices();
    return new DashboardController(orgs, members, apiKeys, audit);
  }

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'saas-dashboard-roles-'));
    writeFileSync(join(dir, 'streetjs.mjs'), STREETJS_STUB, 'utf8');
    writeFileSync(join(dir, 'reflect-metadata.mjs'), REFLECT_METADATA_STUB, 'utf8');
    writeFileSync(join(dir, 'auth-ui.mjs'), AUTH_UI_STUB, 'utf8');
    writeFileSync(join(dir, 'admin-ui.mjs'), ADMIN_UI_STUB, 'utf8');

    const dash = await loadController(dir, 'src/modules/dashboard/dashboard.controller.ts', 'dashboard.controller.mjs');
    const authUi = await loadController(dir, 'src/modules/dashboard/auth-ui.controller.ts', 'auth-ui.controller.mjs');
    DashboardController = dash['DashboardController'];
    AuthRbacController = authUi['AuthRbacController'];
    assert.equal(typeof DashboardController, 'function', 'DashboardController must be exported by the overlay');
    assert.equal(typeof AuthRbacController, 'function', 'AuthRbacController must be exported by the overlay');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Assert a recorded render is the 403 forbidden view carrying NO org data. */
  function assertForbidden(view: { template: string; data: any; status?: number }) {
    assert.equal(view.template, 'dashboard/forbidden', 'a denied request renders the forbidden view');
    assert.equal(view.status, 403, 'the forbidden view is rendered with HTTP 403');
    // No organization data may leak: only a title is permitted in the payload.
    assert.deepEqual(Object.keys(view.data).sort(), ['title'], 'forbidden view carries no org data');
    assert.equal(view.data.slug, undefined, 'no org slug in a forbidden render');
    assert.equal(view.data.role, undefined, 'no org role in a forbidden render');
    assert.equal(view.data.nav, undefined, 'no navigation in a forbidden render');
  }

  // Requirement 9.4 — a user holding NO membership (ctx.org is undefined because
  // tenantResolver never established one) requesting a dashboard route gets a 403
  // and NO organization data.
  describe('non-member dashboard route (Requirement 9.4)', () => {
    it('renders the 403 forbidden view with no org data and queries no service', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx(undefined); // no active org established

      await ctrl.home(ctx);

      assert.equal(views.length, 1, 'exactly one render occurs');
      assertForbidden(views[0]);
      assert.deepEqual(calls, { listForUser: 0, membersList: 0, apiKeysList: 0, auditList: 0 },
        'no data layer is touched when membership is absent');
    });

    it('forbids every dashboard view for a non-member, never leaking data', async () => {
      for (const method of ['home', 'listOrgs', 'listMembers', 'listApiKeys', 'listAudit'] as const) {
        const ctrl = newDashboard();
        const { ctx, views } = makeCtx(undefined);
        await ctrl[method](ctx);
        assert.equal(views.length, 1, `${method} renders exactly one view`);
        assertForbidden(views[0]);
      }
      assert.deepEqual(calls, { listForUser: 0, membersList: 0, apiKeysList: 0, auditList: 0 },
        'no service call happens for any non-member route');
    });
  });

  // Requirement 9.5 — a member requesting a view that requires a higher role
  // (api-keys and audit are owner/admin only) gets a 403 with NO data for that
  // view, and the backing service is never invoked.
  describe('role-restricted views for an insufficient role (Requirement 9.5)', () => {
    it('denies a member the api-keys view with 403 and never lists keys', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });

      await ctrl.listApiKeys(ctx);

      assert.equal(views.length, 1);
      assertForbidden(views[0]);
      assert.equal(calls.apiKeysList, 0, 'api keys must not be loaded for an unauthorized role');
    });

    it('denies a member the audit view with 403 and never lists audit entries', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });

      await ctrl.listAudit(ctx);

      assert.equal(views.length, 1);
      assertForbidden(views[0]);
      assert.equal(calls.auditList, 0, 'audit entries must not be loaded for an unauthorized role');
    });

    it('grants an owner the api-keys view, rendering the expected template', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'owner' });

      await ctrl.listApiKeys(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/api-keys', 'an owner sees the api-keys view');
      assert.equal(views[0].status, undefined, 'an allowed render uses the default status (200)');
      assert.equal(calls.apiKeysList, 1, 'the api keys are loaded for an authorized role');
    });

    it('grants an admin the audit view, rendering the expected template', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'admin' });

      await ctrl.listAudit(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/audit', 'an admin sees the audit view');
      assert.equal(calls.auditList, 1, 'the audit entries are loaded for an authorized role');
    });
  });

  // Requirement 9.2 — when a member opens a view permitted for their role, only
  // the actions allowed for that role are rendered; owner/admin-only actions
  // (invite form, per-row remove button) are OMITTED.
  describe('role-permitted view omits privileged actions (Requirement 9.2)', () => {
    it('renders the members view for a member but omits invite/remove actions', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });

      await ctrl.listMembers(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/members', 'a member may view the roster');
      assert.equal(views[0].data.inviteForm, '', 'the invite form is omitted for a plain member');
      // The owner/admin-only navigation links must not appear for a member.
      assert.ok(!views[0].data.nav.includes('/api-keys'), 'nav omits the api-keys link for a member');
      assert.ok(!views[0].data.nav.includes('/audit'), 'nav omits the audit link for a member');
      assert.equal(calls.membersList, 1, 'the roster is loaded for a member');
    });

    it('renders the members view for an admin WITH invite/remove actions', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'admin' });

      await ctrl.listMembers(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/members');
      assert.notEqual(views[0].data.inviteForm, '', 'the invite form is rendered for an admin');
      assert.ok(views[0].data.nav.includes('/api-keys'), 'nav includes the api-keys link for an admin');
      assert.ok(views[0].data.nav.includes('/audit'), 'nav includes the audit link for an admin');
    });

    it('renders the member home for any member', async () => {
      const ctrl = newDashboard();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });

      await ctrl.home(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/home', 'any member may open the home view');
      assert.equal(views[0].data.role, 'member');
    });
  });

  // Requirements 9.4 / 9.5 applied to the auth-ui composition controller: RBAC
  // management is owner/admin only; the account view is open to any member.
  describe('auth-ui controller role gating (Requirements 9.4, 9.5)', () => {
    it('denies RBAC management to a member with 403 and no data', async () => {
      const ctrl = new AuthRbacController();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });

      await ctrl.rbac(ctx);

      assert.equal(views.length, 1);
      assertForbidden(views[0]);
    });

    it('denies RBAC management to a non-member with 403', async () => {
      const ctrl = new AuthRbacController();
      const { ctx, views } = makeCtx(undefined);

      await ctrl.rbac(ctx);

      assert.equal(views.length, 1);
      assertForbidden(views[0]);
    });

    it('grants RBAC management to an owner', async () => {
      const ctrl = new AuthRbacController();
      const { ctx, views } = makeCtx({ id: 'org1', slug: 'acme', role: 'owner' });

      await ctrl.rbac(ctx);

      assert.equal(views.length, 1);
      assert.equal(views[0].template, 'dashboard/rbac', 'an owner sees the RBAC view');
    });

    it('renders the account view for any member but forbids a non-member', async () => {
      const member = new AuthRbacController();
      const mctx = makeCtx({ id: 'org1', slug: 'acme', role: 'member' });
      await member.account(mctx.ctx);
      assert.equal(mctx.views[0].template, 'dashboard/account', 'any member may open their account');

      const nonMember = new AuthRbacController();
      const nctx = makeCtx(undefined);
      await nonMember.account(nctx.ctx);
      assertForbidden(nctx.views[0]);
    });
  });
});
