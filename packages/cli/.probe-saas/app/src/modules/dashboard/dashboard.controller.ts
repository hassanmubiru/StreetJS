// src/modules/dashboard/dashboard.controller.ts
// Server-rendered dashboard for the SaaS starter (overlay code — NOT framework code).
//
// Renders htmx fragments via @streetjs/plugin-htmx (ctx.htmx.view / .partial /
// .engine.partial) for the orgs list, members, API keys, and audit viewer. No SPA
// and no client build step — this REUSES the exact view convention the base
// `--frontend htmx` scaffold uses (src/controllers/views.controller.ts +
// HtmxPlugin.middleware in main.ts); it does NOT introduce a second view engine.
//
// ROLE-GATING (Requirements 9.1, 9.2, 9.4, 9.5): every /o/:slug route runs behind
// tenantResolver (src/middleware/tenant.ts), which sets ctx.org = { id, slug, role }
// ONLY when the caller holds a membership — otherwise 403 and no org is established.
// The controller defends again at render time: it renders ONLY the views and the
// actions the member's role permits, and returns 403 with NO organization data when
// membership or the required role is missing (consistent with tenantResolver +
// requireRoles already in the overlay).
//
// WIRING (src/main.ts):
//   app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'dashboard' }));
//   // /o/:slug/* also pass through tenantResolver({ members }); the api-keys and
//   // audit routes additionally pass requireRoles('owner', 'admin').
//   app.registerController(DashboardController);

import 'reflect-metadata';
import { Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { OrgService } from '../orgs/org.service.js';
import type { ActiveOrg, MembershipService, Role } from '../members/membership.service.js';
import type { ApiKeyService } from '../apikeys/apikey.service.js';
import type { AuditService } from '../audit/audit.service.js';

/** Roles permitted to OPEN each dashboard view (Requirement 9.2). */
const VIEW_ROLES: Record<string, Role[]> = {
  home: ['owner', 'admin', 'member'],
  orgs: ['owner', 'admin', 'member'],
  members: ['owner', 'admin', 'member'],
  'api-keys': ['owner', 'admin'],
  audit: ['owner', 'admin'],
};

/** Roles permitted to perform privileged ACTIONS (invite/remove/create/revoke). */
const MANAGE_ROLES: Role[] = ['owner', 'admin'];

@Controller('/o/:slug')
export class DashboardController {
  constructor(
    private readonly orgs: OrgService,
    private readonly members: MembershipService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: AuditService,
  ) {}

  /** GET /o/:slug — member home. Any member of the org may open it. */
  @Get('/')
  async home(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx, 'home');
    if (!org) return;
    ctx.htmx.view('dashboard/home', {
      title: 'Dashboard',
      slug: org.slug,
      role: org.role,
      nav: this.nav(org),
    });
  }

  /** GET /o/:slug/orgs — organizations the signed-in user belongs to. */
  @Get('/orgs')
  async listOrgs(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx, 'orgs');
    if (!org) return;
    const orgs = await this.orgs.listForUser(ctx.user.id);
    const rows = orgs.map((o) => ctx.htmx.engine.partial('dashboard/org-row', { ...o })).join('');
    ctx.htmx.view('dashboard/orgs', { title: 'Organizations', nav: this.nav(org), orgs: rows });
  }

  /**
   * GET /o/:slug/members — any member may view the list. The invite form and the
   * per-row remove action are rendered ONLY for owner/admin (Requirement 9.2);
   * a plain member sees the roster with no management actions.
   */
  @Get('/members')
  async listMembers(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx, 'members');
    if (!org) return;
    const canManage = MANAGE_ROLES.includes(org.role);
    const list = await this.members.list(org.id);
    const rows = list
      .map((m) =>
        ctx.htmx.engine.partial('dashboard/member-row', {
          id: m.id,
          user_id: m.user_id,
          role: m.role,
          actions: canManage ? this.removeMemberButton(org.slug, m.user_id) : '',
        }),
      )
      .join('');
    ctx.htmx.view('dashboard/members', {
      title: 'Members',
      nav: this.nav(org),
      members: rows,
      inviteForm: canManage ? this.inviteForm(org.slug) : '',
    });
  }

  /** GET /o/:slug/api-keys — owner/admin only; a member gets 403 with no data. */
  @Get('/api-keys')
  async listApiKeys(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx, 'api-keys');
    if (!org) return;
    const keys = await this.apiKeys.list(org.id);
    const rows = keys
      .map((k) =>
        ctx.htmx.engine.partial('dashboard/api-key-row', {
          ...k,
          scopes: (k.scopes ?? []).join(', '),
        }),
      )
      .join('');
    ctx.htmx.view('dashboard/api-keys', {
      title: 'API keys',
      nav: this.nav(org),
      keys: rows,
      createForm: this.createKeyForm(org.slug),
    });
  }

  /** GET /o/:slug/audit — owner/admin only; a member gets 403 with no data. */
  @Get('/audit')
  async listAudit(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx, 'audit');
    if (!org) return;
    // AuditService.list also enforces owner/admin, so it is safe behind the gate.
    const entries = await this.audit.list({ orgId: org.id, role: org.role });
    const rows = entries
      .map((e) =>
        ctx.htmx.engine.partial('dashboard/audit-row', {
          id: e.id,
          actor_id: e.actor_id,
          action: e.action,
          target: e.target,
          created_at: e.created_at,
        }),
      )
      .join('');
    ctx.htmx.view('dashboard/audit', { title: 'Audit log', nav: this.nav(org), entries: rows });
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * gate — the render-time role gate. Returns ctx.org IFF a membership exists
   * AND the role may open `view`; otherwise it responds 403 with NO organization
   * data and returns null so the caller stops (Requirements 9.4, 9.5).
   */
  private gate(ctx: StreetContext, view: string): ActiveOrg | null {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org) {
      this.forbid(ctx); // no membership -> 403, render no org data (9.4)
      return null;
    }
    const allowed = VIEW_ROLES[view] ?? [];
    if (!allowed.includes(org.role)) {
      this.forbid(ctx); // role too low for this view -> 403, render no data (9.5)
      return null;
    }
    return org;
  }

  /** Render the 403 view, which contains no organization data. */
  private forbid(ctx: StreetContext): void {
    ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403);
  }

  /** Role-gated navigation: only the links the member's role may open are emitted. */
  private nav(org: ActiveOrg): string {
    const base = '/o/' + org.slug;
    const links = [
      '<a href="' + base + '">Home</a>',
      '<a href="' + base + '/orgs">Organizations</a>',
      '<a href="' + base + '/members">Members</a>',
    ];
    if (MANAGE_ROLES.includes(org.role)) {
      links.push('<a href="' + base + '/api-keys">API keys</a>');
      links.push('<a href="' + base + '/audit">Audit</a>');
      links.push('<a href="' + base + '/rbac">RBAC</a>');
    }
    links.push('<a href="' + base + '/account">Account</a>');
    return '<nav class="dash-nav">' + links.join(' · ') + '</nav>';
  }

  /** Invite form (owner/admin only) — posts to the members module. */
  private inviteForm(slug: string): string {
    const action = '/o/' + slug + '/members/invite';
    return (
      '<form class="invite" hx-post="' + action + '" hx-target="#members" hx-swap="beforeend">' +
      '<input name="email" type="email" placeholder="teammate@example.com" required>' +
      '<select name="role"><option value="member">member</option><option value="admin">admin</option></select>' +
      '<button type="submit">Invite</button>' +
      '</form>'
    );
  }

  /** Per-row remove control (owner/admin only). */
  private removeMemberButton(slug: string, userId: string): string {
    const action = '/o/' + slug + '/members/' + userId;
    return (
      '<button class="danger" hx-delete="' + action + '" hx-target="closest li" ' +
      'hx-swap="outerHTML" hx-confirm="Remove this member?">Remove</button>'
    );
  }

  /** API key creation form (rendered inside the owner/admin-gated api-keys view). */
  private createKeyForm(slug: string): string {
    const action = '/o/' + slug + '/api-keys';
    return (
      '<form class="api-key-create" hx-post="' + action + '" hx-target="#api-keys" hx-swap="afterbegin">' +
      '<input name="name" placeholder="Key name" required>' +
      '<input name="scopes" placeholder="billing:read, members:write">' +
      '<button type="submit">Create key</button>' +
      '</form>'
    );
  }
}
