// packages/cli/src/commands/create.ts
// `street create <name>` — scaffolds a complete Street project from embedded templates.

import { mkdir, writeFile, stat, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { CliContext } from '../index.js';

/** Template variants: extra @streetjs deps + a starter module + a description. */
interface TemplateSpec {
  /** Always-on dependencies added on top of the base scaffold for every variant. */
  packages: Record<string, string>;
  description: string;
  starter: { path: string; content: string };
  /**
   * Optional additional files written verbatim into the project (e.g. SQL
   * migrations, docs). An entry tagged with `flag` is written ONLY when that
   * opt-in flag is enabled (default = no flag = always written). Every entry
   * stays registered here regardless of `flag` so the template registry remains
   * the single source of truth for template extraction.
   */
  extraFiles?: { path: string; content: string; flag?: string }[];
  /**
   * Dependencies added ONLY when a given opt-in flag is enabled. Keeps the
   * default scaffold dependency-minimal: a package that a flag-gated file imports
   * is installed only when that flag is passed (e.g. `--with-billing` adds
   * `@streetjs/plugin-stripe`).
   */
  flagPackages?: Record<string, Record<string, string>>;
}

export const TEMPLATES: Record<string, TemplateSpec> = {
  app: {
    packages: {},
    description: 'Minimal Street app (HTTP, DI, Postgres, health checks).',
    starter: { path: '', content: '' },
  },
  saas: {
    // Always-on composition set for the production-grade SaaS starter. The
    // default scaffold is DEPENDENCY-MINIMAL: on top of the base scaffold's
    // `streetjs` core it adds ONLY the server-rendered dashboard runtime
    // (@streetjs/plugin-htmx, published v1.0.0). Every default-scaffolded source
    // file therefore imports only from `streetjs`, Node builtins, local files,
    // or @streetjs/plugin-htmx — so `street create --starter saas` installs
    // cleanly from npm and type-checks with tsc out of the box.
    //
    // Everything else is OPT-IN behind a flag (see `flagPackages` + per-file
    // `flag` tags), composing only published, version-correct packages:
    //   --with-billing   → @streetjs/plugin-stripe (billing webhook controller)
    //   --with-admin-ui  → @streetjs/auth-ui + @streetjs/admin-ui (React screens)
    //   --with-email     → email via @streetjs/plugin-sendgrid (injected Mailer)
    //   --with-marzpay   → @streetjs/plugin-marzpay (MarzPay billing modules)
    // Billing/email and the Postgres driver (@streetjs/plugin-postgres) stay
    // install-on-demand (see SAAS.md).
    packages: {
      '@streetjs/plugin-htmx': '^1.0.0',
    },
    // Opt-in dependency sets. A flag's packages are added to the project ONLY
    // when that flag is passed, and exactly mirror the files the flag enables.
    // Versions are pinned to the published, satisfiable ranges on npm.
    flagPackages: {
      // The billing webhook controller imports @streetjs/plugin-stripe (1.0.2).
      'with-billing': { '@streetjs/plugin-stripe': '^1.0.2' },
      // The auth/RBAC management screens import @streetjs/auth-ui (0.1.2) and
      // @streetjs/admin-ui (0.1.2) — there is NO 1.x of either, so the prior
      // `^1.0.0` was unsatisfiable. These are the only published versions.
      'with-admin-ui': {
        '@streetjs/auth-ui': '^0.1.2',
        '@streetjs/admin-ui': '^0.1.2',
      },
      // The MarzPay billing modules (service, checkout/webhook controllers,
      // subscription service, dashboard) import @streetjs/plugin-marzpay (1.0.0),
      // the official MarzPay payments plugin. Install-on-demand, mirroring how
      // --with-billing gates @streetjs/plugin-stripe.
      'with-marzpay': { '@streetjs/plugin-marzpay': '^1.0.0' },
    },
    description: 'SaaS starter: multi-tenant orgs, RBAC, billing, audit on top of the base app.',
    starter: {
      path: 'src/features/saas.ts',
      content: `// SaaS feature wiring — RBAC composed from core StreetJS primitives.
//
// The DEFAULT scaffold composes role-based access control from the core
// framework (\`requireRoles\` and the auth/RBAC middleware primitives exported by
// \`streetjs\`). This keeps the default project dependency-minimal: it installs
// and type-checks with ZERO extra @streetjs packages beyond the always-on
// @streetjs/plugin-htmx dashboard runtime.
//
// \`requireRoles(...roles)\` returns middleware that authorizes a request only
// when \`ctx.user\` holds one of the named roles (otherwise 403). Compose it on
// your privileged routes — e.g. members management, API keys, audit, settings.
//
// OPTIONAL ENHANCEMENT: @streetjs/admin's \`AdminService\` adds a managed RBAC
// engine (wildcard permissions, \`can()\`, audit primitives) and, with
// @streetjs/admin-ui, server-rendered management screens. It is an optional
// upgrade — install it separately once published:
//   npm install @streetjs/admin
// and scaffold the auth/RBAC screens with \`street create --starter saas --with-admin-ui\`.
import { requireRoles } from 'streetjs';

/** Guard owner-only routes (billing, ownership transfer). */
export const requireOwner = requireRoles('owner');

/** Guard owner/admin routes (member management, API keys, audit, settings). */
export const requireAdmin = requireRoles('owner', 'admin');
`,
    },
    extraFiles: [
      {
        path: 'migrations/001_saas.sql',
        content: `-- SaaS starter schema — organizations, teams, RBAC, invitations, billing, audit.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  owner_id   BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  id      BIGSERIAL PRIMARY KEY,
  org_id  BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT NOT NULL DEFAULT 'member',  -- owner | admin | member
  UNIQUE (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  id          BIGSERIAL PRIMARY KEY,
  org_id      BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  org_id             BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan               TEXT NOT NULL DEFAULT 'free',
  status             TEXT NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  current_period_end TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id   BIGINT REFERENCES users(id),
  action     TEXT NOT NULL,
  target     TEXT,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
`,
      },
      {
        path: 'migrations/002_api_keys.sql',
        content: `-- API keys: per-organization, hashed at rest. The plaintext key is shown ONCE
-- on creation and never stored. \`prefix\` allows safe display/lookup.
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS api_keys (
  id           BIGSERIAL PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by   BIGINT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,                 -- e.g. "sk_live_AB12" (display only)
  key_hash     TEXT NOT NULL,                 -- SHA-256 of the full secret
  scopes       JSONB NOT NULL DEFAULT '[]',   -- ["billing:read","members:write"]
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key_hash)
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org    ON api_keys(org_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(prefix);
`,
      },
      {
        path: 'migrations/003_settings.sql',
        content: `-- Settings: typed key/value per org and per user. JSONB value keeps it flexible
-- without schema churn. One row per (scope, key).
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS org_settings (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS user_settings (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_org_settings  ON org_settings(org_id);
CREATE INDEX IF NOT EXISTS idx_user_settings ON user_settings(user_id);
`,
      },
      {
        path: 'migrations/005_stripe_events.sql',
        flag: 'with-billing',
        content: `-- Stripe webhook idempotency store (opt-in: --starter saas --with-billing).
-- Backs the ProcessedEventStore so a replayed or duplicated Stripe event is
-- recorded once and skipped on redelivery (see src/modules/billing/billing.service.ts).
-- PostgreSQL DDL; for SQLite see adjustments in SAAS.md.
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,            -- Stripe event id; idempotency key (Req 7.2)
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()  -- when the event was applied (Req 7.3)
);
`,
      },
      {
        path: 'src/middleware/tenant.ts',
        content: `// src/middleware/tenant.ts
// Multi-tenant request scoping for the SaaS starter (overlay code — NOT framework code).
//
// Responsibilities:
//   1. tenantResolver — resolve the active organization for a request and assert
//      the requester holds a membership in it (otherwise 403).
//   2. orgScopedRepo  — wrap a repository so every read is filtered by
//      org_id = ctx.org.id and every write is stamped with that org id,
//      overriding any org_id supplied in the payload. Cross-tenant row access
//      is denied with 403.

import {
  ForbiddenException,
  UnauthorizedException,
  type MiddlewareFn,
  type StreetContext,
} from 'streetjs';

/** The active organization attached to the request context by tenantResolver. */
export interface ActiveOrg {
  id: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
}

/** Hints used to resolve the active org, in first-match-wins precedence order. */
export interface OrgResolutionHints {
  slug?: string;
  headerId?: string;
  sessionOrg?: string;
}

/** Minimal contract the resolver needs from the membership module. */
export interface MembershipResolver {
  // Returns the active org IFF a memberships(org_id, user_id) row exists; else null.
  resolveActiveOrg(userId: string, hints: OrgResolutionHints): Promise<ActiveOrg | null>;
}

/**
 * tenantResolver — determines the active organization and asserts membership.
 *
 * Resolution order (first match wins): path ':slug' or 'X-Org-Slug' header,
 * then 'X-Org-Id' header, then the session's active org. The resolved org is
 * set on ctx.org. If the user is not authenticated -> 401; if no org can be
 * resolved for which the user holds a membership -> 403 and no active org is
 * established (the membership gate is enforced inside resolveActiveOrg).
 */
export function tenantResolver(deps: { members: MembershipResolver }): MiddlewareFn {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    if (!ctx.user) throw new UnauthorizedException('authentication required');

    // First-match-wins precedence: slug (path param or X-Org-Slug header) ->
    // X-Org-Id header -> session active org.
    const slug =
      (ctx.params?.['slug'] as string | undefined) ??
      (ctx.headers?.['x-org-slug'] as string | undefined);
    const headerId = ctx.headers?.['x-org-id'] as string | undefined;
    const sessionOrg = (ctx.state?.['session'] as { activeOrgId?: string } | undefined)
      ?.activeOrgId;

    // resolveActiveOrg returns a non-null org ONLY when a memberships row links
    // the user to that org (membership gate). Otherwise it returns null and the
    // request is rejected with 403 without establishing an active organization.
    const org = await deps.members.resolveActiveOrg(ctx.user.id, { slug, headerId, sessionOrg });
    if (!org) throw new ForbiddenException('no active organization');

    ctx.org = org; // { id, slug, role } — exactly one active org per request.
    await next();
  };
}

/** A row that carries a tenant discriminator. */
interface OrgScopedRow {
  org_id: string;
}

/** The subset of a repository the org-scoped wrapper relies on. */
export interface ScopedRepository<T extends OrgScopedRow> {
  find(filter: Record<string, unknown>): Promise<T[]>;
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  insert(values: Partial<T>): Promise<T>;
  update(filter: Record<string, unknown>, values: Partial<T>): Promise<T>;
}

/**
 * orgScopedRepo — wraps a repository so tenant scoping is unavoidable.
 *
 *   reads  : every filter gets org_id = ctx.org.id injected; rows whose org_id
 *            differs are excluded from results.
 *   writes : org_id is stamped to ctx.org.id, OVERRIDING any payload value.
 *   access : reading or updating an existing row whose org_id differs ->
 *            ForbiddenException (403), leaving the row unchanged.
 */
export function orgScopedRepo<T extends OrgScopedRow>(
  repo: ScopedRepository<T>,
  ctx: StreetContext,
): ScopedRepository<T> {
  const orgId = ctx.org?.id;
  if (!orgId) throw new ForbiddenException('no active organization');

  const assertSameTenant = (row: T | null): void => {
    if (row && row.org_id !== orgId) {
      // Cross-tenant access attempt: deny and leave the row untouched.
      throw new ForbiddenException('cross-tenant access denied');
    }
  };

  return {
    async find(filter) {
      // Inject the tenant predicate, then defensively exclude any stray rows.
      const rows = await repo.find({ ...filter, org_id: orgId });
      return rows.filter((r) => r.org_id === orgId);
    },
    async findOne(filter) {
      const row = await repo.findOne({ ...filter, org_id: orgId });
      assertSameTenant(row);
      return row;
    },
    async insert(values) {
      // Stamp org_id last so it overrides any org_id supplied in the payload.
      return repo.insert({ ...values, org_id: orgId } as Partial<T>);
    },
    async update(filter, values) {
      // Confirm the target row belongs to the active tenant before mutating it.
      const existing = await repo.findOne({ ...filter, org_id: orgId });
      assertSameTenant(existing);
      if (!existing) throw new ForbiddenException('cross-tenant access denied');
      // Stamp org_id last; a payload value cannot move a row to another tenant.
      return repo.update({ ...filter, org_id: orgId }, { ...values, org_id: orgId } as Partial<T>);
    },
  };
}
`,
      },
      {
        path: 'src/modules/orgs/org.service.ts',
        content: `// src/modules/orgs/org.service.ts
// Organization module for the SaaS starter (overlay code — NOT framework code).
//
// OrgService.create persists an \`organizations\` row PLUS an owner \`memberships\`
// row in a single transaction; a duplicate slug yields 409 with nothing written.
// getBySlug / listForUser are the read helpers the dashboard and tenant
// resolution build on.

import { ConflictException } from 'streetjs';

export type Role = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  created_at: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
}

/** Persistence contract OrgService relies on (satisfied by @streetjs/orm repos). */
export interface OrgRepository {
  findBySlug(slug: string): Promise<Organization | null>;
  /** Organizations the user holds a membership in. */
  findForUser(userId: string): Promise<Organization[]>;
  insert(values: { name: string; slug: string; owner_id: string }): Promise<Organization>;
}

export interface MembershipWriteRepository {
  insert(values: { org_id: string; user_id: string; role: Role }): Promise<Membership>;
}

/** Runs a unit of work in a transaction; defaults to a pass-through for tests. */
export type TxRunner = <T>(fn: () => Promise<T>) => Promise<T>;

export class OrgService {
  constructor(
    private readonly orgs: OrgRepository,
    private readonly members: MembershipWriteRepository,
    private readonly tx: TxRunner = (fn) => fn(),
  ) {}

  /**
   * create — persist an organization and grant the creator the \`owner\` role.
   *
   * The slug is checked first: a duplicate slug rejects with 409 and NO
   * \`organizations\` or \`memberships\` row is written. Otherwise the org row and
   * the owner membership row are written together inside one transaction.
   */
  async create(actorId: string, input: { name: string; slug: string }): Promise<Organization> {
    const existing = await this.orgs.findBySlug(input.slug);
    if (existing) {
      throw new ConflictException(\`organization slug "\${input.slug}" already exists\`);
    }

    return this.tx(async () => {
      const org = await this.orgs.insert({
        name: input.name,
        slug: input.slug,
        owner_id: actorId,
      });
      await this.members.insert({ org_id: org.id, user_id: actorId, role: 'owner' });
      return org;
    });
  }

  /** getBySlug — look up an organization by its unique slug; null if absent. */
  async getBySlug(slug: string): Promise<Organization | null> {
    return this.orgs.findBySlug(slug);
  }

  /** listForUser — every organization the user holds a membership in. */
  async listForUser(userId: string): Promise<Organization[]> {
    return this.orgs.findForUser(userId);
  }
}
`,
      },
      {
        path: 'src/modules/members/membership.service.ts',
        content: `// src/modules/members/membership.service.ts
// Membership module for the SaaS starter (overlay code — NOT framework code).
//
// MembershipService owns the membership gate: a user may act within an org ONLY
// when a memberships(org_id, user_id) row exists. resolveActiveOrg implements the
// MembershipResolver contract that tenantResolver (src/middleware/tenant.ts)
// depends on, returning { id, slug, role } | null.
//
// NOTE: invite / acceptInvite / remove live in the invitations module (added in
// a later task); this service only resolves and reads memberships.

import { ForbiddenException } from 'streetjs';

export type Role = 'owner' | 'admin' | 'member';

/** The active organization tenantResolver attaches to ctx.org. */
export interface ActiveOrg {
  id: string;
  slug: string;
  role: Role;
}

/** Hints used to resolve the active org, in first-match-wins precedence order. */
export interface OrgResolutionHints {
  slug?: string;
  headerId?: string;
  sessionOrg?: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
}

export interface OrganizationRef {
  id: string;
  slug: string;
}

/** Persistence contract the service relies on (satisfied by @streetjs/orm repos). */
export interface MembershipReadRepository {
  /** Members of an org, for the dashboard members view. */
  listByOrg(orgId: string): Promise<Membership[]>;
  /** The membership row linking a user to an org, or null if none exists. */
  findMembership(orgId: string, userId: string): Promise<Membership | null>;
}

export interface OrgLookupRepository {
  findBySlug(slug: string): Promise<OrganizationRef | null>;
  findById(id: string): Promise<OrganizationRef | null>;
}

export class MembershipService {
  constructor(
    private readonly members: MembershipReadRepository,
    private readonly orgs: OrgLookupRepository,
  ) {}

  /**
   * resolveActiveOrg — THE membership gate.
   *
   * Resolves a candidate organization from the hints in first-match-wins order
   * (slug -> headerId -> sessionOrg) and returns { id, slug, role } IFF a
   * memberships(org_id, user_id) row links the user to that org. Returns null in
   * every other case (no hints, unknown org, or no membership row) so the caller
   * (tenantResolver) rejects the request with 403 and establishes no active org.
   */
  async resolveActiveOrg(userId: string, hints: OrgResolutionHints): Promise<ActiveOrg | null> {
    const org = await this.resolveCandidate(hints);
    if (!org) return null;

    const membership = await this.members.findMembership(org.id, userId);
    if (!membership) return null; // membership gate: no row -> no active org.

    return { id: org.id, slug: org.slug, role: membership.role };
  }

  /** list — members of an org; access is gated upstream by the tenant/role chain. */
  async list(orgId: string): Promise<Membership[]> {
    return this.members.listByOrg(orgId);
  }

  /**
   * assertMember — explicit membership gate for callers outside the middleware.
   * Returns the membership row, or throws 403 if the user is not a member.
   */
  async assertMember(orgId: string, userId: string): Promise<Membership> {
    const membership = await this.members.findMembership(orgId, userId);
    if (!membership) throw new ForbiddenException('not a member of this organization');
    return membership;
  }

  /** Resolve the candidate org from the hints (first match wins); null if none. */
  private async resolveCandidate(hints: OrgResolutionHints): Promise<OrganizationRef | null> {
    if (hints.slug) {
      const bySlug = await this.orgs.findBySlug(hints.slug);
      if (bySlug) return bySlug;
    }
    if (hints.headerId) {
      const byHeader = await this.orgs.findById(hints.headerId);
      if (byHeader) return byHeader;
    }
    if (hints.sessionOrg) {
      const bySession = await this.orgs.findById(hints.sessionOrg);
      if (bySession) return bySession;
    }
    return null;
  }
}
`,
      },
      {
        path: 'src/modules/invitations/invitation.service.ts',
        content: `// src/modules/invitations/invitation.service.ts
// Invitation module for the SaaS starter (overlay code — NOT framework code).
//
// Owns the tokenized-invite lifecycle that MembershipService deliberately leaves
// out (see the note in src/modules/members/membership.service.ts):
//
//   invite(orgId, actorId, email, role)  -> create a tokenized Invitation
//   acceptInvite(token, userId)          -> redeem it into exactly ONE Membership
//
// Authorization rules (the dashboard route chain also enforces these upstream,
// but the service is the source of truth):
//
//   inviter is neither owner nor admin        -> 403 (ForbiddenException)
//   target role is not "admin" | "member"     -> 403 (ForbiddenException)
//   token is expired OR already accepted      -> 410 (Gone)
//   token matches no invitation               -> 404 (NotFoundException)
//
// The invitations table ships in migrations/001_saas.sql
// (id, org_id, email, role, token, expires_at, accepted_at).

import { randomBytes } from 'node:crypto';
import { ForbiddenException, NotFoundException, StreetException } from 'streetjs';

export type Role = 'owner' | 'admin' | 'member';

/** Roles a teammate may be invited with. "owner" is reserved for org creation. */
export type InviteRole = 'admin' | 'member';

/** Invitations live for 168 hours (7 days) from creation. */
export const INVITE_TTL_MS = 168 * 60 * 60 * 1000;

/** streetjs has no 410 helper; raise StreetException with the Gone status. */
class GoneException extends StreetException {
  constructor(message = 'Gone') {
    super(410, message);
  }
}

/** Only "admin" and "member" may be invited; anything else is rejected. */
function isInviteRole(role: string): role is InviteRole {
  return role === 'admin' || role === 'member';
}

export interface Invitation {
  id: string;
  org_id: string;
  email: string;
  role: InviteRole;
  token: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: Role;
}

/** Persistence contract for invitations (satisfied by @streetjs/orm repos). */
export interface InvitationRepository {
  insert(values: {
    org_id: string;
    email: string;
    role: InviteRole;
    token: string;
    expires_at: Date;
  }): Promise<Invitation>;
  /** Look up a single invitation by its unique token, or null. */
  findByToken(token: string): Promise<Invitation | null>;
  /** Stamp accepted_at = when for the invitation id. */
  markAccepted(id: string, when: Date): Promise<void>;
}

/**
 * Membership persistence + the inviter role gate. createMembership creates the
 * single membership an accepted invite grants; findMembership backs the
 * owner/admin gate on invite().
 */
export interface MembershipWriteRepository {
  findMembership(orgId: string, userId: string): Promise<Membership | null>;
  createMembership(values: { org_id: string; user_id: string; role: Role }): Promise<Membership>;
}

/** Optional audit hook — appends a privileged-action entry on invite/accept. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

export class InvitationService {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipWriteRepository,
    private readonly audit?: AuditAppender,
  ) {}

  /**
   * invite — create a tokenized Invitation for a teammate.
   *
   * Only an owner or admin of the org may invite (403 otherwise), and only the
   * roles "admin" or "member" may be targeted (403 for any other value). The
   * invitation carries a 256-bit unique token and an expiry 168h (7 days) out.
   */
  async invite(orgId: string, actorId: string, email: string, role: string): Promise<Invitation> {
    // Role gate: reject unrecognized / non-invitable roles with 403.
    if (!isInviteRole(role)) {
      throw new ForbiddenException('role must be "admin" or "member"');
    }

    // Inviter gate: the actor must be an owner or admin of this org.
    const actor = await this.memberships.findMembership(orgId, actorId);
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      throw new ForbiddenException('only an owner or admin may invite members');
    }

    const token = randomBytes(32).toString('base64url'); // unique invite token
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invitation = await this.invitations.insert({
      org_id: orgId,
      email,
      role,
      token,
      expires_at: expiresAt,
    });

    await this.audit?.append(actorId, 'member.invite', invitation.id, { email, role });

    return invitation;
  }

  /**
   * acceptInvite — redeem a token into exactly ONE membership.
   *
   * An unknown token is a 404; an expired or already-accepted token is a 410 and
   * creates no membership. On success a single membership is created with the
   * invited role and the invitation's accepted_at is stamped.
   */
  async acceptInvite(token: string, userId: string): Promise<Membership> {
    const invitation = await this.invitations.findByToken(token);
    if (!invitation) {
      throw new NotFoundException('invitation not found');
    }

    if (invitation.accepted_at) {
      throw new GoneException('invitation already accepted');
    }
    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw new GoneException('invitation expired');
    }

    // Exactly one membership is created for the invited role...
    const membership = await this.memberships.createMembership({
      org_id: invitation.org_id,
      user_id: userId,
      role: invitation.role,
    });

    // ...and the invitation is stamped so it cannot be redeemed again (410).
    await this.invitations.markAccepted(invitation.id, new Date());

    await this.audit?.append(userId, 'member.accept_invite', invitation.id, {
      org_id: invitation.org_id,
      role: invitation.role,
    });

    return membership;
  }
}
`,
      },
      {
        path: 'src/modules/apikeys/apikey.service.ts',
        content: `// src/modules/apikeys/apikey.service.ts
// API key module for the SaaS starter (overlay code — NOT framework code).
//
// Keys are HASHED AT REST: only a display \`prefix\` and the SHA-256 hash of the
// secret are persisted. The full plaintext key is returned EXACTLY ONCE from
// create() and is unrecoverable thereafter — it never touches the database.
//
//   plaintext = prefix + "." + secret      (shown once, e.g. "sk_live_AB12.<secret>")
//   stored    = { prefix, key_hash: SHA256(secret) }   (never the plaintext)

import { createHash, randomBytes } from 'node:crypto';

export type Scope = string;

/** A persisted API key row. \`key_hash\` is the SHA-256 of the secret. */
export interface ApiKeyRow {
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

/**
 * Public metadata view of an API key. By construction this NEVER includes
 * \`key_hash\` or the plaintext secret — only safe-to-display fields.
 */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

/** Persistence contract the service relies on (satisfied by @streetjs/orm repos). */
export interface ApiKeyRepository {
  insert(values: {
    org_id: string;
    created_by: string;
    name: string;
    prefix: string;
    key_hash: string;
    scopes: Scope[];
    expires_at: Date | null;
  }): Promise<ApiKeyRow>;
  /** Look up a single key by the SHA-256 hash of its secret (UNIQUE). */
  findByHash(keyHash: string): Promise<ApiKeyRow | null>;
  /** All keys for an org (including revoked), newest first. */
  listByOrg(orgId: string): Promise<ApiKeyRow[]>;
  /** Stamp last_used_at = now() for a verified key. */
  touchLastUsed(id: string, when: Date): Promise<void>;
  /** Set revoked_at = now() for a key scoped to org_id; no-op if absent. */
  setRevoked(orgId: string, keyId: string, when: Date): Promise<void>;
}

/** Optional audit hook — appends a privileged-action entry on create/revoke. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/** SHA-256 hex digest of an input string. */
function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Strip the display prefix, returning the secret portion after the first dot. */
function extractSecret(rawKey: string): string {
  const dot = rawKey.indexOf('.');
  return dot >= 0 ? rawKey.slice(dot + 1) : rawKey;
}

export class ApiKeyService {
  constructor(
    private readonly repo: ApiKeyRepository,
    private readonly audit?: AuditAppender,
    /** Environment label embedded in the prefix (e.g. "live", "test"). */
    private readonly environment: string = process.env['NODE_ENV'] === 'production' ? 'live' : 'test',
  ) {}

  /**
   * create — mint a new API key.
   *
   * A 256-bit random secret is generated; only the display \`prefix\` and the
   * SHA-256 hash of the secret are stored. The full plaintext (prefix + "." +
   * secret) is returned ONCE and never persisted, so it is unrecoverable from
   * stored data.
   */
  async create(
    orgId: string,
    actorId: string,
    input: { name: string; scopes: Scope[]; expiresAt?: Date },
  ): Promise<{ id: string; plaintext: string }> {
    const secret = randomBytes(32).toString('base64url');
    const prefix = 'sk_' + this.environment + '_' + secret.slice(0, 4);
    const keyHash = sha256(secret);

    const row = await this.repo.insert({
      org_id: orgId,
      created_by: actorId,
      name: input.name,
      prefix,
      key_hash: keyHash,
      scopes: input.scopes,
      expires_at: input.expiresAt ?? null,
    });

    await this.audit?.append(actorId, 'apikey.create', row.id, { name: input.name });

    // Plaintext is returned exactly once; only prefix + key_hash live in the DB.
    return { id: row.id, plaintext: prefix + '.' + secret };
  }

  /**
   * verify — authenticate a raw key presented on a request.
   *
   * The secret is recovered from the raw key, hashed, and looked up. Returns
   * null for unknown, revoked, or expired keys. On success, last_used_at is
   * stamped and the owning org + granted scopes are returned.
   */
  async verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null> {
    if (!rawKey) return null;

    const secret = extractSecret(rawKey);
    if (!secret) return null;

    const row = await this.repo.findByHash(sha256(secret));
    if (!row || row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;

    await this.repo.touchLastUsed(row.id, new Date());

    return { orgId: row.org_id, scopes: row.scopes };
  }

  /**
   * list — metadata for every key in an org. The returned views NEVER include
   * \`key_hash\` or the plaintext secret.
   */
  async list(orgId: string): Promise<ApiKeyView[]> {
    const rows = await this.repo.listByOrg(orgId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes,
      last_used_at: r.last_used_at,
      expires_at: r.expires_at,
      revoked_at: r.revoked_at,
      created_at: r.created_at,
    }));
  }

  /**
   * revoke — mark a key revoked. The key is scoped to org_id so one tenant
   * cannot revoke another's keys. Sets revoked_at = now(); subsequent verify
   * calls for the key return null.
   */
  async revoke(orgId: string, actorId: string, keyId: string): Promise<void> {
    await this.repo.setRevoked(orgId, keyId, new Date());
    await this.audit?.append(actorId, 'apikey.revoke', keyId);
  }
}
`,
      },
      {
        path: 'src/middleware/apiKeyAuth.ts',
        content: `// src/middleware/apiKeyAuth.ts
// API-key authentication for the SaaS starter (overlay code — NOT framework code).
//
// Authenticates requests presenting an X-API-Key header by delegating the hash
// lookup, revocation, and expiry checks to ApiKeyService.verify (see
// src/modules/apikeys/apikey.service.ts). On success the request is scoped to
// the key's organization and limited to the key's scopes:
//
//   missing / empty / unknown / revoked / expired key -> 401 (UnauthorizedException)
//   valid key lacking a required scope                 -> 403 (ForbiddenException)
//   valid key                                          -> ctx.org + ctx.scopes set
//
// This middleware guards the /api/v1/* routes (see the route table in
// design.md); session/CSRF auth + tenantResolver guard the browser dashboard.

import {
  ForbiddenException,
  UnauthorizedException,
  type MiddlewareFn,
  type StreetContext,
} from 'streetjs';

export type Scope = string;

/**
 * Minimal contract apiKeyAuth needs from the API key module. Satisfied by
 * ApiKeyService.verify (task 3.2), which performs the hash lookup, rejects
 * revoked/expired/unknown keys by returning null, and stamps last_used_at on a
 * successful verification.
 */
export interface ApiKeyVerifier {
  verify(rawKey: string): Promise<{ orgId: string; scopes: Scope[] } | null>;
}

/** Options controlling which scopes a guarded route requires of the key. */
export interface ApiKeyAuthOptions {
  // Scopes the presented key MUST hold for the guarded route. A request whose
  // key is missing any required scope is denied with 403. Omitted/empty means
  // the route is scope-agnostic (any valid key is accepted).
  requiredScopes?: Scope[];
}

/**
 * scopeSatisfied — true when the granted scopes cover requiredScope.
 *
 * A scope is granted by an exact match, by the global wildcard '*', or by a
 * segment wildcard such as 'billing:*' covering 'billing:read'.
 */
function scopeSatisfied(granted: Scope[], requiredScope: Scope): boolean {
  for (const g of granted) {
    if (g === requiredScope || g === '*') return true;
    if (g.endsWith(':*') && requiredScope.startsWith(g.slice(0, -1))) return true;
  }
  return false;
}

/**
 * apiKeyAuth — authenticate an X-API-Key request and scope it to the key's org.
 *
 * Returns 401 when the header is missing or empty, or when the key is unknown,
 * revoked, or expired (verify returns null for those three). On success it sets
 * ctx.org to the key's organization and limits ctx.scopes to the key's scopes;
 * if the route declares requiredScopes the key must hold them all, otherwise the
 * request is denied with 403.
 */
export function apiKeyAuth(
  deps: { keys: ApiKeyVerifier },
  options: ApiKeyAuthOptions = {},
): MiddlewareFn {
  const requiredScopes = options.requiredScopes ?? [];

  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    // Missing or empty X-API-Key header -> 401.
    const rawKey = ctx.headers?.['x-api-key'];
    if (!rawKey) throw new UnauthorizedException('missing API key');

    // verify() returns null for unknown, revoked, or expired keys -> 401.
    const result = await deps.keys.verify(rawKey);
    if (!result) throw new UnauthorizedException('invalid API key');

    // Scope the request to the key's org and limit it to the key's scopes.
    ctx.org = { id: result.orgId };
    ctx.scopes = result.scopes;

    // Deny when the route requires a scope the key does not hold -> 403.
    for (const required of requiredScopes) {
      if (!scopeSatisfied(result.scopes, required)) {
        throw new ForbiddenException('insufficient scope: ' + required);
      }
    }

    await next();
  };
}
`,
      },
      {
        path: 'src/types/street-saas.d.ts',
        content: `// src/types/street-saas.d.ts
// Ambient type augmentation for the SaaS starter overlay (overlay code — NOT framework code).
//
// The overlay's middleware and controllers attach request-scoped context that the
// framework's core \`StreetContext\` does not declare on its own:
//   • ctx.org    — the active organization, set by tenantResolver (full {id, slug, role})
//                  or by apiKeyAuth (id only, for /api/v1 key-authenticated requests).
//   • ctx.scopes — the API-key scopes, set by apiKeyAuth.
//   • ctx.htmx   — the htmx view helpers attached at runtime by @streetjs/plugin-htmx
//                  (HtmxPlugin.middleware in src/main.ts — see SAAS.md wiring).
//
// They are merged into the framework's StreetContext via module augmentation. The
// shapes are kept STRUCTURAL (no plugin import) so the overlay type-checks even
// before the optional htmx/admin-ui plugins are installed.

/** Active organization attached to the request context (full from tenantResolver,
 *  id-only from apiKeyAuth). */
export interface SaasActiveOrg {
  id: string;
  slug?: string;
  role?: 'owner' | 'admin' | 'member';
}

/** Minimal structural shape of the htmx helpers the dashboard overlay consumes. */
export interface SaasHtmxHelpers {
  /** Render a full page/view from a template with the given data. */
  view(template: string, data?: Record<string, unknown>, status?: number): void;
  /** The underlying view engine; \`partial\` renders a fragment to a string. */
  engine: { partial(template: string, data?: Record<string, unknown>): string };
}

declare module 'streetjs' {
  interface StreetContext {
    /** Active organization resolved by tenantResolver / apiKeyAuth (overlay). */
    org?: SaasActiveOrg;
    /** API-key scopes attached by apiKeyAuth (overlay). */
    scopes?: string[];
    /** htmx view helpers attached by @streetjs/plugin-htmx middleware. */
    htmx: SaasHtmxHelpers;
  }
}
`,
      },
      {
        path: 'src/modules/settings/settings.service.ts',
        content: `// src/modules/settings/settings.service.ts
// Settings module for the SaaS starter (overlay code — NOT framework code).
//
// Stores at most ONE value per (scope, key), where scope is either an
// organization or a user. Reads of a missing (scope, key) return a no-value
// indication (null) WITHOUT creating a row. Writes upsert the single row for
// that (scope, key), replacing the prior value in place and leaving every other
// scope/key untouched. The uniqueness is enforced in the schema by
// UNIQUE(org_id, key) / UNIQUE(user_id, key) (see migrations/003_settings.sql).
//
// Validation: a key longer than 255 characters, or a value that is not valid
// JSON, is rejected and leaves any existing stored value unchanged.

/** Maximum allowed length, in characters, of a settings key. */
export const MAX_SETTINGS_KEY_LENGTH = 255;

/** Thrown when a write is rejected for an invalid key or non-JSON value. */
export class InvalidSettingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidSettingError';
  }
}

/** A persisted settings row for either scope. */
export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * Persistence contract the service relies on (satisfied by @streetjs/orm repos).
 * Implementations MUST enforce one row per (scope, key) — upsert replaces the
 * existing row's value in place rather than inserting a duplicate.
 */
export interface SettingsRepository {
  /** Read the org-scoped value for a key, or null if no row exists. */
  getOrg(orgId: string, key: string): Promise<SettingRow | null>;
  /** Upsert the single org-scoped row for (orgId, key), replacing value in place. */
  upsertOrg(orgId: string, key: string, value: unknown): Promise<void>;
  /** Read the user-scoped value for a key, or null if no row exists. */
  getUser(userId: string, key: string): Promise<SettingRow | null>;
  /** Upsert the single user-scoped row for (userId, key), replacing value in place. */
  upsertUser(userId: string, key: string, value: unknown): Promise<void>;
}

/** Optional audit hook — appends a privileged-action entry on org-scoped writes. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/**
 * Validate a settings key. Rejects keys longer than 255 characters.
 * Throws before any persistence runs, so an existing value is left unchanged.
 */
function assertValidKey(key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidSettingError('settings key must be a non-empty string');
  }
  if (key.length > MAX_SETTINGS_KEY_LENGTH) {
    throw new InvalidSettingError(
      'settings key exceeds ' + MAX_SETTINGS_KEY_LENGTH + ' characters',
    );
  }
}

/**
 * Validate that a value is representable as JSON (it is stored in a JSONB
 * column). Rejects values that JSON cannot encode — undefined, functions,
 * symbols, BigInt, and circular structures. Throws before persistence, so an
 * existing value is left unchanged.
 */
function assertJsonValue(value: unknown): void {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new InvalidSettingError('settings value is not valid JSON');
  }
  // JSON.stringify returns undefined for undefined / functions / symbols.
  if (encoded === undefined) {
    throw new InvalidSettingError('settings value is not valid JSON');
  }
}

export class SettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly audit?: AuditAppender,
  ) {}

  /**
   * getOrg — read an org-scoped setting. Returns null (no-value indication)
   * when no row exists for (orgId, key); never creates a row.
   */
  async getOrg(orgId: string, key: string): Promise<unknown | null> {
    const row = await this.repo.getOrg(orgId, key);
    return row ? row.value : null;
  }

  /**
   * setOrg — write an org-scoped setting. Validates the key and value first
   * (rejecting without touching storage), then upserts the single (orgId, key)
   * row, replacing the prior value in place and leaving all other rows intact.
   */
  async setOrg(orgId: string, actorId: string, key: string, value: unknown): Promise<void> {
    assertValidKey(key);
    assertJsonValue(value);
    await this.repo.upsertOrg(orgId, key, value);
    await this.audit?.append(actorId, 'settings.set', 'org:' + orgId + ':' + key, { key });
  }

  /**
   * getUser — read a user-scoped setting. Returns null (no-value indication)
   * when no row exists for (userId, key); never creates a row.
   */
  async getUser(userId: string, key: string): Promise<unknown | null> {
    const row = await this.repo.getUser(userId, key);
    return row ? row.value : null;
  }

  /**
   * setUser — write a user-scoped setting. Validates the key and value first
   * (rejecting without touching storage), then upserts the single (userId, key)
   * row, replacing the prior value in place and leaving all other rows intact.
   */
  async setUser(userId: string, key: string, value: unknown): Promise<void> {
    assertValidKey(key);
    assertJsonValue(value);
    await this.repo.upsertUser(userId, key, value);
  }
}
`,
      },
      {
        path: 'src/modules/audit/audit.service.ts',
        content: `// src/modules/audit/audit.service.ts
// Audit-log module for the SaaS starter (overlay code — NOT framework code).
//
// Audit logs are APPEND-ONLY: a privileged mutation appends exactly one row,
// and existing rows are never updated or deleted. Each entry records the acting
// organization (org_id), the actor (actor_id), the action, the target, and a
// created_at timestamp (see migrations/001_saas.sql -> audit_logs).
//
// TRANSACTIONAL WRITES: the audit row is appended in the SAME transaction as
// the privileged mutation it records (member invite/remove, role change, key
// create/revoke, billing change). If the audit append fails, the whole
// transaction rolls back so the mutation is undone and organization state is
// left unchanged (Requirements 6.1, 6.2).
//
// VIEWER: only an owner or admin may read an org's audit log. Results are
// org-scoped, ordered created_at DESC, and paged at no more than 100 entries
// per request (Requirements 6.3, 6.4). Any attempt to update or delete an
// existing row is rejected and the row is preserved (Requirement 6.5).

import { ForbiddenException } from 'streetjs';

/** Maximum number of audit entries returned by a single viewer request. */
export const AUDIT_PAGE_MAX = 100;

/** Membership roles relevant to audit viewing. */
export type AuditViewerRole = 'owner' | 'admin' | 'member';

/** A persisted audit_logs row. */
export interface AuditLogRow {
  id: string;
  org_id: string;
  actor_id: string;
  action: string;
  target: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

/** Public view of an audit entry (same columns; no hidden fields). */
export interface AuditView {
  id: string;
  org_id: string;
  actor_id: string;
  action: string;
  target: string;
  meta: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Opaque transaction handle. The concrete type is supplied by the data layer
 * (@streetjs/orm); the audit module only forwards it to the repository so the
 * mutation and its audit row share one transaction.
 */
export type Tx = unknown;

/**
 * Unit-of-work contract that runs a function inside a single transaction and
 * rolls back if it throws. Satisfied by @streetjs/orm's transaction helper.
 */
export interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Append-only persistence contract for audit_logs. It deliberately exposes NO
 * update or delete method — an audit row is immutable once written.
 */
export interface AuditRepository {
  /** Insert exactly one audit row within the given transaction. */
  appendInTx(
    tx: Tx,
    values: {
      org_id: string;
      actor_id: string;
      action: string;
      target: string;
      meta: Record<string, unknown> | null;
    },
  ): Promise<AuditLogRow>;
  /**
   * List an org's audit rows, newest first. The repository MUST filter by
   * org_id, order by created_at DESC, and honor the limit (<= AUDIT_PAGE_MAX).
   * \`before\` pages backwards from a created_at cursor when provided.
   */
  listByOrg(
    orgId: string,
    opts: { limit: number; before?: string },
  ): Promise<AuditLogRow[]>;
}

/**
 * The audit-write contract consumed by the other starter services
 * (ApiKeyService, SettingsService, MembershipService, BillingService). It
 * matches their AuditAppender interface exactly:
 * append(actorId, action, target, meta?).
 */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/** Clamp a requested page size into [1, AUDIT_PAGE_MAX]. */
function clampLimit(requested?: number): number {
  if (!requested || requested < 1) return AUDIT_PAGE_MAX;
  return Math.min(requested, AUDIT_PAGE_MAX);
}

function toView(row: AuditLogRow): AuditView {
  return {
    id: row.id,
    org_id: row.org_id,
    actor_id: row.actor_id,
    action: row.action,
    target: row.target,
    meta: row.meta,
    created_at: row.created_at,
  };
}

export class AuditService {
  constructor(
    private readonly repo: AuditRepository,
    private readonly uow: UnitOfWork,
  ) {}

  /**
   * record — run a privileged mutation and append exactly ONE audit row in the
   * SAME transaction.
   *
   * The mutation receives the active transaction and an AuditAppender bound to
   * that transaction and to the acting org; it MUST call append(...) once to
   * record what changed. Because the mutation and the audit insert share
   * uow.transaction, a failure in either (including the audit append) rolls the
   * whole transaction back, leaving organization state unchanged
   * (Requirements 6.1, 6.2).
   */
  async record<T>(
    context: { orgId: string },
    mutation: (tx: Tx, audit: AuditAppender) => Promise<T>,
  ): Promise<T> {
    return this.uow.transaction(async (tx) => {
      const audit = this.appenderFor(context.orgId, tx);
      return mutation(tx, audit);
    });
  }

  /**
   * appenderFor — build an AuditAppender that writes to audit_logs for \`orgId\`
   * inside transaction \`tx\`. Use this when a caller already owns a transaction
   * and wants the audit row written within it. The returned appender appends
   * exactly one row per call; a failed insert propagates so the surrounding
   * transaction rolls back.
   */
  appenderFor(orgId: string, tx: Tx): AuditAppender {
    const repo = this.repo;
    return {
      async append(
        actorId: string,
        action: string,
        target: string,
        meta?: Record<string, unknown>,
      ): Promise<void> {
        await repo.appendInTx(tx, {
          org_id: orgId,
          actor_id: actorId,
          action,
          target,
          meta: meta ?? null,
        });
      },
    };
  }

  /**
   * list — read an organization's audit log.
   *
   * Only an owner or admin may read; any other role is denied with 403 and no
   * entries are returned (Requirement 6.4). Results are org-scoped, ordered
   * created_at DESC by the repository, and capped at AUDIT_PAGE_MAX (100)
   * entries per page (Requirement 6.3).
   */
  async list(
    viewer: { orgId: string; role: AuditViewerRole },
    opts: { limit?: number; before?: string } = {},
  ): Promise<AuditView[]> {
    if (viewer.role !== 'owner' && viewer.role !== 'admin') {
      throw new ForbiddenException('audit log requires owner or admin');
    }
    const rows = await this.repo.listByOrg(viewer.orgId, {
      limit: clampLimit(opts.limit),
      before: opts.before,
    });
    return rows.map(toView);
  }

  /**
   * update — audit logs are append-only; updating an existing row is always
   * rejected and the row is left unchanged (Requirement 6.5).
   */
  async update(): Promise<never> {
    throw new ForbiddenException('audit logs are append-only and cannot be updated');
  }

  /**
   * remove — audit logs are append-only; deleting an existing row is always
   * rejected and the row is preserved (Requirement 6.5).
   */
  async remove(): Promise<never> {
    throw new ForbiddenException('audit logs are append-only and cannot be deleted');
  }
}
`,
      },
      {
        path: 'src/modules/billing/billing.service.ts',
        content: `// src/modules/billing/billing.service.ts
// Stripe billing module for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-billing\` (composes @streetjs/plugin-stripe; install-on-demand).
//
// handleEvent() applies a verified Stripe event to the subscriptions table:
//
//   checkout.session.completed | customer.subscription.updated |
//   customer.subscription.deleted   -> UPSERT exactly one subscriptions row
//                                       (plan, status, stripe_customer_id,
//                                       current_period_end) and RECORD the event
//                                       id as processed, in ONE transaction.
//   any other event type             -> no-op (the controller returns 200).
//
// IDEMPOTENCY (Requirement 4.1): the event id is recorded in a processed-event
// store inside the SAME transaction as the upsert. Re-processing an event id
// already recorded is skipped, so the subscriptions state is identical to
// processing the event exactly once.
//
// ATOMIC ROLLBACK (Requirement 4.5): the upsert and the processed-event record
// share uow.transaction(); if either persist fails the whole transaction rolls
// back — the subscriptions row is left unchanged and the event id is NOT
// recorded — and the error propagates so the controller returns 500 and Stripe
// retries delivery.
//
// NOTE — processed-event store: there is no migration for it in this starter
// (001/002/003 are untouched). It is modelled here as the ProcessedEventStore
// contract below; the app wires up an implementation (e.g. a small
// \`stripe_events(event_id PRIMARY KEY, processed_at)\` table or the core KV
// store) when enabling billing.

/** The event types this service applies to the subscriptions table. */
export const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

/** A verified Stripe event (as returned by StripeClient.verify). */
export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** The single subscriptions row shape this service upserts (one row per org). */
export interface SubscriptionUpsert {
  org_id: string;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  current_period_end: string | null;
}

/** A persisted subscriptions row. */
export interface SubscriptionRow extends SubscriptionUpsert {
  id: string;
}

/** Outcome of handleEvent, so the controller can stay a thin HTTP translator. */
export type BillingEventOutcome =
  | { applied: true; orgId: string }            // upserted + recorded   -> 200
  | { applied: false; reason: 'duplicate' }     // already processed     -> 200
  | { applied: false; reason: 'ignored' };      // unhandled event type  -> 200

/**
 * Opaque transaction handle supplied by the data layer (@streetjs/orm); the
 * billing module only forwards it so the upsert and the processed-event record
 * share one transaction.
 */
export type Tx = unknown;

/** Unit-of-work contract that runs work in one transaction, rolling back on throw. */
export interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/**
 * Idempotency store for Stripe event ids. Both methods run inside the caller's
 * transaction so recording the id rolls back with the upsert on failure. There
 * is no migration for this store (see header note) — the app supplies an
 * implementation when billing is enabled.
 */
export interface ProcessedEventStore {
  /** True if this event id was already recorded as processed. */
  hasProcessed(tx: Tx, eventId: string): Promise<boolean>;
  /** Record this event id as processed within the given transaction. */
  recordProcessed(tx: Tx, eventId: string): Promise<void>;
}

/** Persistence contract for subscriptions (satisfied by @streetjs/orm repos). */
export interface SubscriptionRepository {
  /** Upsert the single subscriptions row for an org within the transaction. */
  upsertInTx(tx: Tx, values: SubscriptionUpsert): Promise<void>;
  /** Read the subscriptions row for an org, or null if none exists. */
  getByOrg(orgId: string): Promise<SubscriptionRow | null>;
}

/** Optional audit hook — appends a privileged-action entry on each applied event. */
export interface AuditAppender {
  append(actorId: string, action: string, target: string, meta?: Record<string, unknown>): Promise<void>;
}

/** Read a string-ish field from a loosely-typed Stripe object, or null. */
function str(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Convert a Stripe unix timestamp (seconds) to an ISO string, or null. */
function unixToIso(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === 'number' && Number.isFinite(v)
    ? new Date(v * 1000).toISOString()
    : null;
}

/**
 * mapEventToSubscription — derive the single subscriptions row from a verified
 * event. org_id is taken from the object metadata (Stripe \`metadata.org_id\`) or
 * \`client_reference_id\` (set when creating the checkout session). A deletion
 * event is normalised to status \`canceled\`.
 */
export function mapEventToSubscription(event: StripeEvent): SubscriptionUpsert {
  const obj = event.data.object;
  const metadata = (obj['metadata'] as Record<string, unknown> | undefined) ?? {};

  const orgId = str(metadata, 'org_id') ?? str(obj, 'client_reference_id');
  if (!orgId) {
    throw new Error('Stripe event is missing org_id (metadata.org_id or client_reference_id)');
  }

  const status =
    event.type === 'customer.subscription.deleted'
      ? 'canceled'
      : str(obj, 'status') ?? 'active';

  return {
    org_id: orgId,
    plan: str(metadata, 'plan') ?? str(obj, 'plan') ?? 'free',
    status,
    stripe_customer_id: str(obj, 'customer'),
    current_period_end: unixToIso(obj, 'current_period_end'),
  };
}

export class BillingService {
  constructor(
    private readonly repo: SubscriptionRepository,
    private readonly events: ProcessedEventStore,
    private readonly uow: UnitOfWork,
    private readonly audit?: AuditAppender,
  ) {}

  /** True for the three subscription-affecting event types. */
  private isHandled(type: string): type is HandledEventType {
    return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
  }

  /**
   * handleEvent — apply a VERIFIED Stripe event.
   *
   * Unhandled event types are ignored (the controller returns 200). For the
   * three handled types, the upsert and the processed-event record run in one
   * transaction: a duplicate event id is skipped (idempotent, 200); a fresh
   * event upserts exactly one subscriptions row and records its id (200). Any
   * persist failure rolls the transaction back and propagates, so nothing is
   * changed and the id is not recorded (controller returns 500).
   */
  async handleEvent(event: StripeEvent): Promise<BillingEventOutcome> {
    if (!this.isHandled(event.type)) {
      return { applied: false, reason: 'ignored' };
    }

    const sub = mapEventToSubscription(event);

    return this.uow.transaction(async (tx) => {
      // Idempotency guard — checked inside the tx so it rolls back with the upsert.
      if (await this.events.hasProcessed(tx, event.id)) {
        return { applied: false, reason: 'duplicate' };
      }

      await this.repo.upsertInTx(tx, sub);
      await this.events.recordProcessed(tx, event.id);
      await this.audit?.append('system', 'billing.' + event.type, sub.org_id, { id: event.id });

      return { applied: true, orgId: sub.org_id };
    });
  }

  /** getSubscription — read the current subscription state for an org. */
  async getSubscription(orgId: string): Promise<SubscriptionRow | null> {
    return this.repo.getByOrg(orgId);
  }
}
`,
      },
      {
        path: 'src/modules/billing/billing.controller.ts',
        flag: 'with-billing',
        content: `// src/modules/billing/billing.controller.ts
// Stripe webhook controller for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-billing\` (composes @streetjs/plugin-stripe; install-on-demand).
//
//   POST /webhooks/stripe
//
// SECURITY (Requirements 4.2, 4.3, 4.7): this route is intentionally exempt from
// CSRF validation and tenant scoping — it is authenticated SOLELY by Stripe
// signature verification against STRIPE_WEBHOOK_SECRET. Register it OUTSIDE the
// csrfMiddleware / tenantResolver chain and behind a RAW-BODY parser that leaves
// the request body unmodified (do NOT parse-then-reserialize), exposing it as
// \`ctx.state.rawBody\`. Signature verification is delegated to the official
// @streetjs/plugin-stripe StripeClient.verify with a 300-second tolerance — it
// is NOT reimplemented here.
//
//   bad / expired (>300s) signature  -> 400, no state change, id not recorded
//   verified, handled event          -> 200 (upsert applied or idempotent skip)
//   verified, other event type       -> 200 (no-op)
//   persist failure                  -> 500 (rolled back; Stripe retries)

import { StripeClient, validateStripeConfig } from '@streetjs/plugin-stripe';
import { BadRequestException, type StreetContext } from 'streetjs';
import type { BillingService, StripeEvent } from './billing.service.js';

/** The 300-second timestamp tolerance mandated for Stripe signatures. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Signature verifier contract. The official StripeClient from
 * @streetjs/plugin-stripe satisfies this: verify(rawBody, signature, secret,
 * opts) returns the typed event or throws on a bad/expired signature. Injecting
 * it as an interface keeps the controller composable and testable without
 * reimplementing any cryptography.
 */
export interface StripeWebhookVerifier {
  verify(
    rawBody: string,
    signature: string,
    secret: string,
    opts?: { tolerance?: number },
  ): StripeEvent | Promise<StripeEvent>;
}

/**
 * rawBodyOf — return the UNMODIFIED request body for signature verification.
 *
 * A raw-body middleware on the webhook route must capture the bytes verbatim
 * into ctx.state.rawBody before any JSON parsing. We never use the parsed
 * ctx.body here, because re-serialising it would change the bytes and break the
 * signature check.
 */
function rawBodyOf(ctx: StreetContext): string {
  const captured = ctx.state['rawBody'];
  if (typeof captured === 'string') return captured;
  if (captured instanceof Buffer) return captured.toString('utf8');
  throw new BadRequestException('missing raw body for Stripe signature verification');
}

/**
 * defaultVerifier — build a StripeWebhookVerifier from the official plugin's
 * StripeClient using validated config. Composed by default; tests may inject a
 * stub verifier instead.
 */
export function defaultVerifier(): StripeWebhookVerifier {
  const config = validateStripeConfig({ apiKey: process.env['STRIPE_SECRET_KEY'] ?? '' });
  return new StripeClient(config) as unknown as StripeWebhookVerifier;
}

export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly deps: {
      verifier?: StripeWebhookVerifier;
      webhookSecret?: string;
    } = {},
  ) {}

  /**
   * webhook — handle POST /webhooks/stripe.
   *
   * Verifies the signature against STRIPE_WEBHOOK_SECRET on the unmodified raw
   * body with a 300s tolerance (400 on failure, no state change), then applies
   * the event via BillingService.handleEvent (200 on success/idempotent skip/
   * unhandled type). A persist failure inside handleEvent propagates and is
   * mapped to 500 so Stripe retries.
   */
  async webhook(ctx: StreetContext): Promise<void> {
    const secret = this.deps.webhookSecret ?? process.env['STRIPE_WEBHOOK_SECRET'] ?? '';
    const verifier = this.deps.verifier ?? defaultVerifier();
    const signature = ctx.headers['stripe-signature'] ?? '';

    // ── Signature verification (delegated; 400 on any failure) ──────────────
    let event: StripeEvent;
    try {
      const rawBody = rawBodyOf(ctx);
      event = await verifier.verify(rawBody, signature, secret, {
        tolerance: STRIPE_SIGNATURE_TOLERANCE_SECONDS,
      });
    } catch {
      // Bad signature, expired timestamp (>300s), or missing raw body. No
      // subscriptions row is touched and no event id is recorded.
      ctx.json({ error: 'invalid signature' }, 400);
      return;
    }

    // ── Apply the verified event (500 on persist failure -> Stripe retries) ──
    try {
      await this.billing.handleEvent(event);
      ctx.json({ received: true }, 200);
    } catch {
      ctx.json({ error: 'processing failed' }, 500);
    }
  }
}
`,
      },
      {
        path: 'src/modules/notifications/notification.service.ts',
        content: `// src/modules/notifications/notification.service.ts
// Notifications module for the SaaS starter (overlay code — NOT framework code).
//
// IN-APP FIRST: notify() persists a single \`notifications\` row (user_id, type,
// payload JSONB, created_at, with read_at null) BEFORE attempting any email. If
// that persist fails, no email is sent and an error is thrown indicating the
// notification could not be created — there is no partial row to clean up
// because nothing was written (Requirements 8.1, 8.2).
//
// EMAIL (optional): email delivery composes @streetjs/plugin-sendgrid and is
// gated behind \`--with-email\` (install-on-demand, documented convention — see
// SAAS.md, mirroring how billing gates @streetjs/plugin-stripe behind
// \`--with-billing\`). When no Mailer is wired the in-app notification still
// persists and email is simply skipped. When email IS enabled for a
// notification, each attempt is bounded by a 30s timeout; on failure delivery
// is retried up to EMAIL_MAX_RETRIES times. The persisted row is always
// retained, and after the final failed attempt a delivery-failure indication is
// recorded (Requirements 8.3, 8.4).
//
// READ SEMANTICS: listUnread() returns only the requesting user's rows whose
// read_at is null, newest first, capped at MAX_UNREAD_NOTIFICATIONS (100).
// markRead() stamps read_at once and is idempotent if already read; marking a
// notification that does not exist or is not owned by the user changes nothing
// and raises NotFoundException (Requirements 8.5, 8.6, 8.7).

import { InternalException, NotFoundException } from 'streetjs';

/** Maximum number of unread notifications returned by a single request. */
export const MAX_UNREAD_NOTIFICATIONS = 100;

/** Per-attempt email delivery timeout, in milliseconds (Requirement 8.4). */
export const EMAIL_TIMEOUT_MS = 30_000;

/** Number of additional delivery attempts after the first one (Requirement 8.4). */
export const EMAIL_MAX_RETRIES = 3;

/** A persisted notifications row. */
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
}

/** Options accepted by notify(). */
export interface NotifyOptions {
  /** When true (and a Mailer is wired), also deliver the notification by email. */
  email?: boolean;
}

/**
 * Persistence contract (satisfied by @streetjs/orm repos). The in-app row is
 * the source of truth; email is best-effort on top of it.
 */
export interface NotificationsRepository {
  /**
   * Insert exactly one notifications row with read_at null and a created_at
   * timestamp, returning the persisted row. A failure here means NO row was
   * written (Requirements 8.1, 8.2).
   */
  insert(values: { user_id: string; type: string; payload: Record<string, unknown> | null }): Promise<Notification>;
  /**
   * Return the user's unread rows (read_at null), ordered created_at DESC, with
   * at most \`limit\` rows. MUST filter by user_id and honor the limit
   * (Requirement 8.5).
   */
  listUnread(userId: string, limit: number): Promise<Notification[]>;
  /** Look up a notification by id scoped to its owner; null if absent/not owned. */
  findOwned(userId: string, id: string): Promise<Notification | null>;
  /** Stamp read_at for the user's notification. Only called when not already read. */
  markRead(userId: string, id: string, readAt: string): Promise<void>;
  /** Record that email delivery failed for a persisted row (Requirement 8.4). */
  recordDeliveryFailure(id: string): Promise<void>;
}

/** Resolves a user's registered email address for delivery (Requirement 8.3). */
export interface UserEmailLookup {
  emailForUser(userId: string): Promise<string | null>;
}

/**
 * Email transport contract, satisfied by @streetjs/plugin-sendgrid when the
 * project is scaffolded with \`--with-email\`. Left undefined otherwise, in which
 * case email is skipped and the in-app notification still persists.
 */
export interface Mailer {
  send(message: { to: string; type: string; payload: Record<string, unknown> | null }): Promise<void>;
}

export class NotificationService {
  constructor(
    private readonly repo: NotificationsRepository,
    private readonly mailer?: Mailer,
    private readonly users?: UserEmailLookup,
  ) {}

  /**
   * notify — persist an in-app notification, then optionally email it.
   *
   * The row is written FIRST (Requirement 8.1). If persistence fails, no email
   * is attempted and an error indicating notification creation failed is thrown;
   * because nothing was written there is no partial row (Requirement 8.2). When
   * email is enabled for this notification and a Mailer is wired, delivery is
   * attempted with a 30s timeout and bounded retries; the persisted row is
   * retained regardless of email outcome (Requirements 8.3, 8.4).
   */
  async notify(
    userId: string,
    type: string,
    payload: Record<string, unknown>,
    opts?: NotifyOptions,
  ): Promise<void> {
    let row: Notification;
    try {
      row = await this.repo.insert({ user_id: userId, type, payload: payload ?? null });
    } catch {
      // 8.2 — no email, no partial row, surface a creation-failed error.
      throw new InternalException('notification creation failed');
    }

    // 8.3 — email only when explicitly enabled AND the transport is wired
    // (\`--with-email\` composes @streetjs/plugin-sendgrid). Otherwise skip.
    if (opts?.email === true && this.mailer && this.users) {
      await this.deliverEmail(userId, row);
    }
  }

  /**
   * listUnread — the user's unread notifications, newest first, capped at 100.
   * Scoping/ordering/limit are enforced by the repository (Requirement 8.5).
   */
  async listUnread(userId: string): Promise<Notification[]> {
    return this.repo.listUnread(userId, MAX_UNREAD_NOTIFICATIONS);
  }

  /**
   * markRead — stamp read_at for the user's notification.
   *
   * If the notification does not exist or is not owned by the user, nothing
   * changes and NotFoundException is thrown (Requirement 8.7). If it is already
   * read, the call is a no-op so read_at is left unchanged (idempotent,
   * Requirement 8.6).
   */
  async markRead(userId: string, id: string): Promise<void> {
    const existing = await this.repo.findOwned(userId, id);
    if (!existing) {
      throw new NotFoundException('notification not found');
    }
    if (existing.read_at !== null) {
      return; // 8.6 — already read; leave read_at unchanged.
    }
    await this.repo.markRead(userId, id, new Date().toISOString());
  }

  /**
   * deliverEmail — best-effort email delivery for an already-persisted row.
   *
   * Each attempt is bounded by EMAIL_TIMEOUT_MS (30s); on failure or timeout the
   * send is retried up to EMAIL_MAX_RETRIES additional times. The persisted row
   * is never removed. After the final failed attempt a delivery-failure
   * indication is recorded (Requirement 8.4). Never throws — the in-app
   * notification has already succeeded.
   */
  private async deliverEmail(userId: string, row: Notification): Promise<void> {
    const to = await this.users!.emailForUser(userId);
    if (!to) {
      await this.recordFailureSafely(row.id);
      return;
    }

    const maxAttempts = EMAIL_MAX_RETRIES + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await withTimeout(
          this.mailer!.send({ to, type: row.type, payload: row.payload }),
          EMAIL_TIMEOUT_MS,
        );
        return; // delivered
      } catch {
        if (attempt >= maxAttempts) {
          await this.recordFailureSafely(row.id);
          return;
        }
        // otherwise retry
      }
    }
  }

  /** Record a delivery failure without masking the (already successful) notify. */
  private async recordFailureSafely(id: string): Promise<void> {
    try {
      await this.repo.recordDeliveryFailure(id);
    } catch {
      // Recording the failure indicator must not throw out of notify().
    }
  }
}

/**
 * Resolve \`p\`, or reject if it does not settle within \`ms\` milliseconds. Used to
 * bound each email delivery attempt at 30s (Requirement 8.4).
 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('email delivery timed out')), ms);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}
`,
      },
      {
        path: 'SAAS.md',
        content: `# SaaS starter

This project was scaffolded with \`street create --starter saas\`. It overlays a
multi-tenant SaaS structure on top of the base StreetJS app.

## Dependency-minimal by default

The default \`--starter saas\` scaffold is **dependency-minimal**: on top of the
\`streetjs\` core it adds only the server-rendered dashboard runtime
(\`@streetjs/plugin-htmx\`). Every default-scaffolded source file imports only
from \`streetjs\`, Node builtins, local files, or \`@streetjs/plugin-htmx\`, so the
project **installs cleanly from npm** and **type-checks with \`tsc\`** out of the
box.

Optional features are **opt-in** at scaffold time and pull in only the published
package(s) they need:

| Flag | Adds | Package(s) |
|------|------|------------|
| \`--with-billing\`  | Stripe webhook controller (\`src/modules/billing/billing.controller.ts\`) | \`@streetjs/plugin-stripe\` |
| \`--with-admin-ui\` | Auth + RBAC React screens (\`src/modules/dashboard/auth-ui.controller.ts\`) | \`@streetjs/auth-ui\`, \`@streetjs/admin-ui\` |
| \`--with-email\`    | Email delivery for notifications (injected \`Mailer\`) | \`@streetjs/plugin-sendgrid\` (install when wiring the transport) |

\`\`\`bash
# Minimal default (installs + type-checks with zero extra @streetjs packages):
street create my-saas --starter saas

# Opt into billing and the auth/RBAC management screens:
street create my-saas --starter saas --with-billing --with-admin-ui
\`\`\`

> The billing service (\`billing.service.ts\`) and the notification service
> (\`notification.service.ts\`) ship in the **default** scaffold — they import no
> third-party package (Stripe events are typed locally; email is delivered
> through an injected \`Mailer\` interface). Only the billing **webhook
> controller** and the auth/RBAC **UI controller** are flag-gated, because only
> they statically import an optional \`@streetjs/*\` package.

## What's included

- **Auth** — email/password + sessions (core JWT/session primitives).
- **Organizations, teams & RBAC** — \`organizations\`, \`memberships\` (roles:
  owner/admin/member). RBAC is composed from the core \`requireRoles(...)\`
  middleware (see \`src/features/saas.ts\`); the managed \`@streetjs/admin\`
  \`AdminService\` is an optional enhancement you can install separately.
- **Multi-tenancy** — row-level scoping by \`org_id\` + \`tenantResolver\`
  middleware (see below).
- **Invitations** — tokenized org invites (\`invitations\`).
- **Billing placeholders** — \`subscriptions\` table + a Stripe webhook handler.
  Scaffold the webhook controller with \`--with-billing\` (adds
  \`@streetjs/plugin-stripe\`) and wire your keys to go live.
- **API keys** — hashed-at-rest programmatic keys (\`api_keys\`) + \`apiKeyAuth\`
  middleware (see below).
- **Settings** — per-org and per-user key/value settings (\`org_settings\`,
  \`user_settings\`).
- **Audit logs** — \`audit_logs\` for every privileged action.
- **Notifications** — \`notifications\` per user (in-app always; email via
  \`--with-email\` + \`@streetjs/plugin-sendgrid\`).

## Schema

The starter ships an **additive** migration set. Apply it with:

\`\`\`bash
street migrate:run
\`\`\`

Migrations are applied in ascending order by the core \`StreetMigrationRunner\`:

- \`migrations/001_saas.sql\` — base SaaS schema (users, organizations,
  memberships, invitations, subscriptions, audit_logs, notifications).
  **Preserved unchanged.**
- \`migrations/002_api_keys.sql\` — \`api_keys\` table (additive).
- \`migrations/003_settings.sql\` — \`org_settings\` + \`user_settings\` tables
  (additive).

\`001_saas.sql\` is never modified; API keys and settings are layered on top via
\`002\`/\`003\` so existing scaffolded projects can adopt them incrementally.

## Suggested module layout

\`\`\`
src/
  features/saas.ts        # admin/RBAC wiring (this overlay)
  middleware/
    tenant.ts             # tenantResolver — scope requests by active org
    apiKeyAuth.ts         # X-API-Key authentication
  modules/
    auth/                 # sign-up, login, sessions
    orgs/                 # create org, switch org
    members/              # list/invite/remove members
    invitations/          # accept invite
    billing/              # Stripe webhook + subscription state
    apikeys/              # create/list/revoke API keys
    audit/                # audit-log writer + viewer
    settings/             # org + user settings
    notifications/        # email + in-app notifications
\`\`\`

Generate modules with \`street generate controller|service|repository <name>\`.

## Multi-tenancy

The starter uses a **shared database, shared schema** model with **row-level
tenant scoping by \`org_id\`**. Every tenant-scoped table carries an \`org_id\`
column, and every read/write is constrained to the active organization.

- **\`tenantResolver\` middleware** resolves the active organization for each
  request (in order: path/subdomain org slug, \`X-Org-Slug\` / \`X-Org-Id\`
  header, then the active org stored in the session) and populates \`ctx.org\`.
- **Membership gate**: the authenticated user MUST have a \`memberships\` row for
  the resolved org. If not, the request is rejected with \`403\` — there is **no
  cross-tenant access**. A tenant-scoped request that cannot resolve exactly one
  org for which the requester holds a membership also returns \`403\`.
- **Repository scoping**: tenant-scoped repositories inject
  \`WHERE org_id = ctx.org.id\` on every read and stamp \`org_id = ctx.org.id\` on
  every write, overriding any \`org_id\` supplied in the request payload.

> **Advanced upgrade path.** The shared-schema model is the lowest-friction
> default. For stronger isolation you can layer on Postgres **row-level security
> (RLS)** policies or move to a **schema-per-tenant** topology. These are
> deliberately **not** baked into the starter; adopt them only if your
> compliance needs require it.

## API keys

Programmatic clients authenticate with API keys instead of a user session.

- **Hashed at rest**: only the key **prefix** (display-only, e.g.
  \`sk_live_AB12\`) and the **SHA-256 hash** of the secret are stored. The
  plaintext key is **never** persisted.
- **Shown once**: the full plaintext key is returned **exactly once** in the
  creation response. Store it securely — it cannot be recovered afterward.
- **Scopes**: each key carries a list of scopes (e.g.
  \`["billing:read","members:write"]\`); a request is limited to its key's
  scopes, and a request needing a scope the key lacks is denied.
- **Revocation & expiry**: revoking a key stamps \`revoked_at\`; a key may also
  carry an \`expires_at\`. Any request presenting a revoked or expired key — or a
  missing/empty/unknown key — is rejected with \`401\`.
- **Usage**: send the plaintext key in the \`X-API-Key\` request header. Listing
  keys returns metadata only (id, name, prefix, scopes, timestamps) and never
  the hash or plaintext.

## Settings

Flexible per-org and per-user configuration backed by \`org_settings\` and
\`user_settings\`.

- **Single value per (scope, key)**: a uniqueness constraint enforces at most one
  row per \`(org_id, key)\` and per \`(user_id, key)\`. Writing an existing key
  replaces the prior value in place rather than adding a row.
- **JSONB values**: values are stored as JSONB, so any JSON-serializable value
  is allowed. Reading a key with no stored row returns "no value" without
  creating a row.

## SQLite (dev) ↔ Postgres (production)

The starter runs the **same schema** on SQLite in development and Postgres in
production.

- **Zero-config SQLite default**: when no database configuration is provided, the
  app defaults to **SQLite** — no setup required to start developing.
- **Postgres in production**: providing the \`PG_*\` environment variables selects
  **Postgres** via \`@streetjs/plugin-postgres\` as the production driver:

  \`\`\`bash
  npm install @streetjs/plugin-postgres
  # set PG_HOST, PG_PORT, PG_DATABASE, PG_USER, PG_PASSWORD (see .env.saas.example)
  \`\`\`

- **Invalid configuration fails fast**: if Postgres is selected but the required
  \`PG_*\` configuration is missing or invalid, the app emits a **startup error
  indicating the database configuration is invalid** rather than guessing
  credentials or silently falling back.

The migrations are written as PostgreSQL DDL. When running on SQLite, the core
runner applies the following type adjustments:

| PostgreSQL          | SQLite                                |
|---------------------|---------------------------------------|
| \`BIGSERIAL\`         | \`INTEGER PRIMARY KEY AUTOINCREMENT\`   |
| \`TIMESTAMPTZ\`       | \`TEXT\` / \`DATETIME\`                   |
| \`JSONB\`             | \`TEXT\`                                |
| \`now()\`             | \`CURRENT_TIMESTAMP\`                   |

Apply the full set the same way on either driver:

\`\`\`bash
street migrate:run
\`\`\`

\`001_saas.sql\` is preserved unchanged; \`002_api_keys.sql\` and
\`003_settings.sql\` are additive, so the migration order
(\`001\` → \`002\` → \`003\`) holds on both SQLite and Postgres.

## Billing (Stripe)

Scaffold the signature-verified Stripe webhook controller with the
\`--with-billing\` flag (adds \`@streetjs/plugin-stripe\`):

\`\`\`bash
street create my-saas --starter saas --with-billing
# set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (see .env.saas.example)
\`\`\`

If you scaffolded without the flag, add it later:

\`\`\`bash
npm install @streetjs/plugin-stripe
\`\`\`

The \`subscriptions\` table and \`billing.service.ts\` (which imports no third-party
package) ship in the default scaffold either way.

## Auth & RBAC management screens (admin UI)

Scaffold the server-rendered auth + RBAC React screens with \`--with-admin-ui\`
(adds \`@streetjs/auth-ui\` and \`@streetjs/admin-ui\`):

\`\`\`bash
street create my-saas --starter saas --with-admin-ui
\`\`\`

This emits \`src/modules/dashboard/auth-ui.controller.ts\`, which composes the
official React component packages (no client build step — they load from an ESM
CDN via an importmap). The core dashboard (\`dashboard.controller.ts\`) and its
htmx views ship in the default scaffold regardless.

## Email notifications

In-app notifications are always available. To deliver email as well, scaffold
with \`--with-email\` and provide a \`Mailer\` implementation backed by
\`@streetjs/plugin-sendgrid\`:

\`\`\`bash
street create my-saas --starter saas --with-email
npm install @streetjs/plugin-sendgrid
# set SENDGRID_API_KEY (see .env.saas.example)
\`\`\`

\`notification.service.ts\` takes the transport through an injected \`Mailer\`
interface, so the default scaffold imports no email package; email is simply
skipped until a \`Mailer\` is wired.

See the [SaaS starter docs](https://hassanmubiru.github.io/StreetJS/starters/).
`,
      },
      {
        path: '.env.saas.example',
        content: `# SaaS starter — copy values into your .env.

# Database (production) — set these to select Postgres via @streetjs/plugin-postgres.
# Leave them unset to use the zero-config SQLite development default. If Postgres
# is selected and any required value below is missing/invalid, the app fails on
# startup with an invalid database configuration error (it will not guess).
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=

# Billing (Stripe) — scaffold the webhook controller with: --starter saas --with-billing
# (adds @streetjs/plugin-stripe). These values are read by the billing module.
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (SendGrid) — scaffold with: --starter saas --with-email, then
# \`npm install @streetjs/plugin-sendgrid\` and wire the Mailer transport.
SENDGRID_API_KEY=SG....
`,
      },
      {
        // ── MarzPay billing modules (opt-in: --with-marzpay) ────────────────
        // Flag-gated overlay: these files are written ONLY when `--with-marzpay`
        // is passed, and the flag adds @streetjs/plugin-marzpay to the project
        // (see flagPackages['with-marzpay']). A plain `--starter saas` scaffold
        // emits none of these files and adds no MarzPay dependency.
        //
        // NOTE: the file CONTENT below is a minimal, compiling placeholder. The
        // full org-scoped, config-driven billing logic is implemented by the
        // MarzPay integration tasks (BillingService/SubscriptionService 12.x,
        // CheckoutController/WebhookController 12.4, dashboard 13.x, migrations
        // 12.6). This task (11.1) only wires the flag-gated emission.
        path: 'src/modules/billing/marzpay-billing.service.ts',
        flag: 'with-marzpay',
        content: `// src/modules/billing/marzpay-billing.service.ts
// MarzPay billing module for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-marzpay\` (composes @streetjs/plugin-marzpay; install-on-demand).
//
// BillingService resolves subscription plans from configuration (never
// hardcoded) and persists/queries billing records ONLY through
// orgScopedRepo(repo, ctx) so every record is tenant-scoped by org_id.
//
// startCheckout(ctx, planId):
//   - resolves the plan from BillingConfig; an UNKNOWN planId throws an
//     "unknown plan" error and persists NOTHING (Requirement 6.6).
//   - on a known plan it calls the injected MarzPayClient.initializePayment
//     (verified POST /collect-money, card channel -> redirect_url) and persists
//     exactly one BillingRecord through orgScopedRepo(repo, ctx), so the row is
//     stamped with the active tenant's org_id (Requirements 6.5, 6.7, 6.8).
//
// recordPayment(ctx, event): writes a verified-webhook-derived BillingRecord,
// again ONLY through orgScopedRepo(repo, ctx) so it is tenant-scoped by org_id.
import { randomUUID } from 'node:crypto';
import { BadRequestException, type StreetContext } from 'streetjs';
import { orgScopedRepo, type ScopedRepository } from '../../middleware/tenant.js';
import type { MarzPayClient } from '@streetjs/plugin-marzpay';

/** A subscription plan definition, read from BillingConfig (never hardcoded). */
export interface PlanDefinition {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: string;
}

/** Billing configuration: the set of plans a tenant may subscribe to. */
export interface BillingConfig {
  plans: Record<string, PlanDefinition>;
}

/** An org-scoped billing record (tenant discriminator: org_id). */
export interface BillingRecord {
  id: string;
  org_id: string;
  plan: string;
  status: string;
  reference: string;
  amount: number;
  currency: string;
  created_at: string;
}

/** Result of starting a checkout against MarzPay. */
export interface CheckoutResult {
  reference: string;
  redirectUrl?: string;
  status: string;
}

/** A verified webhook event, after MarzPayClient.validateWebhook + re-verify. */
export interface VerifiedWebhookEvent {
  /** Client reference echoed by MarzPay (matches the BillingRecord reference). */
  reference: string;
  /** Verified transaction status (e.g. \`completed\`/\`failed\`). */
  status: string;
  /** Raw numeric amount of the collection. */
  amount: number;
  /** ISO currency of the collection (e.g. \`UGX\`). */
  currency: string;
  /** Configured plan id this payment settles, when known. */
  plan?: string;
}

/**
 * Opaque transaction handle supplied by the data layer (@streetjs/orm). The
 * billing overlay only forwards it so the processed-event record and the
 * billing insert share ONE transaction and roll back together on failure.
 */
export type Tx = unknown;

/** Unit-of-work contract that runs work in one transaction, rolling back on throw. */
export interface UnitOfWork {
  transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
}

/** A processed-event row (tenant discriminator: org_id), keyed on the reference. */
export interface ProcessedEvent {
  reference: string;
  org_id: string;
  processed_at: string;
}

/**
 * Org-scoped idempotency store backed by the marzpay_events table
 * (migration 005). Both methods run INSIDE the caller's transaction so the
 * processed-event record rolls back with the billing insert on failure
 * (Requirement 7.4). A duplicate reference is detected by hasProcessed and the
 * billing write is skipped (Requirement 7.3); a concurrent second insert loses
 * the UNIQUE(reference) race in marzpay_events and is therefore treated as
 * already-processed (Requirement 7.2).
 */
export interface ProcessedEventStore {
  hasProcessed(tx: Tx, reference: string): Promise<boolean>;
  recordProcessed(tx: Tx, reference: string): Promise<void>;
}

/**
 * Minimal row gateway over the marzpay_events table, bound to a transaction
 * handle. The app supplies a concrete implementation (e.g. an @streetjs/orm
 * repository); reads and writes MUST run inside the caller's tx so they commit
 * or roll back atomically with the billing-state write.
 */
export interface EventRowGateway {
  /** True if a marzpay_events row already exists for (org_id, reference). */
  exists(tx: Tx, filter: { org_id: string; reference: string }): Promise<boolean>;
  /** Insert one marzpay_events row; throws on the UNIQUE(reference) race. */
  insert(tx: Tx, row: ProcessedEvent): Promise<void>;
}

/**
 * orgScopedEventStore — an org-scoped ProcessedEventStore over marzpay_events.
 * org_id is stamped SERVER-SIDE from the active org (never the Raw_Body),
 * mirroring orgScopedRepo, so a processed-event row can only ever be recorded
 * or looked up for the active tenant. recordProcessed relies on the
 * UNIQUE(reference) primary key to reject a concurrent duplicate.
 */
export function orgScopedEventStore(gateway: EventRowGateway, orgId: string): ProcessedEventStore {
  if (!orgId) throw new BadRequestException('orgScopedEventStore requires an active org id');
  return {
    async hasProcessed(tx, reference) {
      return gateway.exists(tx, { org_id: orgId, reference });
    },
    async recordProcessed(tx, reference) {
      await gateway.insert(tx, {
        reference,
        org_id: orgId,
        processed_at: new Date().toISOString(),
      });
    },
  };
}

/**
 * Server-side reference -> organization mapping (Requirement 8.1).
 *
 * Resolves which tenant owns a verified transaction reference using ONLY the
 * persisted billing/subscription records created at checkout time — NEVER the
 * Raw_Body. The webhook controller calls this to DERIVE the org_id it then
 * scopes every write to, so a forged Raw_Body org cannot redirect a settlement
 * to another tenant.
 */
export interface OrgResolver {
  /** The org_id that owns \`reference\`, or null when the mapping is unknown. */
  resolveOrgByReference(reference: string): Promise<string | null>;
}

/**
 * Minimal UNSCOPED gateway that looks up the owning org of a globally-unique
 * billing reference. The lookup is intentionally NOT org-scoped because a
 * webhook arrives with no active tenant; the org_id it returns IS the
 * server-derived tenant the caller then scopes every write to. \`reference\` is
 * unique (UNIQUE(reference), migration 005), so at most one row matches.
 */
export interface ReferenceLookupGateway {
  findByReference(reference: string): Promise<{ org_id: string } | null>;
}

/**
 * billingReferenceOrgResolver — an OrgResolver backed by the BillingRecords the
 * checkout flow persists (each row carries org_id + reference). The reference
 * uniqueness constraint guarantees a single owning org per reference, so a
 * verified webhook reference maps to exactly one tenant.
 */
export function billingReferenceOrgResolver(gateway: ReferenceLookupGateway): OrgResolver {
  return {
    async resolveOrgByReference(reference) {
      const trimmed = reference.trim();
      if (trimmed === '') return null;
      const row = await gateway.findByReference(trimmed);
      return row ? row.org_id : null;
    },
  };
}

export class BillingService {
  constructor(
    private readonly repo: ScopedRepository<BillingRecord>,
    private readonly plans: BillingConfig,
    private readonly client: MarzPayClient,
  ) {}

  /** Look up a configured plan by id; null when the plan is unknown. */
  resolvePlan(planId: string): PlanDefinition | null {
    return this.plans.plans[planId] ?? null;
  }

  /**
   * Start a checkout for a configured plan.
   *
   * Plans are read from BillingConfig (never hardcoded). An unknown planId
   * throws an "unknown plan" error and persists NOTHING (Requirement 6.6). On a
   * known plan, MarzPay initializes the payment and exactly one BillingRecord is
   * written through orgScopedRepo(repo, ctx), tenant-scoped by org_id
   * (Requirements 6.5, 6.7, 6.8).
   */
  async startCheckout(ctx: StreetContext, planId: string): Promise<CheckoutResult> {
    const plan = this.resolvePlan(planId);
    if (!plan) {
      // Reject before any side effect: nothing is sent and nothing is persisted.
      throw new BadRequestException('unknown plan: ' + planId);
    }

    // Verified card collection (V2): no phone number; MarzPay returns redirect_url.
    const init = await this.client.initializePayment({
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: randomUUID(),
      method: 'card',
      description: plan.name,
    });

    // Persist ONLY through the org-scoped repo: org_id is stamped to the active
    // tenant and cannot be overridden by the payload (tenant isolation).
    await orgScopedRepo(this.repo, ctx).insert({
      plan: planId,
      status: init.status,
      reference: init.reference,
      amount: plan.amount,
      currency: plan.currency,
      created_at: new Date().toISOString(),
    });

    return { reference: init.reference, redirectUrl: init.redirectUrl, status: init.status };
  }

  /**
   * Record a settled payment from a verified webhook event, writing the
   * BillingRecord ONLY through orgScopedRepo(repo, ctx) so it is tenant-scoped.
   */
  async recordPayment(ctx: StreetContext, event: VerifiedWebhookEvent): Promise<BillingRecord> {
    return orgScopedRepo(this.repo, ctx).insert({
      plan: event.plan ?? '',
      status: event.status,
      reference: event.reference,
      amount: event.amount,
      currency: event.currency,
      created_at: new Date().toISOString(),
    });
  }
}
`,
      },
      {
        path: 'src/modules/billing/marzpay-subscription.service.ts',
        flag: 'with-marzpay',
        content: `// src/modules/billing/marzpay-subscription.service.ts
// MarzPay subscription module for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-marzpay\` (composes @streetjs/plugin-marzpay; install-on-demand).
//
// SubscriptionService manages org-scoped SubscriptionRecords
// (create / renew / cancel / expire) ONLY through orgScopedRepo(repo, ctx), so
// every row is tenant-scoped by org_id and a record created for one tenant is
// never returned for another (Requirement 6.8).
//
// Plans are read from BillingConfig (never hardcoded) and an UNKNOWN plan is
// rejected consistently with BillingService — a BadRequestException whose
// message starts with "unknown plan" — persisting NOTHING (Requirements 6.5,
// 6.6). The PlanDefinition/BillingConfig types are reused from the billing
// service so the two services share one source of plan truth.
//
// Invoice, payment-history, and usage-tracking hooks read/write ONLY through
// orgScopedRepo on the relevant org-scoped repositories (Requirements 6.7, 6.8).
import { BadRequestException, type StreetContext } from 'streetjs';
import { orgScopedRepo, type ScopedRepository } from '../../middleware/tenant.js';
import type { BillingConfig, PlanDefinition, BillingRecord } from './marzpay-billing.service.js';

/** An org-scoped subscription record (tenant discriminator: org_id). */
export interface SubscriptionRecord {
  id: string;
  org_id: string;
  plan: string;
  status: 'active' | 'canceled' | 'expired';
  current_period_end: string | null;
}

/** An org-scoped invoice record (tenant discriminator: org_id). */
export interface InvoiceRecord {
  id: string;
  org_id: string;
  amount: number;
  currency: string;
  issued_at: string;
}

/** An org-scoped usage measurement for a tenant's subscription. */
export interface UsageRecord {
  id: string;
  org_id: string;
  metric: string;
  quantity: number;
  recorded_at: string;
}

export class SubscriptionService {
  constructor(
    private readonly repo: ScopedRepository<SubscriptionRecord>,
    private readonly plans: BillingConfig,
  ) {}

  /** Look up a configured plan by id; null when the plan is unknown. */
  resolvePlan(planId: string): PlanDefinition | null {
    return this.plans.plans[planId] ?? null;
  }

  /**
   * Create a subscription for a configured plan.
   *
   * An UNKNOWN planId is rejected with a BadRequestException ("unknown plan"),
   * consistent with BillingService, and NOTHING is persisted (Requirements 6.5,
   * 6.6). On a known plan, exactly one 'active' SubscriptionRecord is written
   * through orgScopedRepo(repo, ctx) so it is tenant-scoped by org_id.
   */
  async create(ctx: StreetContext, planId: string): Promise<SubscriptionRecord> {
    const plan = this.resolvePlan(planId);
    if (!plan) {
      // Reject before any side effect: nothing is persisted.
      throw new BadRequestException('unknown plan: ' + planId);
    }
    return orgScopedRepo(this.repo, ctx).insert({
      plan: planId,
      status: 'active',
      current_period_end: this.nextPeriodEnd(plan),
    });
  }

  /**
   * Renew an existing subscription: confirm the plan is still configured, then
   * mark it 'active' and advance current_period_end. The row is looked up and
   * updated ONLY through orgScopedRepo so cross-tenant access is impossible.
   */
  async renew(ctx: StreetContext, subscriptionId: string): Promise<SubscriptionRecord> {
    const scoped = orgScopedRepo(this.repo, ctx);
    const existing = await scoped.findOne({ id: subscriptionId });
    if (!existing) {
      throw new BadRequestException('unknown subscription: ' + subscriptionId);
    }
    const plan = this.resolvePlan(existing.plan);
    if (!plan) {
      // Reject consistently with BillingService; persist nothing.
      throw new BadRequestException('unknown plan: ' + existing.plan);
    }
    return scoped.update(
      { id: subscriptionId },
      { status: 'active', current_period_end: this.nextPeriodEnd(plan) },
    );
  }

  /** Cancel a subscription -> status 'canceled', through orgScopedRepo. */
  async cancel(ctx: StreetContext, subscriptionId: string): Promise<SubscriptionRecord> {
    return orgScopedRepo(this.repo, ctx).update({ id: subscriptionId }, { status: 'canceled' });
  }

  /** Expire a subscription -> status 'expired', through orgScopedRepo. */
  async expire(ctx: StreetContext, subscriptionId: string): Promise<SubscriptionRecord> {
    return orgScopedRepo(this.repo, ctx).update({ id: subscriptionId }, { status: 'expired' });
  }

  /** List the active tenant's subscriptions (tenant-scoped read). */
  async listSubscriptions(ctx: StreetContext): Promise<SubscriptionRecord[]> {
    return orgScopedRepo(this.repo, ctx).find({});
  }

  /**
   * Invoice hook: list the active tenant's invoices through orgScopedRepo on the
   * supplied invoice repository (tenant-scoped by org_id).
   */
  async listInvoices(
    ctx: StreetContext,
    invoices: ScopedRepository<InvoiceRecord>,
  ): Promise<InvoiceRecord[]> {
    return orgScopedRepo(invoices, ctx).find({});
  }

  /**
   * Payment-history hook: list the active tenant's billing records (the same
   * BillingRecord shape BillingService persists) through orgScopedRepo.
   */
  async paymentHistory(
    ctx: StreetContext,
    billing: ScopedRepository<BillingRecord>,
  ): Promise<BillingRecord[]> {
    return orgScopedRepo(billing, ctx).find({});
  }

  /**
   * Usage-tracking hook: record a usage measurement for the active tenant
   * through orgScopedRepo so it is stamped with org_id.
   */
  async recordUsage(
    ctx: StreetContext,
    usageRepo: ScopedRepository<UsageRecord>,
    metric: string,
    quantity: number,
  ): Promise<UsageRecord> {
    return orgScopedRepo(usageRepo, ctx).insert({
      metric,
      quantity,
      recorded_at: new Date().toISOString(),
    });
  }

  /** Usage-tracking hook: read the active tenant's recorded usage. */
  async listUsage(
    ctx: StreetContext,
    usageRepo: ScopedRepository<UsageRecord>,
  ): Promise<UsageRecord[]> {
    return orgScopedRepo(usageRepo, ctx).find({});
  }

  /** Compute the next period end from the plan interval (month/week/year). */
  private nextPeriodEnd(plan: PlanDefinition): string {
    const day = 24 * 60 * 60 * 1000;
    const span =
      plan.interval === 'year'
        ? 365 * day
        : plan.interval === 'week'
          ? 7 * day
          : 30 * day;
    return new Date(Date.now() + span).toISOString();
  }
}
`,
      },
      {
        path: 'src/modules/billing/marzpay-checkout.controller.ts',
        flag: 'with-marzpay',
        content: `// src/modules/billing/marzpay-checkout.controller.ts
// MarzPay checkout controller for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-marzpay\` (composes @streetjs/plugin-marzpay; install-on-demand).
//
//   POST /billing/checkout  -> BillingService.startCheckout
//
// Reads the planId from the JSON request body and delegates to BillingService,
// which resolves the plan from configuration (never hardcoded) and persists the
// BillingRecord ONLY through orgScopedRepo, so the row is tenant-scoped by
// org_id. An UNKNOWN planId makes the service throw a BadRequestException
// ("unknown plan"); that surfaces as the appropriate error response and NOTHING
// is persisted (Requirement 6.6).
import 'reflect-metadata';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { BillingService } from './marzpay-billing.service.js';

@Controller('/billing')
export class CheckoutController {
  constructor(private readonly billing: BillingService) {}

  /**
   * POST /billing/checkout — start a MarzPay checkout for a configured plan.
   *
   * The planId is read from the JSON request body. A missing/blank planId is
   * rejected with a 400 before any service call. On a known plan the service
   * returns the CheckoutResult (reference + redirectUrl + status), serialized as
   * JSON. On an unknown plan the service throws and the error surfaces as the
   * appropriate error response without persisting anything (Requirement 6.6).
   */
  @Post('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as { planId?: unknown };
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';
    if (!planId) {
      throw new BadRequestException('planId is required');
    }
    const result = await this.billing.startCheckout(ctx, planId);
    ctx.json(result, 200);
  }
}
`,
      },
      {
        path: 'src/modules/billing/marzpay-webhook.controller.ts',
        flag: 'with-marzpay',
        content: `// src/modules/billing/marzpay-webhook.controller.ts
// MarzPay webhook controller for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-marzpay\` (composes @streetjs/plugin-marzpay; install-on-demand).
//
//   POST /webhooks/marzpay
//
// SECURITY (Requirements 6.3, 6.4): handle() calls the injected MarzPayClient's
// validateWebhook on the UNMODIFIED raw body BEFORE any persistence. A NEGATIVE
// result rejects the webhook with a "webhook validation failed" error response
// (400) and writes NOTHING.
//
// Verify-don't-invent: MarzPay documents no webhook signature scheme
// (Research_Artifact §L4), so MARZPAY_SPEC.webhook is left unbound and
// validateWebhook returns false for absent/malformed signature material. The
// documented trust path for a POSITIVE result is server-side re-verification
// (Research_Artifact §R1, recommendation 7): the controller re-fetches the
// transaction from MarzPay via getTransaction and persists the verified
// amount/status/reference rather than trusting the raw payload.
//
// MULTI-TENANT (Requirement 8): a webhook is a server-to-server call with no
// session, so the target org is DERIVED server-side from the verified
// reference->org mapping via an injected OrgResolver (never from the Raw_Body).
// An unresolved mapping or a Raw_Body org that disagrees with the mapped org is
// rejected and persists NOTHING; the resolved org is stamped onto ctx so every
// write flows through orgScopedRepo with the server-derived org id.
import 'reflect-metadata';
import { Controller, Post, BadRequestException, type StreetContext } from 'streetjs';
import type { MarzPayClient } from '@streetjs/plugin-marzpay';
import type {
  BillingService,
  VerifiedWebhookEvent,
  ProcessedEventStore,
  UnitOfWork,
  OrgResolver,
} from './marzpay-billing.service.js';

/**
 * MarzPay documents no signature header (Research_Artifact §L4). We read a
 * conventional header so its value flows into validateWebhook; with the scheme
 * unbound, validateWebhook returns false for absent/malformed material, so the
 * conservative negative path is taken until MarzPay publishes a signing scheme.
 */
const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

/**
 * rawBodyOf — return the UNMODIFIED request body for webhook validation.
 *
 * A raw-body middleware on the webhook route must capture the bytes verbatim
 * into ctx.state.rawBody before any JSON parsing; re-serialising the parsed
 * ctx.body would change the bytes and break any future signature check.
 */
function rawBodyOf(ctx: StreetContext): string {
  const captured = ctx.state['rawBody'];
  if (typeof captured === 'string') return captured;
  if (captured instanceof Buffer) return captured.toString('utf8');
  throw new BadRequestException('missing raw body for MarzPay webhook validation');
}

/**
 * referenceOf — extract transaction.reference from the verified MarzPay webhook
 * payload shape ({ event_type, transaction: { reference, ... } }). A payload
 * that is malformed or missing a usable reference is rejected before any
 * re-verification or persistence happens.
 */
function referenceOf(rawBody: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new BadRequestException('malformed MarzPay webhook payload');
  }
  const root = (parsed ?? {}) as { transaction?: { reference?: unknown } };
  const reference = root.transaction?.reference;
  if (typeof reference !== 'string' || reference.trim() === '') {
    throw new BadRequestException('MarzPay webhook payload missing transaction.reference');
  }
  return reference.trim();
}

/**
 * payloadOrgIdOf — extract an organization identifier SUPPLIED in the Raw_Body,
 * if any (\`transaction.org_id\`, top-level \`org_id\`, or \`metadata.org_id\`).
 *
 * This value is NEVER trusted to scope a write (Requirement 8.1); it is read
 * solely so the controller can REJECT an event whose payload org disagrees with
 * the server-derived org (Requirement 8.4). Returns \`undefined\` when the
 * Raw_Body carries no usable org identifier, in which case there is nothing to
 * disagree with and the server-derived org stands.
 */
function payloadOrgIdOf(rawBody: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return undefined;
  }
  const root = (parsed ?? {}) as {
    org_id?: unknown;
    transaction?: { org_id?: unknown };
    metadata?: { org_id?: unknown };
  };
  const candidate = root.transaction?.org_id ?? root.org_id ?? root.metadata?.org_id;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed === '' ? undefined : trimmed;
}

@Controller('/webhooks')
export class WebhookController {
  constructor(
    private readonly client: MarzPayClient,
    private readonly billing: BillingService,
    // Optional idempotency collaborators (Requirement 7). When BOTH are wired,
    // the controller checks-and-records the processed reference in the SAME DB
    // transaction as the billing-state write. When absent (e.g. a minimal
    // composition), it falls back to a single direct write with no behavioural
    // change.
    private readonly events?: ProcessedEventStore,
    private readonly uow?: UnitOfWork,
    // Optional server-side org resolver (Requirement 8). When wired, the
    // controller DERIVES the target org from the verified reference->org mapping
    // (billing/subscription records), rejects a Raw_Body org that disagrees, and
    // stamps every write with the server-derived org. When absent, the prior
    // behaviour is preserved and persistence relies on the ambient ctx.org.
    private readonly orgResolver?: OrgResolver,
  ) {}

  /**
   * POST /webhooks/marzpay — validate, re-verify, then persist.
   *
   * 1. Capture the unmodified raw body and the signature header.
   * 2. Call client.validateWebhook(rawBody, signature) BEFORE any persistence.
   * 3. NEGATIVE result -> reject with "webhook validation failed" (400) and
   *    write NOTHING (Requirement 6.4).
   * 4. POSITIVE result -> re-verify the referenced transaction server-side
   *    (Requirement 6.1) BEFORE persisting any billing state. On negative trust
   *    (re-verification fails / not found / reference mismatch) respond HTTP 400
   *    and persist NOTHING (Requirement 6.2). On success, record the verified
   *    payment via BillingService.recordPayment, which persists ONLY through
   *    orgScopedRepo so the record is tenant-scoped by org_id, using monetary
   *    values taken ONLY from the re-verified transaction (Requirement 6.3).
   * 5. DERIVE the target org SERVER-SIDE from the verified reference->org
   *    mapping when an OrgResolver is wired (Requirement 8.1). An unresolved
   *    mapping persists NOTHING and responds with an error (Requirement 8.2); a
   *    Raw_Body org that disagrees with the mapped org is rejected, persisting
   *    NOTHING (Requirement 8.4); the resolved org is stamped onto ctx so every
   *    write flows through orgScopedRepo with the server-derived org id
   *    (Requirement 8.3).
   * 6. Persist idempotently: check-and-record the processed reference in the
   *    SAME DB transaction as the billing-state write when an idempotency store
   *    and unit-of-work are wired. A duplicate reference skips the billing write
   *    (Requirement 7.3); any failure rolls back BOTH rows (Requirement 7.4).
   */
  @Post('/marzpay')
  async handle(ctx: StreetContext): Promise<void> {
    const rawBody = rawBodyOf(ctx);
    const signature = ctx.headers[MARZPAY_SIGNATURE_HEADER];

    // ── Validate BEFORE any persistence (Requirements 6.3, 6.4) ─────────────
    if (!this.client.validateWebhook(rawBody, signature)) {
      // Negative result: reject and write NOTHING.
      ctx.json({ error: 'webhook validation failed' }, 400);
      return;
    }

    // ── Re-verify server-side BEFORE persisting (Requirements 6.1, 6.2) ─────
    // The ONLY value taken from the Raw_Body is transaction.reference, used to
    // select which transaction to re-verify against MarzPay. Trust is
    // established by the server-verified transaction, never by the raw payload.
    const event = await this.verifiedEvent(rawBody);
    if (event === null) {
      // Negative trust: re-verification failed / not found / reference mismatch.
      // Persist NOTHING (Requirement 6.2).
      ctx.json({ error: 'webhook validation failed' }, 400);
      return;
    }

    // ── Derive the target org SERVER-SIDE (Requirement 8) ───────────────────
    // A webhook is a server-to-server call with no session/tenant, so the target
    // organization is DERIVED from the verified reference->org mapping (the
    // billing/subscription records created at checkout time), NEVER from the
    // Raw_Body (Requirement 8.1). When no resolver is wired the controller
    // preserves its prior behaviour and relies on the ambient ctx.org.
    const resolver = this.orgResolver;
    if (resolver) {
      const resolvedOrgId = await resolver.resolveOrgByReference(event.reference);
      if (!resolvedOrgId) {
        // The reference->org mapping is unresolved: persist NOTHING and respond
        // with an error status (Requirement 8.2).
        ctx.json({ error: 'unresolved organization for webhook' }, 400);
        return;
      }
      // A Raw_Body org identifier that DISAGREES with the server-derived org is
      // rejected outright; persist NOTHING (Requirement 8.4). A payload without
      // an org identifier has nothing to disagree with, so the derived org stands.
      const payloadOrgId = payloadOrgIdOf(rawBody);
      if (payloadOrgId !== undefined && payloadOrgId !== resolvedOrgId) {
        ctx.json({ error: 'organization mismatch' }, 400);
        return;
      }
      // Stamp every subsequent write with the SERVER-DERIVED org (Requirement
      // 8.3): orgScopedRepo reads ctx.org.id, so setting it here scopes
      // recordPayment to the resolved tenant regardless of any caller-supplied org.
      ctx.org = { id: resolvedOrgId };
    }

    // ── Positive trust: persist verified monetary values, idempotently ──────
    // Check-and-record the processed reference in the SAME DB transaction as the
    // billing-state write (Requirement 7.2): a reference already in the
    // Processed_Event_Store skips the billing write and applies no further state
    // (Requirement 7.3); any failure rolls back BOTH the processed-event record
    // and the billing record (Requirement 7.4); a concurrent second delivery
    // loses the UNIQUE(reference) race in marzpay_events and is therefore
    // treated as already-processed. When no idempotency store is wired, fall
    // back to a single direct write (unchanged behaviour).
    const events = this.events;
    const uow = this.uow;
    if (events && uow) {
      await uow.transaction(async (tx) => {
        if (await events.hasProcessed(tx, event.reference)) {
          // Already processed (Requirement 7.3): skip the billing write.
          return;
        }
        // Record the dedup key first so the UNIQUE(reference) constraint resolves
        // concurrent deliveries; the billing insert joins the same transaction so
        // a failure in either rolls BOTH back (Requirement 7.4).
        await events.recordProcessed(tx, event.reference);
        await this.billing.recordPayment(ctx, event);
      });
    } else {
      await this.billing.recordPayment(ctx, event);
    }
    ctx.json({ received: true }, 200);
  }

  /**
   * Re-verify the payload's transaction.reference using the documented trust
   * path (Research_Artifact §R1, Requirement 6.1): re-fetch the transaction
   * from MarzPay server-side and trust the server's amount/currency/status
   * rather than the raw payload (Requirement 6.3).
   *
   * Prefers the capability-oriented \`transactions.get(reference)\` namespace and
   * falls back to the flat \`getTransaction(reference)\` compatibility shim.
   *
   * Returns a VerifiedWebhookEvent built ONLY from the re-verified transaction,
   * or \`null\` on negative trust (re-verification throws / not found / the
   * returned transaction's reference does not match the requested reference), in
   * which case the caller persists nothing and responds HTTP 400
   * (Requirement 6.2).
   */
  private async verifiedEvent(rawBody: string): Promise<VerifiedWebhookEvent | null> {
    const reference = referenceOf(rawBody);

    let txn: Awaited<ReturnType<MarzPayClient['getTransaction']>>;
    try {
      txn =
        typeof this.client.transactions?.get === 'function'
          ? await this.client.transactions.get(reference)
          : await this.client.getTransaction(reference);
    } catch {
      // Re-verification failed (network / not found / non-2xx) -> negative trust.
      return null;
    }

    // Reject a mismatch: the re-verified transaction must echo the reference we
    // asked for. Anything else is not trustworthy (Requirement 6.2).
    if (txn === null || typeof txn.reference !== 'string' || txn.reference !== reference) {
      return null;
    }

    // Monetary values come ONLY from the re-verified transaction, never the
    // Raw_Body (Requirement 6.3).
    return {
      reference: txn.reference,
      status: txn.status,
      amount: txn.amount,
      currency: txn.currency,
    };
  }
}
`,
      },
      {
        path: 'src/modules/dashboard/billing-dashboard.controller.ts',
        flag: 'with-marzpay',
        content: `// src/modules/dashboard/billing-dashboard.controller.ts
// MarzPay billing dashboard for the SaaS starter (overlay code — NOT framework code).
// Requires \`--with-marzpay\` (composes @streetjs/plugin-marzpay; install-on-demand).
//
// Owner/Admin-only, org-scoped dashboard rendering six sections: Current Plan,
// Billing Status, Transactions, Invoices, Usage, and Subscription Renewal
// (Requirement 10.1).
//
// ACCESS GATE (Requirement 10.3): the controller mirrors the audited
// DashboardController role-gate pattern. The /o/:slug/billing route runs behind
// tenantResolver (src/middleware/tenant.ts), which sets ctx.org = { id, slug, role }
// ONLY when the caller holds a membership (otherwise 401/403 and no org). The
// controller defends again at render time via gate(): an unauthenticated caller
// (no ctx.org) OR an authenticated caller whose role is not owner/admin gets a 403
// rendered through the shared dashboard/forbidden view, which carries NO billing
// data of any tenant. Wire the route with requireRoles('owner', 'admin') for the
// same effect at the middleware layer.
//
// ORG-SCOPED DATA (Requirement 10.2): every section reads ONLY through the
// org-scoped services / repositories (orgScopedRepo), so each section is populated
// exclusively with records whose org_id equals the active tenant's org_id.
//
// PER-SECTION RESILIENCE (Requirements 10.4, 10.5): each section loads its own
// tenant-scoped collection independently. If a section's data source is
// unavailable (the load throws) the controller renders an error indicator for THAT
// section while the other sections still render — and it NEVER substitutes another
// tenant's data. A section whose tenant-scoped collection is empty renders an
// empty-state indicator while the remaining sections render their data.
//
// WIRING (src/main.ts):
//   app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'dashboard' }));
//   // /o/:slug/billing also passes through tenantResolver({ members }) and
//   // requireRoles('owner', 'admin').
//   app.registerController(BillingDashboardController);
import 'reflect-metadata';
import { Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { ScopedRepository } from '../../middleware/tenant.js';
import type { ActiveOrg, Role } from '../members/membership.service.js';
import type { BillingService, BillingRecord } from '../billing/marzpay-billing.service.js';
import type {
  SubscriptionService,
  SubscriptionRecord,
  InvoiceRecord,
  UsageRecord,
} from '../billing/marzpay-subscription.service.js';

/** Roles permitted to view the billing dashboard (Requirement 10.3). */
export const BILLING_VIEW_ROLES: Role[] = ['owner', 'admin'];

@Controller('/o/:slug/billing')
export class BillingDashboardController {
  constructor(
    private readonly billing: BillingService,
    private readonly subscriptions: SubscriptionService,
    private readonly invoices: ScopedRepository<InvoiceRecord>,
    private readonly billingRecords: ScopedRepository<BillingRecord>,
    private readonly usage: ScopedRepository<UsageRecord>,
  ) {}

  /**
   * GET /o/:slug/billing — the Owner/Admin-only billing dashboard.
   *
   * The gate denies unauthenticated/non-owner-admin callers with a 403 that
   * carries no billing data (Requirement 10.3). Otherwise the six sections are
   * each loaded independently and assembled into the page; a failing or empty
   * section degrades on its own without affecting the others (Requirements
   * 10.4, 10.5).
   */
  @Get('/')
  async dashboard(ctx: StreetContext): Promise<void> {
    const org = this.gate(ctx);
    if (!org) return; // 403 already rendered with no billing data.

    const [currentPlan, billingStatus, transactions, invoices, usage, renewal] =
      await Promise.all([
        this.currentPlanSection(ctx),
        this.billingStatusSection(ctx),
        this.transactionsSection(ctx),
        this.invoicesSection(ctx),
        this.usageSection(ctx),
        this.renewalSection(ctx),
      ]);

    ctx.htmx.view('dashboard/billing', {
      title: 'Billing',
      slug: org.slug,
      role: org.role,
      currentPlan,
      billingStatus,
      transactions,
      invoices,
      usage,
      renewal,
    });
  }

  // ── access gate ───────────────────────────────────────────────────────────

  /**
   * gate — owner/admin render-time gate. Returns ctx.org IFF a membership exists
   * AND the role is owner/admin; otherwise it responds 403 through the shared
   * forbidden view (no billing data of any tenant) and returns null so the caller
   * stops (Requirement 10.3).
   */
  private gate(ctx: StreetContext): ActiveOrg | null {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org || !BILLING_VIEW_ROLES.includes(org.role)) {
      ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403);
      return null;
    }
    return org;
  }

  // ── sections (each tenant-scoped and independently fault-isolated) ──────────

  /** Current Plan — the active tenant's current subscription plan. */
  private currentPlanSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'current-plan',
      'Current Plan',
      () => this.subscriptions.listSubscriptions(ctx),
      (subs) => {
        const active = subs.find((s) => s.status === 'active') ?? subs[0];
        const plan = this.billing.resolvePlan(active.plan);
        const name = plan ? plan.name : active.plan;
        return '<p class="plan-name">' + this.esc(name) + '</p>';
      },
    );
  }

  /** Billing Status — the active tenant's current subscription status. */
  private billingStatusSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'billing-status',
      'Billing Status',
      () => this.subscriptions.listSubscriptions(ctx),
      (subs) => {
        const active = subs.find((s) => s.status === 'active') ?? subs[0];
        return '<p class="status"><span class="badge">' + this.esc(active.status) + '</span></p>';
      },
    );
  }

  /** Transactions — the active tenant's persisted billing records. */
  private transactionsSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'transactions',
      'Transactions',
      () => this.subscriptions.paymentHistory(ctx, this.billingRecords),
      (rows) =>
        '<ul class="transactions">' +
        rows
          .map(
            (r) =>
              '<li id="txn-' + this.esc(r.id) + '">' +
              '<span class="reference">' + this.esc(r.reference) + '</span> ' +
              '<span class="amount">' + this.esc(r.amount) + ' ' + this.esc(r.currency) + '</span> ' +
              '<span class="badge">' + this.esc(r.status) + '</span>' +
              '</li>',
          )
          .join('') +
        '</ul>',
    );
  }

  /** Invoices — the active tenant's invoice history. */
  private invoicesSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'invoices',
      'Invoices',
      () => this.subscriptions.listInvoices(ctx, this.invoices),
      (rows) =>
        '<ul class="invoices">' +
        rows
          .map(
            (r) =>
              '<li id="invoice-' + this.esc(r.id) + '">' +
              '<span class="amount">' + this.esc(r.amount) + ' ' + this.esc(r.currency) + '</span> ' +
              '<time>' + this.esc(r.issued_at) + '</time>' +
              '</li>',
          )
          .join('') +
        '</ul>',
    );
  }

  /** Usage — the active tenant's recorded usage measurements. */
  private usageSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'usage',
      'Usage',
      () => this.subscriptions.listUsage(ctx, this.usage),
      (rows) =>
        '<ul class="usage">' +
        rows
          .map(
            (r) =>
              '<li id="usage-' + this.esc(r.id) + '">' +
              '<span class="metric">' + this.esc(r.metric) + '</span> ' +
              '<span class="quantity">' + this.esc(r.quantity) + '</span>' +
              '</li>',
          )
          .join('') +
        '</ul>',
    );
  }

  /** Subscription Renewal — when the active tenant's subscription renews. */
  private renewalSection(ctx: StreetContext): Promise<string> {
    return this.listSection(
      'subscription-renewal',
      'Subscription Renewal',
      () => this.subscriptions.listSubscriptions(ctx),
      (subs) => {
        const active = subs.find((s) => s.status === 'active') ?? subs[0];
        const end = active.current_period_end;
        return (
          '<p class="renewal">' +
          (end ? 'Renews on <time>' + this.esc(end) + '</time>' : 'No upcoming renewal') +
          '</p>'
        );
      },
    );
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  /**
   * listSection — load a tenant-scoped collection and render exactly one of:
   *   • an error indicator, if the data source is unavailable (load throws);
   *   • an empty-state indicator, if the tenant-scoped collection is empty;
   *   • the rendered rows, otherwise.
   * The error is caught here so one failing section never aborts the others and
   * no other tenant's data is ever substituted (Requirements 10.4, 10.5).
   */
  private async listSection<T>(
    key: string,
    title: string,
    load: () => Promise<T[]>,
    render: (items: T[]) => string,
  ): Promise<string> {
    try {
      const items = await load();
      const body = items.length === 0 ? this.emptyState(title) : render(items);
      return this.sectionShell(key, title, body);
    } catch {
      return this.sectionShell(key, title, this.errorIndicator(title));
    }
  }

  /** Wrap a section body with its heading and a stable id/data-section hook. */
  private sectionShell(key: string, title: string, body: string): string {
    return (
      '<section class="billing-section" id="billing-' + key + '" data-section="' + key + '">' +
      '<h2>' + this.esc(title) + '</h2>' +
      body +
      '</section>'
    );
  }

  /** Empty-state indicator for a section whose tenant-scoped collection is empty. */
  private emptyState(title: string): string {
    return (
      '<p class="empty-state" data-state="empty">No ' +
      this.esc(title.toLowerCase()) +
      ' to show yet.</p>'
    );
  }

  /** Error indicator for a section whose data source is unavailable. */
  private errorIndicator(title: string): string {
    return (
      '<p class="error-indicator" data-state="error" role="alert">' +
      this.esc(title) +
      ' is temporarily unavailable.</p>'
    );
  }

  /** Escape untrusted values before interpolating them into raw HTML. */
  private esc(value: unknown): string {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
`,
      },
      {
        // ── Billing dashboard page template (opt-in: --with-marzpay) ──────────
        // Server-rendered shell for the Owner/Admin billing dashboard. The six
        // sections are pre-rendered to HTML by BillingDashboardController and
        // injected as raw fragments ({{{ }}}), mirroring how the audited
        // dashboard pages embed controller-built fragments (Requirement 10.1).
        path: 'src/views/pages/dashboard/billing.html',
        flag: 'with-marzpay',
        content: `<h1>{{ title }}</h1>
<p>Organization <strong>{{ slug }}</strong> · your role: <span class="badge">{{ role }}</span></p>
<div class="billing-dashboard" id="billing-dashboard">
  {{{ currentPlan }}}
  {{{ billingStatus }}}
  {{{ transactions }}}
  {{{ invoices }}}
  {{{ usage }}}
  {{{ renewal }}}
</div>
`,
      },
      {
        path: 'migrations/004_marzpay_billing.sql',
        flag: 'with-marzpay',
        content: `-- MarzPay billing schema (opt-in: --starter saas --with-marzpay).
-- Org-scoped billing records and invoices for the scaffolded MarzPay modules.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).
--
-- This migration is ADDITIVE and IDEMPOTENT: it extends the audited
-- 001_saas.sql \`subscriptions\` table with the MarzPay billing fields required by
-- SubscriptionRecord and creates the \`billing_records\` / \`invoices\` tables. It
-- only runs when the project is scaffolded with --with-marzpay, so the default
-- (non-MarzPay) SaaS schema in 001_saas.sql is left byte-for-byte unchanged.
-- Every table carries org_id (indexed) so every billing row is scoped to a
-- single tenant (Requirements 6.7, 6.8).
--
-- SQLite note: SQLite supports \`ALTER TABLE ... ADD COLUMN\` but not
-- \`ADD COLUMN IF NOT EXISTS\`; on SQLite, drop the \`IF NOT EXISTS\` clause from the
-- ALTER statements below, use INTEGER PRIMARY KEY AUTOINCREMENT in place of
-- BIGSERIAL, and TEXT timestamps in place of TIMESTAMPTZ.

-- Extend the existing subscriptions table for MarzPay-backed billing. These
-- columns are additive so they coexist with the audited 001_saas.sql schema
-- (which already provides id, org_id, plan, status, stripe_customer_id,
-- current_period_end). org_id stays the tenant discriminator for SubscriptionRecord.
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS marzpay_reference    TEXT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ;

-- Index the subscriptions tenant discriminator for org-scoped lookups (Req 6.8).
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(org_id);

CREATE TABLE IF NOT EXISTS billing_records (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan       TEXT NOT NULL,
  status     TEXT NOT NULL,
  reference  TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  currency   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoices (
  id         BIGSERIAL PRIMARY KEY,
  org_id     BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  amount     BIGINT NOT NULL,
  currency   TEXT NOT NULL,
  issued_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_records_org ON billing_records(org_id);
CREATE INDEX IF NOT EXISTS idx_invoices_org        ON invoices(org_id);
`,
      },
      {
        path: 'migrations/005_marzpay_events.sql',
        flag: 'with-marzpay',
        content: `-- MarzPay processed-event store + settlement uniqueness (opt-in: --starter saas --with-marzpay).
-- Org-scoped dedup store keyed on the transaction reference, plus a uniqueness
-- guarantee on billing_records.reference for idempotent settlement (Req 7.1, 7.5).
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).
--
-- This migration is ADDITIVE and IDEMPOTENT: it creates the \`marzpay_events\`
-- table and the \`uq_billing_records_reference\` unique index on top of the
-- 004_marzpay_billing.sql schema, leaving \`billing_records\`, \`subscriptions\`,
-- and \`invoices\` otherwise unchanged. It only runs when the project is
-- scaffolded with --with-marzpay. marzpay_events carries org_id (indexed) so
-- every processed-event row is scoped to a single tenant.
--
-- SQLite note: SQLite has no \`TIMESTAMPTZ\` or \`now()\`; on SQLite, use TEXT
-- timestamps (e.g. DEFAULT CURRENT_TIMESTAMP) in place of TIMESTAMPTZ NOT NULL
-- DEFAULT now(). CREATE TABLE/INDEX IF NOT EXISTS are supported as written.

-- Org-scoped processed-event store keyed on the transaction reference.
CREATE TABLE IF NOT EXISTS marzpay_events (
  reference    TEXT PRIMARY KEY,
  org_id       BIGINT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index the marzpay_events tenant discriminator for org-scoped lookups.
CREATE INDEX IF NOT EXISTS idx_marzpay_events_org ON marzpay_events(org_id);

-- Enforce settlement uniqueness on billing_records.reference (Req 7.5).
CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_records_reference ON billing_records(reference);
`,
      },
      {
        path: '.env.marzpay.example',
        flag: 'with-marzpay',
        content: `# MarzPay billing — scaffolded with: --starter saas --with-marzpay
# (adds @streetjs/plugin-marzpay). Copy these keys into your .env.
#
# The plugin defaults to the sandbox environment; set MARZPAY_ENVIRONMENT to
# "production" to direct requests to the verified production base address.
MARZPAY_API_KEY=
MARZPAY_SECRET=
MARZPAY_ENVIRONMENT=sandbox
`,
      },
      {
        path: 'src/modules/dashboard/dashboard.controller.ts',
        content: `// src/modules/dashboard/dashboard.controller.ts
// Server-rendered dashboard for the SaaS starter (overlay code — NOT framework code).
//
// Renders htmx fragments via @streetjs/plugin-htmx (ctx.htmx.view / .partial /
// .engine.partial) for the orgs list, members, API keys, and audit viewer. No SPA
// and no client build step — this REUSES the exact view convention the base
// \`--frontend htmx\` scaffold uses (src/controllers/views.controller.ts +
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
    if (!org || !ctx.user) return;
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
   * AND the role may open \`view\`; otherwise it responds 403 with NO organization
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
`,
      },
      {
        path: 'src/modules/dashboard/auth-ui.controller.ts',
        flag: 'with-admin-ui',
        content: `// src/modules/dashboard/auth-ui.controller.ts
// Auth + RBAC management screens for the SaaS starter (overlay code — NOT framework code).
//
// Composes the official React component packages instead of hand-rolling forms
// (Requirement 9.3):
//   @streetjs/auth-ui  — LoginForm, RegisterForm, ForgotPasswordForm, MFASetup, ProfileSettings
//   @streetjs/admin-ui — UserManagement, RoleManager, AuditLogViewer, TenantSwitcher
//
// NO CLIENT BUILD STEP: each screen is a server-rendered htmx page that drops a React
// "island" mount point (partials/dashboard/react-island.html) and hydrates it from an
// ESM CDN declared in the page importmap (layouts/dashboard.html) — the same build-free
// approach the base htmx scaffold uses to load htmx.org from a CDN. The packages' own
// stylesheets (streetAuthCss / streetAdminCss) are injected server-side so the screens
// are styled before/without hydration.
//
// ROLE-GATING (Requirements 9.2, 9.5): RBAC management is owner/admin only — a member
// requesting it gets 403 with no data. Account (the user's own profile/MFA) is open to
// any member. The login/register/forgot screens are public.
//
// WIRING (src/main.ts):
//   app.registerController(AuthRbacController);   // /o/:slug/account, /o/:slug/rbac
//   app.registerController(AuthScreensController); // /auth/login, /auth/register, ...

import 'reflect-metadata';
import { Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';
import { streetAuthCss } from '@streetjs/auth-ui';
import { streetAdminCss } from '@streetjs/admin-ui';
import type { ActiveOrg, Role } from '../members/membership.service.js';

const MANAGE_ROLES: Role[] = ['owner', 'admin'];

/** Descriptor consumed by the react-island partial (mounts a component client-side). */
function island(
  pkg: string,
  component: string,
  props: Record<string, unknown> = {},
): { pkg: string; component: string; props: string } {
  return { pkg, component, props: JSON.stringify(props) };
}

@Controller('/o/:slug')
export class AuthRbacController {
  /** GET /o/:slug/account — the signed-in user's profile + MFA (auth-ui); any member. */
  @Get('/account')
  async account(ctx: StreetContext): Promise<void> {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org || !ctx.user) {
      ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403); // 9.4: no membership
      return;
    }
    ctx.htmx.view('dashboard/account', {
      title: 'Account',
      uiCss: streetAuthCss,
      profile: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'ProfileSettings', { userId: ctx.user.id }),
      ),
      mfa: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'MFASetup', { userId: ctx.user.id }),
      ),
    });
  }

  /** GET /o/:slug/rbac — RBAC management (admin-ui); owner/admin only. */
  @Get('/rbac')
  async rbac(ctx: StreetContext): Promise<void> {
    const org = ctx.org as ActiveOrg | undefined;
    if (!org || !MANAGE_ROLES.includes(org.role)) {
      ctx.htmx.view('dashboard/forbidden', { title: 'Forbidden' }, 403); // 9.5: 403, no data
      return;
    }
    ctx.htmx.view('dashboard/rbac', {
      title: 'RBAC',
      uiCss: streetAdminCss,
      users: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'UserManagement', { orgId: org.id }),
      ),
      roles: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'RoleManager', { orgId: org.id }),
      ),
      auditLog: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'AuditLogViewer', { orgId: org.id }),
      ),
      tenants: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/admin-ui', 'TenantSwitcher', { orgId: org.id }),
      ),
    });
  }
}

/** Public authentication screens rendered with @streetjs/auth-ui (Requirement 9.3). */
@Controller('/auth')
export class AuthScreensController {
  @Get('/login')
  async login(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Log in',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'LoginForm', { action: '/auth/login' }),
      ),
    });
  }

  @Get('/register')
  async register(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Create account',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'RegisterForm', { action: '/auth/register' }),
      ),
    });
  }

  @Get('/forgot-password')
  async forgotPassword(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard/auth', {
      title: 'Reset password',
      uiCss: streetAuthCss,
      form: ctx.htmx.engine.partial(
        'dashboard/react-island',
        island('@streetjs/auth-ui', 'ForgotPasswordForm', { action: '/auth/forgot-password' }),
      ),
    });
  }
}
`,
      },
      {
        path: 'src/views/layouts/dashboard.html',
        content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }} · Dashboard</title>
  <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/public/app.css">
  <!-- @streetjs/auth-ui / @streetjs/admin-ui stylesheet, injected server-side (empty on plain views). -->
  <style>{{{ uiCss }}}</style>
  <!-- No build step: React + the UI packages load from an ESM CDN, mirroring how htmx is loaded above. -->
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@18",
      "react-dom/client": "https://esm.sh/react-dom@18/client",
      "@streetjs/auth-ui": "https://esm.sh/@streetjs/auth-ui",
      "@streetjs/admin-ui": "https://esm.sh/@streetjs/admin-ui"
    }
  }
  </script>
  <script type="module" src="/public/islands.js"></script>
</head>
<body>
  {{{ nav }}}
  <main>{{{ body }}}</main>
</body>
</html>
`,
      },
      {
        path: 'src/views/partials/dashboard/react-island.html',
        content: `<!-- React island mount point. Hydrated client-side by /public/islands.js using the
     component named in data-street-component from the package in data-street-pkg.
     Server-rendered with no build step; props are passed as an escaped JSON attribute. -->
<div class="street-island" data-street-pkg="{{ pkg }}" data-street-component="{{ component }}" data-street-props="{{ props }}">
  <noscript>Enable JavaScript to load the {{ component }} screen.</noscript>
</div>
`,
      },
      {
        path: 'src/views/partials/dashboard/org-row.html',
        content: `<li class="org" id="org-{{ id }}"><a href="/o/{{ slug }}">{{ name }}</a> <span class="muted">{{ slug }}</span></li>
`,
      },
      {
        path: 'src/views/partials/dashboard/member-row.html',
        content: `<li class="member" id="member-{{ id }}"><span class="member-id">{{ user_id }}</span> <span class="badge">{{ role }}</span> {{{ actions }}}</li>
`,
      },
      {
        path: 'src/views/partials/dashboard/api-key-row.html',
        content: `<li class="api-key" id="api-key-{{ id }}"><strong>{{ name }}</strong> <code>{{ prefix }}</code> <span class="muted">{{ scopes }}</span> <time>{{ created_at }}</time></li>
`,
      },
      {
        path: 'src/views/partials/dashboard/audit-row.html',
        content: `<li class="audit" id="audit-{{ id }}"><time>{{ created_at }}</time> <span class="action">{{ action }}</span> <span class="muted">actor {{ actor_id }} → {{ target }}</span></li>
`,
      },
      {
        path: 'src/views/pages/dashboard/home.html',
        content: `<h1>{{ title }}</h1>
<p>Organization <strong>{{ slug }}</strong> · your role: <span class="badge">{{ role }}</span></p>
<ul class="dash-tiles">
  <li><a href="/o/{{ slug }}/orgs">Organizations</a></li>
  <li><a href="/o/{{ slug }}/members">Members</a></li>
</ul>
`,
      },
      {
        path: 'src/views/pages/dashboard/orgs.html',
        content: `<h1>{{ title }}</h1>
<ul id="orgs" class="org-list">{{{ orgs }}}</ul>
`,
      },
      {
        path: 'src/views/pages/dashboard/members.html',
        content: `<h1>{{ title }}</h1>
<!-- inviteForm is empty for non-owner/admin members (Requirement 9.2). -->
{{{ inviteForm }}}
<ul id="members" class="member-list">{{{ members }}}</ul>
`,
      },
      {
        path: 'src/views/pages/dashboard/api-keys.html',
        content: `<h1>{{ title }}</h1>
{{{ createForm }}}
<ul id="api-keys" class="api-key-list">{{{ keys }}}</ul>
`,
      },
      {
        path: 'src/views/pages/dashboard/audit.html',
        content: `<h1>{{ title }}</h1>
<ul id="audit" class="audit-list">{{{ entries }}}</ul>
`,
      },
      {
        path: 'src/views/pages/dashboard/account.html',
        content: `<h1>{{ title }}</h1>
<section class="auth-ui">
  <h2>Profile</h2>
  {{{ profile }}}
  <h2>Multi-factor authentication</h2>
  {{{ mfa }}}
</section>
`,
      },
      {
        path: 'src/views/pages/dashboard/rbac.html',
        content: `<h1>{{ title }}</h1>
<section class="admin-ui">
  <h2>Users</h2>{{{ users }}}
  <h2>Roles</h2>{{{ roles }}}
  <h2>Audit log</h2>{{{ auditLog }}}
  <h2>Tenants</h2>{{{ tenants }}}
</section>
`,
      },
      {
        path: 'src/views/pages/dashboard/auth.html',
        content: `<h1>{{ title }}</h1>
<section class="auth-ui">{{{ form }}}</section>
`,
      },
      {
        path: 'src/views/pages/dashboard/forbidden.html',
        content: `<h1>403 — Forbidden</h1>
<p>You do not have access to this organization or this view.</p>
`,
      },
      {
        path: 'public/islands.js',
        content: `// public/islands.js — hydrate @streetjs/auth-ui & @streetjs/admin-ui React islands.
// No build step: React and the UI packages resolve through the importmap declared in
// layouts/dashboard.html. Each [data-street-component] element renders its component
// with the JSON props carried in data-street-props.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

const PACKAGES = {
  '@streetjs/auth-ui': () => import('@streetjs/auth-ui'),
  '@streetjs/admin-ui': () => import('@streetjs/admin-ui'),
};

async function mount(el) {
  const pkgName = el.getAttribute('data-street-pkg');
  const componentName = el.getAttribute('data-street-component');
  const props = JSON.parse(el.getAttribute('data-street-props') || '{}');
  const loader = PACKAGES[pkgName];
  if (!loader) return;
  const mod = await loader();
  const Component = mod[componentName];
  if (!Component) return;
  createRoot(el).render(createElement(Component, props));
}

for (const el of document.querySelectorAll('[data-street-component]')) {
  mount(el).catch((err) => console.error('[street] island mount failed', err));
}
`,
      },
    ],
  },
  ecommerce: {
    packages: { '@streetjs/commerce': '^1.0.0' },
    description: 'Ecommerce starter: products, inventory, carts, orders, payments.',
    starter: {
      path: 'src/features/ecommerce.ts',
      content: `// Ecommerce feature wiring — catalog, inventory (no-oversell), checkout.
import { CommerceService } from '@streetjs/commerce';

export const shop = new CommerceService();
// const p = await shop.createProduct({ name: 'Widget', priceCents: 1500 });
`,
    },
    extraFiles: [
      {
        path: 'migrations/001_commerce.sql',
        content: `-- Marketplace/ecommerce schema — catalog, inventory, carts, orders, payments.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS products (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency    TEXT NOT NULL DEFAULT 'usd',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory (
  product_id BIGINT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0)
);

CREATE TABLE IF NOT EXISTS carts (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT,
  status     TEXT NOT NULL DEFAULT 'open',  -- open | ordered | abandoned
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cart_items (
  id         BIGSERIAL PRIMARY KEY,
  cart_id    BIGINT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id BIGINT NOT NULL REFERENCES products(id),
  quantity   INTEGER NOT NULL CHECK (quantity > 0),
  UNIQUE (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT,
  total_cents INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | shipped | cancelled
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id              BIGSERIAL PRIMARY KEY,
  order_id        BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id      BIGINT NOT NULL REFERENCES products(id),
  quantity        INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id               BIGSERIAL PRIMARY KEY,
  order_id         BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'stripe',
  provider_ref     TEXT,
  amount_cents     INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'requires_payment',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
`,
      },
      {
        path: 'COMMERCE.md',
        content: `# Marketplace / ecommerce starter

Scaffolded with \`street create --starter marketplace\`. Overlays a catalog →
cart → checkout → payment flow on the base app.

## Included

- **Catalog & inventory** — \`products\`, \`inventory\` (no-oversell via a CHECK constraint).
- **Carts** — \`carts\`, \`cart_items\`.
- **Orders** — \`orders\`, \`order_items\` (immutable unit price at purchase time).
- **Payments** — \`payments\` (Stripe-ready; add \`@streetjs/plugin-stripe\`).
- **Search** — add \`@streetjs/search\` for product search (PG full-text default).

## Schema

See \`migrations/001_commerce.sql\` — apply with \`street migrate:run\`.

## Suggested order flow

1. \`POST /carts\` → open cart · 2. \`POST /carts/:id/items\` → add product
3. \`POST /orders\` → snapshot cart to order · 4. payment webhook marks order \`paid\`.

Generate modules with \`street generate controller|service|repository <name>\`.
See the [Starters guide](https://hassanmubiru.github.io/StreetJS/starters/).
`,
      },
    ],
  },
  'realtime-chat': {
    packages: { '@streetjs/social-users': '^1.0.0' },
    description: 'Realtime chat starter: WebSocket channels, presence, typing.',
    starter: {
      path: 'src/features/chat.ts',
      content: `// Realtime chat wiring — channels, presence, typing over WebSockets.
import { StreetWebSocketServer, ChannelHub } from 'streetjs';

export const hub = new ChannelHub({ typingTtlMs: 5000 });
export const wss = new StreetWebSocketServer();
`,
    },
    extraFiles: [
      {
        path: 'migrations/001_realtime.sql',
        content: `-- Realtime chat schema — channels, membership and message history.
-- Apply with: street migrate:run  (PostgreSQL syntax; adjust types for SQLite).

CREATE TABLE IF NOT EXISTS channels (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  is_private BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  channel_id BIGINT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    BIGINT NOT NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_created ON messages(channel_id, created_at DESC);
`,
      },
      {
        path: 'REALTIME.md',
        content: `# Realtime chat starter

Scaffolded with \`street create --starter realtime\`. Overlays WebSocket channels,
presence and typing indicators on the base app.

## Included

- **WebSocket server** — bounded \`StreetWebSocketServer\` with heartbeat.
- **Channels & presence** — \`ChannelHub\` (typing TTL configurable) in \`src/features/chat.ts\`.
- **Message history** — \`channels\`, \`channel_members\`, \`messages\` (see migration).
- **Auth-on-upgrade** — gate the WS upgrade with the core auth middleware.

## Schema

See \`migrations/001_realtime.sql\` — apply with \`street migrate:run\`.

## Flow

Client connects → authenticates on upgrade → joins a channel → messages are
broadcast to channel members and persisted to \`messages\`. Presence/typing are
in-memory via \`ChannelHub\`. For multi-instance fan-out, add \`@streetjs/plugin-redis\`.

See the [Starters guide](https://hassanmubiru.github.io/StreetJS/starters/) and
[Realtime docs](https://hassanmubiru.github.io/StreetJS/realtime/).
`,
      },
    ],
  },
  'dating-app': {
    packages: { '@streetjs/dating-profiles': '^1.0.0' },
    description: 'Dating-app starter: profiles, likes, reciprocal matching.',
    starter: {
      path: 'src/features/dating.ts',
      content: `// Dating-app wiring — encrypted profiles, likes, reciprocal matches.
import { ProfileService } from '@streetjs/dating-profiles';
import { FieldCipher, Keyring } from 'streetjs';
import { randomBytes } from 'node:crypto';

export const profiles = new ProfileService({ cipher: new FieldCipher(Keyring.fromKey(randomBytes(32))) });
`,
    },
  },
  ai: {
    packages: { '@streetjs/ai': '^1.0.0' },
    description: 'AI starter: provider-agnostic chat, embeddings and RAG (OpenAI/Anthropic/Ollama).',
    starter: {
      path: 'src/features/ai.ts',
      content: `// AI feature wiring — provider-agnostic chat + retrieval (RAG).
import { InMemoryVectorStore } from '@streetjs/ai';

// In-memory vector store for local/dev; swap for a persistent store in production.
export const vectors = new InMemoryVectorStore();

// Configure a provider (OpenAI / Anthropic / Ollama) and uncomment to enable chat + RAG:
// import { ChatSession, RagPipeline } from '@streetjs/ai';
// export const chat = new ChatSession({ provider });
// export const rag = new RagPipeline({ store: vectors, provider });
`,
    },
  },
};



export class CreateCommand {
  async execute(ctx: CliContext): Promise<void> {
    const projectName = ctx.args.positional[0];

    if (!projectName) {
      console.error('[street] Usage: street create <project-name>');
      process.exitCode = 1;
      return;
    }

    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(projectName)) {
      console.error('[street] Project name must start with a letter or number and contain only letters, numbers, hyphens, and underscores.');
      process.exitCode = 1;
      return;
    }

    const targetDir = resolve(ctx.cwd, projectName);

    // Template variant (default 'app'). Variants overlay extra @streetjs
    // packages + a starter module on top of the base scaffold. `--starter` is a
    // friendly alias of `--template` (the documented Phase-18 flag); both work.
    // Starter aliases map convenient names to the underlying template keys.
    const STARTER_ALIASES: Record<string, string> = {
      realtime: 'realtime-chat',
      chat: 'realtime-chat',
      marketplace: 'ecommerce',
      dating: 'dating-app',
    };
    const requested = String(ctx.args.flags['starter'] ?? ctx.args.flags['template'] ?? 'app');
    const template = STARTER_ALIASES[requested] ?? requested;
    if (!TEMPLATES[template]) {
      const available = [...Object.keys(TEMPLATES), ...Object.keys(STARTER_ALIASES)].join(', ');
      console.error(`[street] Unknown starter "${requested}". Available: ${available}`);
      process.exitCode = 1;
      return;
    }

    // Optional frontend scaffold (default 'none'). Adds a `web/` app wired to
    // @streetjs/client + @streetjs/react, plus a CI workflow that builds both.
    const frontend = String(ctx.args.flags['frontend'] ?? 'none').toLowerCase();
    const FRONTENDS = ['none', 'react', 'next', 'htmx'];
    if (!FRONTENDS.includes(frontend)) {
      console.error(`[street] Unknown frontend "${frontend}". Available: ${FRONTENDS.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Database driver (default 'sqlite' — zero-config, works out of the box with
    // no local database server or credentials). 'postgres' is for production;
    // its generated startup validates credentials and degrades gracefully rather
    // than crashing when the database is unreachable.
    const database = String(ctx.args.flags['database'] ?? 'sqlite').toLowerCase();
    const DATABASES = ['sqlite', 'postgres'];
    if (!DATABASES.includes(database)) {
      console.error(`[street] Unknown database "${database}". Available: ${DATABASES.join(', ')}`);
      process.exitCode = 1;
      return;
    }

    // Opt-in starter flags. The default `--starter saas` scaffold is
    // dependency-minimal (only `streetjs` + @streetjs/plugin-htmx); these flags
    // add optional, published-package-backed features on demand:
    //   --with-billing   Stripe billing webhook controller (@streetjs/plugin-stripe)
    //   --with-admin-ui  auth/RBAC React management screens (@streetjs/auth-ui + admin-ui)
    //   --with-email     transactional email via @streetjs/plugin-sendgrid (injected Mailer)
    //   --with-marzpay   MarzPay billing modules + dashboard (@streetjs/plugin-marzpay)
    // Each flag gates the matching overlay file(s) and adds only the deps those
    // files import, so unflagged scaffolds never reference packages they don't use.
    const starterFlags = new Set<string>();
    if (ctx.args.flags['with-billing']) starterFlags.add('with-billing');
    if (ctx.args.flags['with-admin-ui']) starterFlags.add('with-admin-ui');
    if (ctx.args.flags['with-email']) starterFlags.add('with-email');
    if (ctx.args.flags['with-marzpay']) starterFlags.add('with-marzpay');

    // Check if target already exists
    try {
      const existing = await stat(targetDir);
      if (existing.isDirectory()) {
        console.error(`[street] Directory "${projectName}" already exists.`);
        process.exitCode = 1;
        return;
      }
    } catch {
      // Directory does not exist — proceed
    }

    console.log(`[street] Creating new Street project: ${projectName}`);
    console.log(`[street] Target: ${targetDir}\n`);

    // Create project directory
    await mkdir(targetDir, { recursive: true });

    // Scaffold all files
    await this.scaffoldProject(targetDir, projectName, database);

    // Apply the template overlay (extra deps + starter module + notes).
    await this.applyTemplate(targetDir, template, starterFlags);

    // Scaffold an optional frontend app + a CI workflow that builds both tiers.
    if (frontend !== 'none') {
      await this.scaffoldFrontend(targetDir, frontend, projectName);
    }
    await this.scaffoldCI(targetDir, frontend);

    console.log(`\n[street] Project "${projectName}" created successfully!\n`);

    // Optional: auto-install dependencies
    const shouldInstall = ctx.args.flags['install'] || ctx.args.flags['i'];
    if (shouldInstall) {
      console.log('[street] Installing dependencies...\n');
      await this.installDependencies(targetDir);
    } else {
      // Generate a package-lock.json so the scaffolded Dockerfile's `npm ci`
      // works out of the box and installs are reproducible. Skip with
      // --no-lockfile (e.g. offline scaffolding). Fail-soft: never blocks the
      // scaffold if npm/network is unavailable.
      if (!ctx.args.flags['no-lockfile']) {
        await this.generateLockfile(targetDir);
      }
      console.log('Next steps:');
      console.log(`  cd ${projectName}`);
      console.log('  npm install');
      console.log('  street dev');
      console.log('');
      console.log('Tip: use --install (or -i) to auto-install dependencies.\n');
    }
  }

  private async scaffoldProject(targetDir: string, projectName: string, database = 'sqlite'): Promise<void> {
    // ── Create all directories first ────────────────────────────────────────
    await mkdir(join(targetDir, 'src', 'controllers'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'services'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'repositories'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'middleware'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'gateways'), { recursive: true });
    await mkdir(join(targetDir, 'migrations'), { recursive: true });
    await mkdir(join(targetDir, 'tests'), { recursive: true });
    await mkdir(join(targetDir, 'uploads'), { recursive: true });
    await mkdir(join(targetDir, 'docker-init'), { recursive: true });

    // ── Generate project files ────────────────────────────────────────────

    // package.json
    await writeFile(
      join(targetDir, 'package.json'),
      this.renderPackageJson(projectName),
      'utf8'
    );

    // street.config.ts
    await writeFile(
      join(targetDir, 'street.config.ts'),
      this.renderStreetConfig(projectName, database),
      'utf8'
    );

    // src/main.ts
    await writeFile(
      join(targetDir, 'src/main.ts'),
      this.renderMainTs(database),
      'utf8'
    );

    // src/controllers/example.controller.ts
    await writeFile(
      join(targetDir, 'src/controllers/example.controller.ts'),
      this.renderExampleController(),
      'utf8'
    );

    // src/controllers/health.controller.ts
    await writeFile(
      join(targetDir, 'src/controllers/health.controller.ts'),
      this.renderHealthController(),
      'utf8'
    );

    // src/services/example.service.ts
    await writeFile(
      join(targetDir, 'src/services/example.service.ts'),
      this.renderExampleService(),
      'utf8'
    );

    // src/repositories/example.repository.ts
    await writeFile(
      join(targetDir, 'src/repositories/example.repository.ts'),
      this.renderExampleRepository(database),
      'utf8'
    );

    // src/middleware/auth.ts
    await writeFile(
      join(targetDir, 'src/middleware/auth.ts'),
      this.renderAuthMiddleware(),
      'utf8'
    );

    // src/gateways/chat.gateway.ts
    await writeFile(
      join(targetDir, 'src/gateways/chat.gateway.ts'),
      this.renderChatGateway(),
      'utf8'
    );

    // tsconfig.json
    await writeFile(
      join(targetDir, 'tsconfig.json'),
      this.renderTsconfig(),
      'utf8'
    );

    // Dockerfile
    await writeFile(
      join(targetDir, 'Dockerfile'),
      this.renderDockerfile(),
      'utf8'
    );

    // docker-compose.yml
    await writeFile(
      join(targetDir, 'docker-compose.yml'),
      this.renderDockerCompose(database),
      'utf8'
    );

    // docker-init/001_enable_pgcrypto.sql
    await writeFile(
      join(targetDir, 'docker-init/001_enable_pgcrypto.sql'),
      'CREATE EXTENSION IF NOT EXISTS pgcrypto;\n',
      'utf8'
    );

    // .env.example
    await writeFile(
      join(targetDir, '.env.example'),
      this.renderEnvExample(database),
      'utf8'
    );

    // .gitignore
    await writeFile(
      join(targetDir, '.gitignore'),
      this.renderGitignore(),
      'utf8'
    );

    // tests/integration.test.ts
    await writeFile(
      join(targetDir, 'tests/integration.test.ts'),
      this.renderTestFile(),
      'utf8'
    );

    // migrations/.gitkeep
    await writeFile(join(targetDir, 'migrations', '.gitkeep'), '', 'utf8');

    // uploads/.gitkeep
    await writeFile(join(targetDir, 'uploads', '.gitkeep'), '', 'utf8');

    // README.md
    await writeFile(
      join(targetDir, 'README.md'),
      this.renderReadme(projectName),
      'utf8'
    );
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Generate a `package-lock.json` for the freshly scaffolded project without
   * installing node_modules (`npm install --package-lock-only`). This makes the
   * scaffolded Dockerfile's `npm ci` work out of the box and gives reproducible,
   * integrity-pinned installs. Fail-soft: if npm or the network is unavailable
   * the scaffold still succeeds (the user can run `npm install` later).
   */
  /**
   * Overlay a template variant on top of the base scaffold: merge extra
   * @streetjs dependencies into package.json, write a starter module, and a
   * TEMPLATE.md note. The 'app' template is a no-op overlay.
   *
   * `enabledFlags` are the opt-in flags (e.g. `with-billing`, `with-admin-ui`)
   * the caller passed. Flag-gated extraFiles are written ONLY when their flag is
   * enabled, and each enabled flag's `flagPackages` are merged into the deps —
   * keeping the default scaffold dependency-minimal and installable.
   */
  private async applyTemplate(
    targetDir: string,
    template: string,
    enabledFlags: Set<string> = new Set<string>(),
  ): Promise<void> {
    const spec = TEMPLATES[template];
    if (!spec || template === 'app') return;

    // Always-on deps + opt-in deps for each enabled flag.
    let deps: Record<string, string> = { ...spec.packages };
    for (const flag of enabledFlags) {
      const flagDeps = spec.flagPackages?.[flag];
      if (flagDeps) deps = { ...deps, ...flagDeps };
    }

    // Merge dependencies into package.json.
    const pkgPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
    pkg.dependencies = { ...(pkg.dependencies ?? {}), ...deps };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    // Write the starter module.
    if (spec.starter.path) {
      const starterAbs = join(targetDir, spec.starter.path);
      await mkdir(join(starterAbs, '..'), { recursive: true });
      await writeFile(starterAbs, spec.starter.content, 'utf8');
    }

    // Write any additional overlay files (migrations, docs, env samples). A
    // file tagged with `flag` is written ONLY when that opt-in flag is enabled;
    // untagged files are always written (the dependency-minimal default).
    for (const file of spec.extraFiles ?? []) {
      if (file.flag && !enabledFlags.has(file.flag)) continue;
      const abs = join(targetDir, file.path);
      await mkdir(join(abs, '..'), { recursive: true });
      await writeFile(abs, file.content, 'utf8');
    }

    // Write a TEMPLATE.md note.
    await writeFile(
      join(targetDir, 'TEMPLATE.md'),
      `# Template: ${template}\n\n${spec.description}\n\nAdded packages: ${Object.keys(deps).join(', ') || '(none)'}\nStarter module: ${spec.starter.path || '(none)'}\n`,
      'utf8',
    );

    console.log(`[street] Applied "${template}" template: ${spec.description}`);
  }

  /**
   * Scaffold an optional frontend app under `web/`, wired to the backend via
   * @streetjs/client + @streetjs/react. 'react' produces a Vite SPA; 'next'
   * produces a minimal App-Router Next.js app. The frontend is a sibling app
   * (its own package.json) — it never becomes a dependency of the backend.
   */
  private async scaffoldFrontend(targetDir: string, frontend: string, projectName: string): Promise<void> {
    const webDir = join(targetDir, 'web');
    if (frontend === 'react') {
      await mkdir(join(webDir, 'src'), { recursive: true });
      await writeFile(join(webDir, 'package.json'), this.renderWebReactPackageJson(projectName), 'utf8');
      await writeFile(join(webDir, 'tsconfig.json'), this.renderWebReactTsconfig(), 'utf8');
      await writeFile(join(webDir, 'vite.config.ts'), this.renderViteConfig(), 'utf8');
      await writeFile(join(webDir, 'index.html'), this.renderWebIndexHtml(projectName), 'utf8');
      await writeFile(join(webDir, 'src', 'main.tsx'), this.renderWebReactMain(), 'utf8');
      await writeFile(join(webDir, 'src', 'App.tsx'), this.renderWebReactApp(projectName), 'utf8');
      await writeFile(join(webDir, '.env.example'), 'VITE_API_URL=http://localhost:3000\n', 'utf8');
      // MarzPay React overlay: client lib + four billing pages. Written whenever
      // the React frontend is selected (Requirements 5.4, 5.5, 8.1–8.5).
      await this.scaffoldReactMarzPay(webDir);
      console.log('[street] Scaffolded React (Vite) frontend in web/.');
    } else if (frontend === 'next') {
      await mkdir(join(webDir, 'app'), { recursive: true });
      await writeFile(join(webDir, 'package.json'), this.renderWebNextPackageJson(projectName), 'utf8');
      await writeFile(join(webDir, 'tsconfig.json'), this.renderWebNextTsconfig(), 'utf8');
      await writeFile(join(webDir, 'next.config.mjs'), this.renderNextConfig(), 'utf8');
      await writeFile(join(webDir, 'app', 'layout.tsx'), this.renderNextLayout(projectName), 'utf8');
      await writeFile(join(webDir, 'app', 'page.tsx'), this.renderNextPage(projectName), 'utf8');
      await writeFile(join(webDir, 'app', 'providers.tsx'), this.renderNextProviders(), 'utf8');
      await writeFile(join(webDir, 'app', 'globals.css'), this.renderNextGlobalsCss(), 'utf8');
      await writeFile(join(webDir, '.env.example'), 'NEXT_PUBLIC_API_URL=http://localhost:3000\n', 'utf8');
      // MarzPay Next.js App Router overlay: client helpers, billing/success/cancel
      // routes, and a server-side webhook example. Written whenever the Next
      // frontend is selected (Requirements 5.4, 5.5, 9.1–9.5).
      await this.scaffoldNextMarzPay(webDir);
      console.log('[street] Scaffolded Next.js (App Router) frontend in web/.');
    } else if (frontend === 'htmx') {
      await this.scaffoldHtmx(targetDir);
    }
  }

  /**
   * Scaffold an HTMX (server-rendered) frontend *into the backend* — HTMX has no
   * separate SPA, so this adds a views tree, a views controller, and the
   * @streetjs/plugin-htmx dependency. The app renders HTML; HTMX swaps fragments.
   */
  private async scaffoldHtmx(targetDir: string): Promise<void> {
    // Add the plugin dependency. HTMX has no separate web/ app, so the MarzPay
    // overlay (server-rendered fragments + controller, written below) lives in
    // the backend — its `@streetjs/plugin-marzpay` dependency is added to the
    // backend package.json alongside @streetjs/plugin-htmx (Requirement 5.4: the
    // dependency ships because the `htmx` frontend was selected).
    const pkgPath = join(targetDir, 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
    pkg.dependencies = {
      ...(pkg.dependencies ?? {}),
      '@streetjs/plugin-htmx': '^1.0.0',
      '@streetjs/plugin-marzpay': '^1.0.0',
    };
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

    await mkdir(join(targetDir, 'src', 'views', 'layouts'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'views', 'partials'), { recursive: true });
    await mkdir(join(targetDir, 'src', 'views', 'pages'), { recursive: true });
    await mkdir(join(targetDir, 'public'), { recursive: true });

    const layout = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ title }}</title>
  <script src="https://unpkg.com/htmx.org@2.0.4" crossorigin="anonymous"></script>
  <link rel="stylesheet" href="/public/app.css">
</head>
<body>
  {{> nav }}
  <main>{{{ body }}}</main>
</body>
</html>
`;
    const nav = `<nav><a href="/">Home</a> · <a href="/dashboard">Dashboard</a> · <a href="/login">Login</a></nav>\n`;
    const todoItem = `<li id="todo-{{ id }}">{{ text }}</li>\n`;
    const home = `<h1>{{ title }}</h1>
<p>A server-rendered StreetJS + HTMX app. No SPA, no build step.</p>
<form hx-post="/todos" hx-target="#todos" hx-swap="beforeend" hx-on::after-request="this.reset()">
  <input name="text" placeholder="Add a todo" required>
  <button type="submit">Add</button>
</form>
<ul id="todos">{{{ todos }}}</ul>
`;
    const login = `<h1>Log in</h1>
<form hx-post="/login" hx-target="#error">
  <div id="error"></div>
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Log in</button>
</form>
`;
    const register = `<h1>Create account</h1>
<form hx-post="/register" hx-target="#error">
  <div id="error"></div>
  <input name="email" type="email" placeholder="Email" required>
  <input name="password" type="password" placeholder="Password" required>
  <button type="submit">Sign up</button>
</form>
`;
    const dashboard = `<h1>Dashboard</h1>
<p>Welcome, {{ user.email }}.</p>
<div hx-get="/notifications" hx-trigger="every 5s" hx-swap="innerHTML">Loading notifications…</div>
`;
    await writeFile(join(targetDir, 'src/views/layouts/main.html'), layout, 'utf8');
    await writeFile(join(targetDir, 'src/views/partials/nav.html'), nav, 'utf8');
    await writeFile(join(targetDir, 'src/views/partials/todo-item.html'), todoItem, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/home.html'), home, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/login.html'), login, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/register.html'), register, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/dashboard.html'), dashboard, 'utf8');
    await writeFile(join(targetDir, 'public', 'app.css'), 'body{font-family:system-ui,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;line-height:1.6}nav{margin-bottom:2rem}\n', 'utf8');

    const controller = `import 'reflect-metadata';
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

// HTMX views controller. \`ctx.htmx\` is attached by HtmxPlugin.middleware()
// (registered in main.ts). \`view()\` returns the full layout on navigation and
// just the page fragment on an HTMX request.
@Controller('/')
export class ViewsController {
  private todos: { id: number; text: string }[] = [];
  private nextId = 1;

  @Get('/')
  async home(ctx: StreetContext): Promise<void> {
    const todos = this.todos.map((t) => ctx.htmx.engine.partial('todo-item', t)).join('');
    ctx.htmx.view('home', { title: 'Home', todos });
  }

  @Post('/todos')
  async addTodo(ctx: StreetContext): Promise<void> {
    const { text } = ctx.body as { text: string };
    const todo = { id: this.nextId++, text };
    this.todos.push(todo);
    ctx.htmx.hx({ trigger: 'todoAdded' }).partial('todo-item', todo); // returns just the new <li>
  }

  @Get('/dashboard')
  async dashboard(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('dashboard', { title: 'Dashboard', user: { email: 'you@example.com' } });
  }

  @Get('/login')
  async login(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('login', { title: 'Log in' });
  }

  @Get('/register')
  async register(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('register', { title: 'Create account' });
  }
}
`;
    await writeFile(join(targetDir, 'src/controllers/views.controller.ts'), controller, 'utf8');

    // ── MarzPay HTMX overlay (Requirements 5.4, 5.5, 7.1–7.6) ────────────────
    // Written because the `htmx` frontend was selected. Server-rendered fragments
    // (no SPA/client build step) for payment initialization, payment redirect
    // handling, payment status, and subscription management — each driven by an
    // `hx-post` form — plus a MarzPay controller that calls the injected
    // MarzPayClient (`ctx.state['marzpay']`, injected by MarzPayPlugin) and
    // returns the verified redirect/status fragment, or a FAILURE fragment (never
    // a redirect fragment) on error or a non-success result.
    await this.scaffoldHtmxMarzPay(targetDir);

    const note = `# HTMX frontend

This project renders HTML on the server and uses [HTMX](https://htmx.org) to swap
fragments — no SPA, no client build step. Powered by \`@streetjs/plugin-htmx\`.

## Wire it up (one-time)

Add these lines to \`src/main.ts\`:

\`\`\`ts
import HtmxPlugin from '@streetjs/plugin-htmx';
import { MarzPayPlugin } from '@streetjs/plugin-marzpay';
import { ViewsController } from './controllers/views.controller.js';
import { MarzPayViewsController } from './controllers/marzpay.controller.js';

// after the other app.use(...) middleware:
app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'main' }));
// MarzPay injects a client into ctx.state['marzpay'] for the controller below:
app.use(MarzPayPlugin({ apiKey: process.env.MARZPAY_API_KEY!, secretKey: process.env.MARZPAY_SECRET!, environment: 'sandbox' }));
// with the other app.registerController(...) calls:
app.registerController(ViewsController);
app.registerController(MarzPayViewsController);
\`\`\`

## MarzPay (server-rendered, no SPA)

\`@streetjs/plugin-marzpay\` powers server-rendered checkout. The fragments under
\`src/views/pages/marzpay/\` submit via \`hx-post\`; \`marzpay.controller.ts\` calls the
injected client and swaps in the response:

\`\`\`
src/views/pages/marzpay/
  checkout.html       # payment initialization form (hx-post /marzpay/checkout)
  redirect.html       # redirect-handling fragment (verified redirect_url)
  status.html         # payment status display (hx-post /marzpay/status)
  subscription.html   # subscription management (hx-post /marzpay/subscription)
  failure.html        # failure fragment — returned on error/non-success, never a redirect
src/controllers/marzpay.controller.ts
\`\`\`

On a verified card initialization the controller returns the redirect fragment
(and an \`HX-Redirect\` to MarzPay's \`redirect_url\`); on error or a non-success
result it returns the failure fragment and never a redirect.

## Layout

\`\`\`
src/views/
  layouts/main.html      # contains {{{ body }}}; loads htmx
  partials/              # nav, todo-item
  pages/                 # home, login, register, dashboard
public/app.css
\`\`\`

Template syntax: \`{{ x }}\` (escaped), \`{{{ x }}}\` (raw), \`{{> name }}\` (partial).
Compose lists by rendering partials in the controller (see \`views.controller.ts\`).

Docs: https://hassanmubiru.github.io/StreetJS/starters/
`;
    await writeFile(join(targetDir, 'HTMX.md'), note, 'utf8');
    console.log('[street] Scaffolded HTMX (server-rendered) views in src/views/ + @streetjs/plugin-htmx.');
    console.log('[street] Scaffolded MarzPay HTMX fragments (src/views/pages/marzpay/) + controller + @streetjs/plugin-marzpay.');
  }

  /**
   * Scaffold the MarzPay HTMX overlay into the backend (server-rendered only).
   *
   * Writes four DISTINCT `hx-post`-driven fragments — payment initialization,
   * payment redirect handling, payment status, and subscription management — plus
   * a failure fragment, and a controller that calls the injected `MarzPayClient`
   * (`ctx.state['marzpay']`). On a verified success the controller returns the
   * redirect fragment (with an `HX-Redirect` to the verified `redirect_url`) or
   * the status fragment; on an error OR a non-success result it returns the
   * failure fragment and NEVER a redirect fragment (Requirements 7.1–7.6). No SPA
   * or client build step is involved — everything renders via `ctx.htmx`.
   */
  private async scaffoldHtmxMarzPay(targetDir: string): Promise<void> {
    await mkdir(join(targetDir, 'src', 'views', 'pages', 'marzpay'), { recursive: true });

    // (1) Payment initialization fragment — hx-post form -> POST /marzpay/checkout.
    const checkout = `<section id="marzpay-checkout" class="marzpay">
  <h2>Pay with MarzPay</h2>
  <form hx-post="/marzpay/checkout" hx-target="#marzpay-result" hx-swap="innerHTML">
    <label>Amount <input name="amount" type="number" min="1" step="1" value="{{ amount }}" required></label>
    <label>Currency <input name="currency" value="{{ currency }}" required></label>
    <label>Country <input name="country" value="{{ country }}" required></label>
    <label>Reference <input name="reference" value="{{ reference }}" placeholder="unique reference (UUID)" required></label>
    <button type="submit">Pay now</button>
  </form>
  <div id="marzpay-result"></div>
</section>
`;

    // (2) Payment redirect-handling fragment — returned on a verified card init
    // that yields a redirect_url. The controller also sets HX-Redirect so HTMX
    // navigates the browser to MarzPay; this fragment is the no-JS fallback.
    const redirect = `<div id="marzpay-redirect" class="marzpay-redirect">
  <h2>Redirecting to MarzPay…</h2>
  <p>Payment <code>{{ reference }}</code> was initialized. You are being sent to the secure MarzPay payment page.</p>
  <p>If you are not redirected automatically, <a href="{{ redirectUrl }}">continue to payment</a>.</p>
</div>
`;

    // (3) Payment status fragment — displays a verified status and offers an
    // hx-post refresh -> POST /marzpay/status (verifyPayment by reference).
    const status = `<section id="marzpay-status" class="marzpay">
  <h2>Payment status</h2>
  <p>Reference <code>{{ reference }}</code>: <strong>{{ status }}</strong></p>
  <form hx-post="/marzpay/status" hx-target="#marzpay-status" hx-swap="outerHTML">
    <input type="hidden" name="reference" value="{{ reference }}">
    <button type="submit">Refresh status</button>
  </form>
</section>
`;

    // (4) Subscription management fragment — hx-post form -> POST /marzpay/subscription.
    // Selecting a plan starts a MarzPay payment for that plan (initializePayment).
    const subscription = `<section id="marzpay-subscription" class="marzpay">
  <h2>Subscription</h2>
  <p>Current plan: <strong>{{ planName }}</strong> ({{ planStatus }})</p>
  <form hx-post="/marzpay/subscription" hx-target="#marzpay-subscription" hx-swap="outerHTML">
    <label>Plan
      <select name="planId" required>
        <option value="basic">Basic</option>
        <option value="pro">Pro</option>
      </select>
    </label>
    <button type="submit">Subscribe / change plan</button>
  </form>
</section>
`;

    // Failure fragment — returned on error OR a non-success init/verify result.
    // It NEVER contains a redirect; no HX-Redirect header is set on this path.
    const failure = `<div id="marzpay-failure" class="marzpay-failure" role="alert">
  <h2>{{ title }}</h2>
  <p>{{ message }}</p>
  <p>No redirect was performed. Please review the details and try again.</p>
</div>
`;

    await writeFile(join(targetDir, 'src/views/pages/marzpay/checkout.html'), checkout, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/marzpay/redirect.html'), redirect, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/marzpay/status.html'), status, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/marzpay/subscription.html'), subscription, 'utf8');
    await writeFile(join(targetDir, 'src/views/pages/marzpay/failure.html'), failure, 'utf8');

    const controller = `import 'reflect-metadata';
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { MarzPayClient, PaymentInitResult } from '@streetjs/plugin-marzpay';

// MarzPay HTMX controller (server-rendered fragments — no SPA, no client build).
//
// The MarzPayClient is injected by MarzPayPlugin into \`ctx.state['marzpay']\`.
// Each handler renders via \`ctx.htmx\`, which returns just the page fragment for
// HTMX (\`hx-post\`) requests and the full layout on direct navigation.
//
// Requirement 7.5 is the critical invariant: when \`initializePayment\` throws OR
// returns a non-success result, the controller returns the FAILURE fragment and
// never a redirect fragment (and sets no HX-Redirect header).

// Verified MarzPay status vocabulary (Research_Artifact): a terminal failure is
// \`failed\` or \`cancelled\`. \`successful\`/\`completed\`/\`processing\`/\`pending\`/
// \`sandbox\` are not failures. A non-empty redirect_url (card flow) is success.
const FAILED_STATUSES = new Set<string>(['failed', 'cancelled']);

function isSuccessfulInit(result: PaymentInitResult): boolean {
  if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') return true;
  return !FAILED_STATUSES.has((result.status ?? '').toLowerCase());
}

function clientOf(ctx: StreetContext): MarzPayClient | undefined {
  return (ctx.state as Record<string, unknown>)['marzpay'] as MarzPayClient | undefined;
}

interface CheckoutBody { amount?: string; currency?: string; country?: string; reference?: string }
interface StatusBody { reference?: string }
interface SubscriptionBody { planId?: string }

// Illustrative plan catalogue for the HTMX overlay. A real app reads plans from
// configuration (see the SaaS billing modules); these are scaffold defaults.
const PLANS: Record<string, { name: string; amount: number; currency: string }> = {
  basic: { name: 'Basic', amount: 10000, currency: 'UGX' },
  pro: { name: 'Pro', amount: 30000, currency: 'UGX' },
};

@Controller('/marzpay')
export class MarzPayViewsController {
  /** Render the payment initialization (checkout) fragment. */
  @Get('/checkout')
  async checkout(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('marzpay/checkout', {
      title: 'Checkout',
      amount: 10000,
      currency: 'UGX',
      country: 'UG',
      reference: '',
    });
  }

  /** hx-post: initialize a MarzPay payment; return the redirect/status fragment. */
  @Post('/checkout')
  async initialize(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as CheckoutBody;
    await this.startPayment(ctx, {
      amount: Number(body.amount),
      currency: (body.currency ?? '').trim(),
      country: (body.country ?? '').trim(),
      reference: (body.reference ?? '').trim(),
    });
  }

  /** Render the subscription management fragment. */
  @Get('/subscription')
  async subscription(ctx: StreetContext): Promise<void> {
    ctx.htmx.view('marzpay/subscription', {
      title: 'Subscription',
      planName: 'None',
      planStatus: 'inactive',
    });
  }

  /** hx-post: start a MarzPay payment for the selected plan (initializePayment). */
  @Post('/subscription')
  async subscribe(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as SubscriptionBody;
    const planId = (body.planId ?? '').trim();
    const plan = PLANS[planId];
    if (plan === undefined) {
      // Unknown plan: a non-success outcome -> failure fragment, no redirect.
      ctx.htmx.view('marzpay/failure', {
        title: 'Subscription failed',
        message: \`Unknown plan "\${planId}".\`,
      }, 400);
      return;
    }
    await this.startPayment(ctx, {
      amount: plan.amount,
      currency: plan.currency,
      country: 'UG',
      reference: \`sub-\${planId}-\${Date.now()}\`,
    });
  }

  /** hx-post: verify a payment by reference; return the status fragment. */
  @Post('/status')
  async status(ctx: StreetContext): Promise<void> {
    const body = (ctx.body ?? {}) as StatusBody;
    const reference = (body.reference ?? '').trim();
    const client = clientOf(ctx);
    if (client === undefined) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Status unavailable',
        message: 'MarzPay is not configured on this server.',
      }, 500);
      return;
    }
    try {
      const result = await client.verifyPayment(reference);
      ctx.htmx.view('marzpay/status', { title: 'Payment status', reference: result.reference, status: result.status });
    } catch (err) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Status unavailable',
        message: err instanceof Error ? err.message : 'Could not verify payment status.',
      }, 200);
    }
  }

  /**
   * Shared initialization path. On a verified success with a redirect_url it
   * returns the redirect fragment (and sets HX-Redirect); on a verified success
   * without a redirect it returns the status fragment; on an error OR a
   * non-success result it returns the failure fragment and NO redirect (R7.5).
   */
  private async startPayment(
    ctx: StreetContext,
    req: { amount: number; currency: string; country: string; reference: string },
  ): Promise<void> {
    const client = clientOf(ctx);
    if (client === undefined) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Payment failed',
        message: 'MarzPay is not configured on this server.',
      }, 500);
      return;
    }
    try {
      const result = await client.initializePayment({
        amount: req.amount,
        currency: req.currency,
        country: req.country,
        reference: req.reference,
        method: 'card',
      });
      if (!isSuccessfulInit(result)) {
        ctx.htmx.view('marzpay/failure', {
          title: 'Payment failed',
          message: \`Payment could not be initialized (status: \${result.status}).\`,
        }, 200);
        return;
      }
      if (typeof result.redirectUrl === 'string' && result.redirectUrl.trim() !== '') {
        ctx.htmx
          .hx({ redirect: result.redirectUrl })
          .view('marzpay/redirect', { title: 'Redirecting', reference: result.reference, redirectUrl: result.redirectUrl });
        return;
      }
      ctx.htmx.view('marzpay/status', { title: 'Payment status', reference: result.reference, status: result.status });
    } catch (err) {
      ctx.htmx.view('marzpay/failure', {
        title: 'Payment failed',
        message: err instanceof Error ? err.message : 'Payment initialization failed.',
      }, 200);
    }
  }
}
`;
    await writeFile(join(targetDir, 'src/controllers/marzpay.controller.ts'), controller, 'utf8');
  }

  /** Write a GitHub Actions workflow that builds (and tests) the backend, and the web app when present. */
  private async scaffoldCI(targetDir: string, frontend: string): Promise<void> {
    await mkdir(join(targetDir, '.github', 'workflows'), { recursive: true });
    await writeFile(join(targetDir, '.github', 'workflows', 'ci.yml'), this.renderCIWorkflow(frontend), 'utf8');
    console.log('[street] Added GitHub Actions CI workflow (.github/workflows/ci.yml).');
  }

  private renderWebReactPackageJson(projectName: string): string {
    return JSON.stringify({
      name: `${projectName}-web`,
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'tsc && vite build',
        preview: 'vite preview',
        lint: 'tsc --noEmit',
      },
      dependencies: {
        '@streetjs/client': '^0.1.0',
        '@streetjs/react': '^0.1.0',
        // MarzPay client lib: the React overlay (web/src/lib/marzpay.ts + pages)
        // is scaffolded whenever `--frontend react` is selected, so its client
        // dependency ships in the web app's package.json (Requirements 5.4, 8.1).
        '@streetjs/plugin-marzpay': '^1.0.0',
        react: '^18.3.1',
        'react-dom': '^18.3.1',
      },
      devDependencies: {
        '@types/react': '^18.3.0',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.7.0',
        typescript: '^5.4.5',
        vite: '^6.4.3',
      },
      // Force a patched transitive postcss (build tooling pins an older one):
      // GHSA-qx2v-qp2m-jg93 (XSS in CSS stringify) is fixed in 8.5.10.
      overrides: {
        postcss: '^8.5.10',
      },
    }, null, 2) + '\n';
  }

  private renderWebReactTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
`;
  }

  private renderViteConfig(): string {
    return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxies /api and /auth to the Street backend during development.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/search': 'http://localhost:3000',
    },
  },
});
`;
  }

  private renderWebIndexHtml(projectName: string): string {
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
  }

  private renderWebReactMain(): string {
    return `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';
import { App } from './App';

const client = createStreetClient({
  baseUrl: import.meta.env.VITE_API_URL ?? '',
  credentials: 'include',
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StreetProvider client={client}>
      <App />
    </StreetProvider>
  </StrictMode>,
);
`;
  }

  private renderWebReactApp(projectName: string): string {
    return `import { useQuery, useAuth } from '@streetjs/react';

interface Health { status: string; uptime: number }

export function App() {
  const { session, loading } = useAuth();
  const health = useQuery<Health>(() =>
    fetch((import.meta.env.VITE_API_URL ?? '') + '/health').then((r) => r.json()),
  );

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>${projectName}</h1>
      <p>Frontend wired to the Street backend via <code>@streetjs/client</code> + <code>@streetjs/react</code>.</p>
      <section>
        <h2>Backend health</h2>
        {health.loading ? <p>Checking…</p> : <pre>{JSON.stringify(health.data, null, 2)}</pre>}
      </section>
      <section>
        <h2>Session</h2>
        {loading ? <p>Loading…</p> : <pre>{JSON.stringify(session ?? null, null, 2)}</pre>}
      </section>
    </main>
  );
}
`;
  }

  /**
   * MarzPay React overlay. Scaffolds `web/src/lib/marzpay.ts` (the client lib
   * built on the existing `@streetjs/client` fetch pattern) plus the four billing
   * pages (`CheckoutPage`, `BillingPage`, `SubscriptionPage`, `InvoicesPage`).
   *
   * The client functions call the application's MarzPay endpoints and raise an
   * error that INCLUDES the returned HTTP status on a non-success response, never
   * returning a payment result in that case (Requirements 8.2, 8.3, 8.4). All
   * files compile under the React tsconfig (strict, `jsx: react-jsx`, no `any`)
   * (Requirement 8.5).
   */
  private async scaffoldReactMarzPay(webDir: string): Promise<void> {
    await mkdir(join(webDir, 'src', 'lib'), { recursive: true });
    await mkdir(join(webDir, 'src', 'pages'), { recursive: true });
    await writeFile(join(webDir, 'src', 'lib', 'marzpay.ts'), this.renderReactMarzPayLib(), 'utf8');
    await writeFile(join(webDir, 'src', 'pages', 'CheckoutPage.tsx'), this.renderReactCheckoutPage(), 'utf8');
    await writeFile(join(webDir, 'src', 'pages', 'BillingPage.tsx'), this.renderReactBillingPage(), 'utf8');
    await writeFile(join(webDir, 'src', 'pages', 'SubscriptionPage.tsx'), this.renderReactSubscriptionPage(), 'utf8');
    await writeFile(join(webDir, 'src', 'pages', 'InvoicesPage.tsx'), this.renderReactInvoicesPage(), 'utf8');
  }

  private renderReactMarzPayLib(): string {
    return `// MarzPay client library for the React frontend.
//
// Built on the existing @streetjs/client fetch pattern (see src/main.tsx and
// src/App.tsx, which read import.meta.env.VITE_API_URL and call fetch(API_URL +
// path)). \`initializePayment\`/\`verifyPayment\` call the application's MarzPay
// endpoints exposed by the backend MarzPay controller.
//
// Requirements 8.2/8.3/8.4: on a non-success response these functions raise an
// error that INCLUDES the returned HTTP status and never return a payment result.
import type { PaymentRequest, PaymentInitResult, PaymentStatus } from '@streetjs/plugin-marzpay';

// Base URL for the Street backend (empty string => same-origin via the Vite proxy).
const API_URL: string = import.meta.env.VITE_API_URL ?? '';

/**
 * Error raised when a MarzPay endpoint returns a non-success HTTP status. The
 * offending status is carried both in \`status\` and in the message so callers
 * (and the property test) can assert it is surfaced (Requirement 8.4).
 */
export class MarzPayError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MarzPayError';
    this.status = status;
  }
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    // Non-success: raise an error INCLUDING the returned status; return nothing.
    throw new MarzPayError(
      response.status,
      'MarzPay request to ' + path + ' failed with status ' + response.status,
    );
  }
  return (await response.json()) as T;
}

/**
 * Initialize a MarzPay payment via the application's initialization endpoint.
 * Returns the initialization result on success; raises {@link MarzPayError}
 * (including the status) on a non-success response (Requirements 8.2, 8.4).
 */
export async function initializePayment(request: PaymentRequest): Promise<PaymentInitResult> {
  const path = '/api/marzpay/initialize';
  const response = await fetch(API_URL + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  return readJson<PaymentInitResult>(response, path);
}

/**
 * Verify a MarzPay payment by reference via the application's verification
 * endpoint. Returns the payment status on success; raises {@link MarzPayError}
 * (including the status) on a non-success response (Requirements 8.3, 8.4).
 */
export async function verifyPayment(reference: string): Promise<PaymentStatus> {
  const path = '/api/marzpay/verify/' + encodeURIComponent(reference);
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return readJson<PaymentStatus>(response, path);
}
`;
  }

  private renderReactCheckoutPage(): string {
    return `import { useState } from 'react';
import type { FormEvent } from 'react';
import type { PaymentInitResult } from '@streetjs/plugin-marzpay';
import { initializePayment } from '../lib/marzpay';

// Checkout page: collects a payment request and initializes a MarzPay payment.
// On a verified card init that yields a redirect URL the browser is navigated to
// the MarzPay payment page; otherwise the returned status is displayed. A failed
// request surfaces the MarzPayError message (which includes the HTTP status).
export function CheckoutPage() {
  const [amount, setAmount] = useState<number>(10000);
  const [currency, setCurrency] = useState<string>('UGX');
  const [country, setCountry] = useState<string>('UG');
  const [reference, setReference] = useState<string>('');
  const [result, setResult] = useState<PaymentInitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);
    setPending(true);
    try {
      const init = await initializePayment({ amount, currency, country, reference, method: 'card' });
      setResult(init);
      if (typeof init.redirectUrl === 'string' && init.redirectUrl.trim() !== '') {
        window.location.assign(init.redirectUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment initialization failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Checkout</h2>
      <form onSubmit={onSubmit}>
        <label>
          Amount
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} required />
        </label>
        <label>
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} required />
        </label>
        <label>
          Reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="unique reference (UUID)"
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Processing…' : 'Pay now'}
        </button>
      </form>
      {error !== null ? <p role="alert">{error}</p> : null}
      {result !== null ? (
        <p>
          Payment <code>{result.reference}</code> initialized (status: {result.status}).
        </p>
      ) : null}
    </section>
  );
}
`;
  }

  private renderReactBillingPage(): string {
    return `import { useAuth } from '@streetjs/react';
import { CheckoutPage } from './CheckoutPage';
import { SubscriptionPage } from './SubscriptionPage';
import { InvoicesPage } from './InvoicesPage';

// Billing page: the MarzPay billing hub. It composes the checkout, subscription,
// and invoices views and shows the current session via the existing @streetjs/react
// useAuth hook (matching App.tsx conventions).
export function BillingPage() {
  const { session, loading } = useAuth();

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Billing</h1>
      <section>
        <h2>Account</h2>
        {loading ? <p>Loading…</p> : <pre>{JSON.stringify(session ?? null, null, 2)}</pre>}
      </section>
      <CheckoutPage />
      <SubscriptionPage />
      <InvoicesPage />
    </main>
  );
}
`;
  }

  private renderReactSubscriptionPage(): string {
    return `import { useState } from 'react';
import type { FormEvent } from 'react';
import { initializePayment } from '../lib/marzpay';

// Subscription page: selecting a plan starts a MarzPay payment for that plan via
// the shared initializePayment client function. Plans are illustrative scaffold
// defaults; a real app reads plan definitions from configuration (see the SaaS
// billing modules).
interface Plan {
  id: string;
  name: string;
  amount: number;
  currency: string;
}

const PLANS: readonly Plan[] = [
  { id: 'basic', name: 'Basic', amount: 10000, currency: 'UGX' },
  { id: 'pro', name: 'Pro', amount: 30000, currency: 'UGX' },
];

export function SubscriptionPage() {
  const [planId, setPlanId] = useState<string>(PLANS[0].id);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setStatus(null);
    setPending(true);
    const plan = PLANS.find((p) => p.id === planId);
    if (plan === undefined) {
      setError('Unknown plan "' + planId + '".');
      setPending(false);
      return;
    }
    try {
      const init = await initializePayment({
        amount: plan.amount,
        currency: plan.currency,
        country: 'UG',
        reference: 'sub-' + plan.id + '-' + Date.now().toString(),
        method: 'card',
      });
      if (typeof init.redirectUrl === 'string' && init.redirectUrl.trim() !== '') {
        window.location.assign(init.redirectUrl);
        return;
      }
      setStatus('Subscription payment for ' + plan.name + ' initialized (status: ' + init.status + ').');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Subscription payment failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Subscription</h2>
      <form onSubmit={onSubmit}>
        <label>
          Plan
          <select value={planId} onChange={(e) => setPlanId(e.target.value)} required>
            {PLANS.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Processing…' : 'Subscribe / change plan'}
        </button>
      </form>
      {error !== null ? <p role="alert">{error}</p> : null}
      {status !== null ? <p>{status}</p> : null}
    </section>
  );
}
`;
  }

  private renderReactInvoicesPage(): string {
    return `import { useQuery } from '@streetjs/react';

// Invoices page: lists past invoices from the application's MarzPay invoices
// endpoint using the existing useQuery hook + fetch pattern. An empty collection
// renders an empty-state; a failed request renders an error indicator.
interface Invoice {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
}

const API_URL: string = import.meta.env.VITE_API_URL ?? '';

export function InvoicesPage() {
  const invoices = useQuery<Invoice[]>(() =>
    fetch(API_URL + '/api/marzpay/invoices', { credentials: 'include' }).then((r) => r.json() as Promise<Invoice[]>),
  );

  if (invoices.loading) {
    return (
      <section>
        <h2>Invoices</h2>
        <p>Loading…</p>
      </section>
    );
  }

  if (invoices.error !== undefined) {
    return (
      <section>
        <h2>Invoices</h2>
        <p role="alert">Invoices are currently unavailable.</p>
      </section>
    );
  }

  const rows = invoices.data ?? [];
  return (
    <section>
      <h2>Invoices</h2>
      {rows.length === 0 ? (
        <p>No invoices yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <code>{invoice.reference}</code>
                </td>
                <td>
                  {invoice.amount} {invoice.currency}
                </td>
                <td>{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
`;
  }

  private renderWebNextPackageJson(projectName: string): string {
    return JSON.stringify({
      name: `${projectName}-web`,
      version: '0.1.0',
      private: true,
      scripts: {
        dev: 'next dev -p 3001',
        build: 'next build',
        start: 'next start -p 3001',
        lint: 'next lint',
      },
      dependencies: {
        '@streetjs/client': '^0.1.0',
        '@streetjs/react': '^0.1.0',
        '@streetjs/next': '^0.1.0',
        '@streetjs/plugin-marzpay': '^1.0.0',
        next: '^16.2.9',
        react: '^19.2.0',
        'react-dom': '^19.2.0',
      },
      devDependencies: {
        '@types/node': '^20.14.0',
        '@types/react': '^19.2.0',
        '@types/react-dom': '^19.2.0',
        typescript: '^5.4.5',
      },
      // Force a patched transitive postcss (next pins an older one):
      // GHSA-qx2v-qp2m-jg93 (XSS in CSS stringify) is fixed in 8.5.10.
      overrides: {
        postcss: '^8.5.10',
      },
    }, null, 2) + '\n';
  }

  private renderWebNextTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;
  }

  /**
   * Scaffold the MarzPay Next.js App Router overlay (Requirements 5.4, 5.5,
   * 9.1–9.5). Written whenever the `next` frontend is selected.
   *
   * Files (all under web/app):
   *  - `lib/marzpay.ts` — typed client helpers that call the StreetJS backend
   *    MarzPay endpoints. MarzPay credentials and the MarzPayClient live ONLY on
   *    the backend; the browser holds none. Each helper maps to a verified
   *    operation (initializePayment / verifyPayment) and raises an error that
   *    INCLUDES the returned HTTP status on a non-success response.
   *  - `billing/page.tsx` — a checkout control that initiates a MarzPay payment,
   *    a subscription view showing the active plan, and an invoice history list
   *    (Requirements 9.1, 9.2).
   *  - `billing/success/page.tsx` — shows the VERIFIED payment status via the
   *    backend verifyPayment endpoint (Requirement 9.4).
   *  - `billing/cancel/page.tsx` — shows a cancellation indication (Req 9.4).
   *  - `api/webhooks/marzpay/route.ts` — a SERVER-SIDE webhook example that calls
   *    `validateWebhook` on the unmodified raw body BEFORE processing, then
   *    re-verifies server-side (the documented trust path) (Requirement 9.3).
   *
   * All files compile under the Next strict tsconfig (strict, `jsx: react-jsx`,
   * no `any`) (Requirement 9.5).
   */
  private async scaffoldNextMarzPay(webDir: string): Promise<void> {
    await mkdir(join(webDir, 'app', 'lib'), { recursive: true });
    await mkdir(join(webDir, 'app', 'billing', 'success'), { recursive: true });
    await mkdir(join(webDir, 'app', 'billing', 'cancel'), { recursive: true });
    await mkdir(join(webDir, 'app', 'api', 'webhooks', 'marzpay'), { recursive: true });
    await writeFile(join(webDir, 'app', 'lib', 'marzpay.ts'), this.renderNextMarzPayLib(), 'utf8');
    await writeFile(join(webDir, 'app', 'billing', 'page.tsx'), this.renderNextBillingPage(), 'utf8');
    await writeFile(
      join(webDir, 'app', 'billing', 'success', 'page.tsx'),
      this.renderNextBillingSuccessPage(),
      'utf8',
    );
    await writeFile(
      join(webDir, 'app', 'billing', 'cancel', 'page.tsx'),
      this.renderNextBillingCancelPage(),
      'utf8',
    );
    await writeFile(
      join(webDir, 'app', 'api', 'webhooks', 'marzpay', 'route.ts'),
      this.renderNextMarzPayWebhookRoute(),
      'utf8',
    );
  }

  private renderNextMarzPayLib(): string {
    return `// MarzPay client helpers for the Next.js frontend.
//
// MarzPay credentials and the MarzPayClient live ONLY on the StreetJS backend;
// these helpers call that backend over HTTP (the browser holds no MarzPay
// credentials). Each maps to a verified MarzPay operation surfaced by the backend
// MarzPay controller: initializePayment (POST /collect-money, card) and
// verifyPayment (GET /transactions/{reference}).
//
// Requirement 9.5: strict TS, no \`any\`. Requirement 9.4: verifyPayment returns
// the verified payment status. On a non-success response these helpers raise an
// error that INCLUDES the returned HTTP status and never return a result.
import type { PaymentRequest, PaymentInitResult, PaymentStatus } from '@streetjs/plugin-marzpay';

/** The StreetJS backend base URL (empty string => same-origin). */
const API_URL: string = process.env.NEXT_PUBLIC_API_URL ?? '';

/** Active subscription view model returned by the backend. */
export interface SubscriptionView {
  planId: string;
  planName: string;
  status: string;
  renewsAt?: string;
}

/** An invoice row returned by the backend invoice-history endpoint. */
export interface InvoiceView {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  issuedAt?: string;
}

/**
 * Error raised when a MarzPay endpoint returns a non-success HTTP status. The
 * offending status is carried both in \`status\` and the message so callers can
 * surface it.
 */
export class MarzPayError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'MarzPayError';
    this.status = status;
  }
}

async function readJson<T>(response: Response, path: string): Promise<T> {
  if (!response.ok) {
    // Non-success: raise an error INCLUDING the returned status; return nothing.
    throw new MarzPayError(
      response.status,
      'MarzPay request to ' + path + ' failed with status ' + response.status,
    );
  }
  return (await response.json()) as T;
}

/**
 * Initialize a MarzPay payment via the application's initialization endpoint.
 * Returns the initialization result on success; raises {@link MarzPayError}
 * (including the status) on a non-success response.
 */
export async function initializePayment(request: PaymentRequest): Promise<PaymentInitResult> {
  const path = '/api/marzpay/initialize';
  const response = await fetch(API_URL + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  return readJson<PaymentInitResult>(response, path);
}

/**
 * Verify a MarzPay payment by reference via the application's verification
 * endpoint. Returns the verified payment status on success; raises
 * {@link MarzPayError} (including the status) on a non-success response.
 */
export async function verifyPayment(reference: string): Promise<PaymentStatus> {
  const path = '/api/marzpay/verify/' + encodeURIComponent(reference);
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return readJson<PaymentStatus>(response, path);
}

/**
 * Fetch the active subscription for the current account via the backend. Returns
 * \`null\` when the account has no active subscription (HTTP 404).
 */
export async function fetchSubscription(): Promise<SubscriptionView | null> {
  const path = '/api/marzpay/subscription';
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (response.status === 404) {
    return null;
  }
  return readJson<SubscriptionView | null>(response, path);
}

/** Fetch the invoice history for the current account via the backend. */
export async function fetchInvoices(): Promise<InvoiceView[]> {
  const path = '/api/marzpay/invoices';
  const response = await fetch(API_URL + path, {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  return readJson<InvoiceView[]>(response, path);
}
`;
  }

  private renderNextBillingPage(): string {
    return `'use client';

// app/billing/page.tsx — the MarzPay billing hub (Requirements 9.1, 9.2).
//
// Renders three controls: a checkout control that initiates a MarzPay payment, a
// subscription management view that displays the active plan, and an invoice
// history list. All MarzPay calls go through the typed client helpers, which call
// the StreetJS backend — the browser never holds MarzPay credentials.
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { PaymentInitResult } from '@streetjs/plugin-marzpay';
import {
  initializePayment,
  fetchSubscription,
  fetchInvoices,
  type SubscriptionView,
  type InvoiceView,
} from '../lib/marzpay';

export default function BillingPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '40px auto', padding: 16 }}>
      <h1>Billing</h1>
      <CheckoutControl />
      <SubscriptionSection />
      <InvoiceHistory />
    </main>
  );
}

// Checkout control: initiates a MarzPay card payment. On a verified init that
// returns a redirect URL the browser is navigated to MarzPay; otherwise the
// returned status is shown. A failed request surfaces the MarzPayError message
// (which includes the HTTP status).
function CheckoutControl() {
  const [amount, setAmount] = useState<number>(10000);
  const [currency, setCurrency] = useState<string>('UGX');
  const [country, setCountry] = useState<string>('UG');
  const [reference, setReference] = useState<string>('');
  const [result, setResult] = useState<PaymentInitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<boolean>(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setResult(null);
    setPending(true);
    try {
      const init = await initializePayment({ amount, currency, country, reference, method: 'card' });
      setResult(init);
      if (typeof init.redirectUrl === 'string' && init.redirectUrl.trim() !== '') {
        window.location.assign(init.redirectUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment initialization failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2>Checkout</h2>
      <form onSubmit={onSubmit}>
        <label>
          Amount
          <input
            type="number"
            min={1}
            step={1}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            required
          />
        </label>
        <label>
          Currency
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} required />
        </label>
        <label>
          Country
          <input value={country} onChange={(e) => setCountry(e.target.value)} required />
        </label>
        <label>
          Reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="unique reference (UUID)"
            required
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? 'Processing…' : 'Pay now'}
        </button>
      </form>
      {error !== null ? <p role="alert">{error}</p> : null}
      {result !== null ? (
        <p>
          Payment <code>{result.reference}</code> initialized (status: {result.status}).
        </p>
      ) : null}
    </section>
  );
}

// Subscription management view: displays the active subscription plan loaded
// from the backend (Requirement 9.2). An empty subscription renders an
// empty-state; a failed load renders an error indicator.
function SubscriptionSection() {
  const [subscription, setSubscription] = useState<SubscriptionView | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSubscription()
      .then((value) => {
        if (active) {
          setSubscription(value);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Subscription is currently unavailable.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Subscription</h2>
      {loading ? <p>Loading…</p> : null}
      {!loading && error !== null ? <p role="alert">{error}</p> : null}
      {!loading && error === null && subscription === null ? <p>No active subscription.</p> : null}
      {!loading && error === null && subscription !== null ? (
        <dl>
          <dt>Plan</dt>
          <dd>{subscription.planName}</dd>
          <dt>Status</dt>
          <dd>{subscription.status}</dd>
          {typeof subscription.renewsAt === 'string' ? (
            <>
              <dt>Renews</dt>
              <dd>{subscription.renewsAt}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}

// Invoice history: lists past invoices loaded from the backend. An empty
// collection renders an empty-state; a failed load renders an error indicator.
function InvoiceHistory() {
  const [invoices, setInvoices] = useState<InvoiceView[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchInvoices()
      .then((rows) => {
        if (active) {
          setInvoices(rows);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Invoices are currently unavailable.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section>
      <h2>Invoices</h2>
      {loading ? <p>Loading…</p> : null}
      {!loading && error !== null ? <p role="alert">{error}</p> : null}
      {!loading && error === null && invoices.length === 0 ? <p>No invoices yet.</p> : null}
      {!loading && error === null && invoices.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>Reference</th>
              <th>Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <code>{invoice.reference}</code>
                </td>
                <td>
                  {invoice.amount} {invoice.currency}
                </td>
                <td>{invoice.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
`;
  }

  private renderNextBillingSuccessPage(): string {
    return `// app/billing/success/page.tsx — post-payment success route (Requirement 9.4).
//
// MarzPay redirects the customer back here with the payment \`reference\`. This
// server component confirms the OUTCOME by calling the backend verifyPayment
// endpoint (GET /transactions/{reference}) and displays the VERIFIED payment
// status — it never trusts a status from the query string alone.
import { verifyPayment } from '../../lib/marzpay';

interface BillingSuccessPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function readReference(value: string | string[] | undefined): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    return value[0].trim();
  }
  return '';
}

export default async function BillingSuccessPage(props: BillingSuccessPageProps) {
  const params = await props.searchParams;
  const reference = readReference(params['reference']);

  if (reference === '') {
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <h1>Payment status unavailable</h1>
        <p role="alert">No payment reference was provided in the success redirect.</p>
      </main>
    );
  }

  let status: string;
  let verified: boolean;
  try {
    const result = await verifyPayment(reference);
    status = result.status;
    verified = status === 'completed' || status === 'successful';
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Verification failed.';
    return (
      <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
        <h1>Payment status unavailable</h1>
        <p role="alert">{message}</p>
        <p>Reference: <code>{reference}</code></p>
      </main>
    );
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>{verified ? 'Payment complete' : 'Payment ' + status}</h1>
      <p>Verified status: <strong>{status}</strong></p>
      <p>Reference: <code>{reference}</code></p>
    </main>
  );
}
`;
  }

  private renderNextBillingCancelPage(): string {
    return `// app/billing/cancel/page.tsx — payment cancellation route (Requirement 9.4).
//
// MarzPay redirects the customer here when a payment is cancelled. This route
// displays a clear cancellation indication and a path back to checkout.
import Link from 'next/link';

export default function BillingCancelPage() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>Payment cancelled</h1>
      <p role="status">Your payment was cancelled and you have not been charged.</p>
      <p>
        <Link href="/billing">Return to billing</Link>
      </p>
    </main>
  );
}
`;
  }

  private renderNextMarzPayWebhookRoute(): string {
    return `// app/api/webhooks/marzpay/route.ts — MarzPay webhook example (Requirement 9.3).
//
// SERVER-SIDE ONLY. This route handler runs on the Node.js runtime so the
// MarzPayClient (node:https / node:crypto) and the MarzPay credentials are never
// exposed to the browser.
//
// SECURITY: handle() calls the injected MarzPayClient's \`validateWebhook\` on the
// UNMODIFIED raw body BEFORE any processing. A NEGATIVE result rejects the
// webhook with a 400 and processes NOTHING.
//
// Verify-don't-invent: MarzPay documents no webhook signature scheme
// (Research_Artifact §L4), so validateWebhook returns false for absent/malformed
// signature material. The documented trust path for a POSITIVE result is
// server-side re-verification: re-fetch the transaction from MarzPay and trust
// the server's status rather than the raw payload (Research_Artifact §R1).
import { NextResponse } from 'next/server';
import { MarzPayClient, validateMarzPayConfig } from '@streetjs/plugin-marzpay';

// Force the Node.js runtime: the MarzPay client depends on node:https/node:crypto.
export const runtime = 'nodejs';

// MarzPay documents no signature header (Research_Artifact §L4). We read a
// conventional header so its value flows into validateWebhook; with the scheme
// unbound, validateWebhook returns false for absent/malformed material, so the
// conservative negative path is taken until MarzPay publishes a signing scheme.
const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

/** Construct a server-side MarzPayClient from the configured environment. */
function marzPayClient(): MarzPayClient {
  const environment = process.env.MARZPAY_ENVIRONMENT;
  const config = validateMarzPayConfig({
    apiKey: process.env.MARZPAY_API_KEY,
    secretKey: process.env.MARZPAY_SECRET,
    ...(environment !== undefined ? { environment } : {}),
  });
  return new MarzPayClient(config);
}

/** Parse the client \`reference\` from a webhook payload (empty when absent). */
function referenceOf(rawBody: string): string {
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const txn = record['transaction'];
      if (typeof txn === 'object' && txn !== null) {
        const ref = (txn as Record<string, unknown>)['reference'];
        if (typeof ref === 'string') {
          return ref.trim();
        }
      }
      const topLevel = record['reference'];
      if (typeof topLevel === 'string') {
        return topLevel.trim();
      }
    }
  } catch {
    return '';
  }
  return '';
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Capture the unmodified raw body and the signature header.
  const rawBody = await request.text();
  const signature = request.headers.get(MARZPAY_SIGNATURE_HEADER) ?? undefined;

  const client = marzPayClient();

  // 2. Validate BEFORE any processing (Requirement 9.3).
  if (!client.validateWebhook(rawBody, signature)) {
    // Negative result: reject and process NOTHING.
    return NextResponse.json({ error: 'webhook validation failed' }, { status: 400 });
  }

  // 3. Positive result: re-verify server-side (the documented trust path), then
  //    process the verified transaction (record it, fulfill the order, etc.).
  const reference = referenceOf(rawBody);
  if (reference === '') {
    return NextResponse.json({ error: 'webhook payload missing transaction reference' }, { status: 400 });
  }
  const transaction = await client.getTransaction(reference);
  return NextResponse.json(
    { received: true, reference: transaction.reference, status: transaction.status },
    { status: 200 },
  );
}
`;
  }

  private renderNextConfig(): string {
    return `import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

const nextConfig = {
  // Pin the workspace root to this app so Next does not infer a parent directory
  // when a sibling/parent lockfile exists (the backend ships its own lockfile).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async rewrites() {
    // Proxy API/auth/health calls to the Street backend so cookies stay
    // first-party. The dev server runs on a different port (see package.json)
    // so these never proxy back to Next itself.
    return [
      { source: '/api/:path*', destination: apiUrl + '/api/:path*' },
      { source: '/auth/:path*', destination: apiUrl + '/auth/:path*' },
      { source: '/health', destination: apiUrl + '/health' },
      { source: '/search', destination: apiUrl + '/search' },
    ];
  },
};

export default nextConfig;
`;
  }

  private renderNextLayout(projectName: string): string {
    return `import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: '${projectName} — StreetJS + Next.js',
  description: 'Full-stack TypeScript app powered by StreetJS: auth, realtime, ORM, jobs, AI, and plugins.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
`;
  }

  private renderNextProviders(): string {
    return `'use client';

import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { createStreetClient } from '@streetjs/client';
import { StreetProvider } from '@streetjs/react';

export function Providers({ children }: { children: ReactNode }) {
  const client = useMemo(
    () => createStreetClient({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? '', credentials: 'include' }),
    [],
  );
  return <StreetProvider client={client}>{children}</StreetProvider>;
}
`;
  }

  /** Best-effort: the CLI version that scaffolded this project (for display). */
  private cliVersion(): string {
    try {
      const url = new URL('../../package.json', import.meta.url);
      const pkg = JSON.parse(readFileSync(url, 'utf8')) as { version?: string };
      return pkg.version ? 'v' + pkg.version : '';
    } catch {
      return '';
    }
  }

  private renderNextPage(_projectName: string): string {
    return `'use client';

import { useEffect, useState } from 'react';
import { useQuery, useAuth } from '@streetjs/react';

const DOCS = 'https://hassanmubiru.github.io/StreetJS/';
const GITHUB = 'https://github.com/hassanmubiru/StreetJS';
const NPM = 'https://www.npmjs.com/package/streetjs';
const VERSION = '${this.cliVersion()}';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

interface Health { status?: string; uptime?: number }

type RealtimeState = 'connecting' | 'connected' | 'disconnected' | 'unconfigured';

function useRealtimeStatus(apiUrl: string): RealtimeState {
  const [state, setState] = useState<RealtimeState>(apiUrl ? 'connecting' : 'unconfigured');
  useEffect(() => {
    if (!apiUrl || typeof WebSocket === 'undefined') { setState('unconfigured'); return; }
    const wsUrl = apiUrl.replace(/^http/, 'ws').replace(/\\/$/, '') + '/realtime';
    let ws: WebSocket | null = null;
    try { ws = new WebSocket(wsUrl); } catch { setState('disconnected'); return; }
    const onOpen = () => setState('connected');
    const onDown = () => setState('disconnected');
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onDown);
    ws.addEventListener('close', onDown);
    return () => { ws?.removeEventListener('open', onOpen); ws?.removeEventListener('error', onDown); ws?.removeEventListener('close', onDown); ws?.close(); };
  }, [apiUrl]);
  return state;
}

const QUICKSTART = ['npx @streetjs/cli create my-app', 'cd my-app', 'npm install', 'npm run dev'];

const FEATURES: Array<{ title: string; desc: string }> = [
  { title: 'Authentication', desc: 'JWT authentication, sessions, permissions, and role-based access control.' },
  { title: 'Realtime', desc: 'WebSockets, channels, presence, and live updates.' },
  { title: 'Database', desc: 'SQLite and PostgreSQL support with ORM integration.' },
  { title: 'Jobs & Scheduling', desc: 'Background processing and scheduled workloads.' },
  { title: 'Security', desc: 'Plugin signing, provenance, SBOM generation, and a dependency-light architecture.' },
  { title: 'TypeScript First', desc: 'Built for modern TypeScript development from the ground up.' },
];

const WHY: string[] = [
  'Dependency-light architecture',
  'Self-host friendly deployment',
  'Built-in authentication support',
  'Built-in realtime capabilities',
  'Plugin ecosystem',
  'Supply-chain integrity features',
  'TypeScript-first development',
];

const DX: string[] = [
  'Fast project scaffolding',
  'Hot reload',
  'CLI tooling',
  'Modular architecture',
  'Plugin system',
  'API-first workflows',
];

const RESOURCES: Array<{ icon: string; title: string; desc: string; href: string }> = [
  { icon: '📘', title: 'Documentation', desc: 'Guides, references, and concepts.', href: DOCS },
  { icon: '🚀', title: 'Getting Started', desc: 'Build your first app step by step.', href: DOCS + 'getting-started/' },
  { icon: '💻', title: 'GitHub', desc: 'Source code and issues.', href: GITHUB },
  { icon: '🧩', title: 'Examples', desc: 'Reference apps and patterns.', href: DOCS + 'examples/' },
  { icon: '💬', title: 'Community', desc: 'Discussions and support.', href: GITHUB + '/discussions' },
];

export default function Home() {
  const auth = useAuth();
  const health = useQuery<Health>(() => fetch(API_URL + '/health').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }));
  const realtime = useRealtimeStatus(API_URL);
  const [copied, setCopied] = useState(false);

  const backendOk = !health.loading && !health.error;
  const hasSession = Boolean(auth.session);

  const copy = () => {
    try { void navigator.clipboard.writeText(QUICKSTART.join(String.fromCharCode(10))); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  };

  const status: Array<{ label: string; state: 'ok' | 'pending' | 'idle'; detail: string }> = [
    { label: 'Backend Status', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Ready' : health.loading ? 'Checking' : 'Not connected' },
    { label: 'API Connectivity', state: health.loading ? 'pending' : backendOk ? 'ok' : 'idle', detail: backendOk ? 'Connected' : health.loading ? 'Checking' : 'Offline' },
    { label: 'Authentication', state: 'ok', detail: hasSession ? 'Signed in' : 'Ready' },
    { label: 'Realtime', state: realtime === 'connected' ? 'ok' : realtime === 'connecting' ? 'pending' : 'idle', detail: realtime === 'connected' ? 'Connected' : realtime === 'connecting' ? 'Connecting' : realtime === 'unconfigured' ? 'Ready' : 'Offline' },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">StreetJS</span>
        <nav className="topnav">
          <a href={DOCS}>Docs</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <section className="hero">
        {VERSION ? <span className="pill">{VERSION}</span> : null}
        <h1>Build Production Applications Faster</h1>
        <p className="lead">
          StreetJS is a modern TypeScript backend framework designed for authentication, realtime
          features, APIs, jobs, and databases with a focus on simplicity, performance, and security.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href={DOCS + 'getting-started/'}>Get Started</a>
          <a className="btn btn-ghost" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </section>

      <section className="quickstart">
        <div className="qs-head">
          <h2 className="section-title">Quick Start</h2>
          <button className="btn btn-small" onClick={copy} type="button">{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className="codeblock">
          {QUICKSTART.map((line) => (<span key={line} className="code-line"><span className="prompt">$</span> {line}</span>))}
        </div>
        <p className="muted">Create and run a StreetJS application in minutes.</p>
      </section>

      <section>
        <h2 className="section-title">Core Features</h2>
        <div className="grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-title">Framework Status</h2>
        <div className="status-grid">
          {status.map((s) => (
            <div key={s.label} className="status-card">
              <span className={'dot dot-' + s.state} />
              <div>
                <div className="status-label">{s.label}</div>
                <div className="status-detail">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="two-col">
        <div className="panel">
          <h2 className="section-title">Why StreetJS</h2>
          <ul className="checklist">
            {WHY.map((w) => (<li key={w}><span className="check">✓</span> {w}</li>))}
          </ul>
        </div>
        <div className="panel">
          <h2 className="section-title">Built for Developers</h2>
          <ul className="checklist">
            {DX.map((d) => (<li key={d}><span className="check">✓</span> {d}</li>))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="section-title">Resources</h2>
        <div className="grid">
          {RESOURCES.map((r) => (
            <a key={r.title} className="card card-link" href={r.href} target="_blank" rel="noreferrer">
              <span className="card-icon" aria-hidden="true">{r.icon}</span>
              <h3>{r.title}</h3>
              <p>{r.desc}</p>
            </a>
          ))}
        </div>
      </section>

      <footer className="footer">
        <nav className="footer-links">
          <a href={DOCS} target="_blank" rel="noreferrer">Documentation</a>
          <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
          <a href={NPM} target="_blank" rel="noreferrer">npm</a>
          <a href={DOCS + 'security/'} target="_blank" rel="noreferrer">Security</a>
          <a href={GITHUB + '/discussions'} target="_blank" rel="noreferrer">Community</a>
        </nav>
        <span className="muted">MIT Licensed{VERSION ? ' · StreetJS ' + VERSION : ''}</span>
      </footer>
    </div>
  );
}
`;
  }

  private renderNextGlobalsCss(): string {
    return `:root {
  --bg: #ffffff;
  --bg-soft: #f6f7f9;
  --surface: #ffffff;
  --border: #e6e8ec;
  --text: #0b1220;
  --muted: #5b667a;
  --brand: #4f46e5;
  --brand-2: #7c3aed;
  --ok: #16a34a;
  --idle: #94a3b8;
  --code-bg: #0f172a;
  --code-fg: #e2e8f0;
  --shadow: 0 1px 2px rgba(16,24,40,.06), 0 10px 30px rgba(16,24,40,.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1020;
    --bg-soft: #0e1430;
    --surface: #121a33;
    --border: #243049;
    --text: #e7ecf5;
    --muted: #9aa6bd;
    --brand: #8b8cff;
    --brand-2: #b58bff;
    --ok: #34d399;
    --idle: #64748b;
    --code-bg: #060a17;
    --code-fg: #d7e0f0;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 12px 34px rgba(0,0,0,.35);
  }
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--brand); text-decoration: none; }
a:hover { text-decoration: underline; }
code, .codeblock { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }

.page { max-width: 1040px; margin: 0 auto; padding: 24px 20px 72px; display: flex; flex-direction: column; gap: 44px; }

.topbar { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.brand { font-weight: 800; letter-spacing: -.01em; font-size: 18px; }
.topnav { display: flex; gap: 18px; font-weight: 600; font-size: 14px; }
.topnav a { color: var(--muted); }

.hero { text-align: center; padding: 40px 8px 8px; background:
  radial-gradient(900px 400px at 50% -10%, color-mix(in srgb, var(--brand) 16%, transparent), transparent 70%); border-radius: 20px; }
.pill { display: inline-block; font-size: 12px; font-weight: 700; color: var(--brand); background: color-mix(in srgb, var(--brand) 12%, transparent); border: 1px solid color-mix(in srgb, var(--brand) 30%, transparent); padding: 4px 12px; border-radius: 999px; }
.hero h1 { font-size: clamp(32px, 6vw, 56px); line-height: 1.05; letter-spacing: -.03em; margin: 16px auto 12px; max-width: 18ch; }
.hero .lead { color: var(--muted); font-size: clamp(16px, 2.3vw, 19px); max-width: 64ch; margin: 0 auto 28px; }

.actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; padding: 11px 20px; border-radius: 11px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-weight: 650; font-size: 15px; cursor: pointer; transition: transform .05s ease, box-shadow .15s ease, background .15s ease; }
.btn:hover { text-decoration: none; box-shadow: var(--shadow); }
.btn:active { transform: translateY(1px); }
.btn-primary { background: linear-gradient(135deg, var(--brand), var(--brand-2)); color: #fff; border-color: transparent; }
.btn-ghost { background: transparent; }
.btn-small { padding: 6px 12px; font-size: 13px; }

.section-title { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 16px; }

.quickstart .qs-head { display: flex; align-items: center; justify-content: space-between; }
.codeblock { background: var(--code-bg); color: var(--code-fg); border-radius: 14px; padding: 18px 20px; display: flex; flex-direction: column; gap: 6px; font-size: 14px; overflow: auto; }
.code-line { white-space: pre; }
.prompt { color: #64748b; user-select: none; }
.muted { color: var(--muted); font-size: 14px; }

.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: var(--shadow); display: flex; flex-direction: column; gap: 8px; color: var(--text); }
.card h3 { margin: 0; font-size: 16px; letter-spacing: -.01em; }
.card p { margin: 0; color: var(--muted); font-size: 14px; }
.card-link { transition: transform .08s ease, box-shadow .15s ease; }
.card-link:hover { text-decoration: none; transform: translateY(-2px); box-shadow: 0 14px 36px rgba(16,24,40,.12); }
.card-icon { font-size: 22px; }

.status-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
.status-card { display: flex; align-items: center; gap: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; box-shadow: var(--shadow); }
.status-label { font-weight: 650; font-size: 14px; }
.status-detail { color: var(--muted); font-size: 13px; }
.dot { width: 11px; height: 11px; border-radius: 50%; flex: 0 0 auto; }
.dot-ok { background: var(--ok); box-shadow: 0 0 0 4px color-mix(in srgb, var(--ok) 18%, transparent); }
.dot-pending { background: var(--brand); box-shadow: 0 0 0 4px color-mix(in srgb, var(--brand) 18%, transparent); }
.dot-idle { background: var(--idle); box-shadow: 0 0 0 4px color-mix(in srgb, var(--idle) 16%, transparent); }

.two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: var(--shadow); }
.checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
.checklist li { display: flex; align-items: center; gap: 10px; font-size: 15px; }
.check { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); font-size: 12px; font-weight: 800; flex: 0 0 auto; }

.footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 14px; border-top: 1px solid var(--border); padding-top: 24px; }
.footer-links { display: flex; flex-wrap: wrap; gap: 18px; font-weight: 600; font-size: 14px; }
.footer-links a { color: var(--muted); }

@media (max-width: 760px) {
  .two-col { grid-template-columns: 1fr; }
}
`;
  }

  private renderCIWorkflow(frontend: string): string {
    const webJob = (frontend === 'none' || frontend === 'htmx') ? '' : `
  web:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    defaults:
      run:
        working-directory: web
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install
      - run: npm run lint
      - run: npm run build
`;
    return `name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  backend:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: npm install
      - run: npm run build
${webJob}`;
  }

  private async generateLockfile(cwd: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    await new Promise<void>((resolvePromise) => {
      const proc = spawn('npm', ['install', '--package-lock-only', '--no-audit', '--no-fund'], {
        cwd,
        stdio: 'ignore',
        shell: true,
      });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log('[street] Generated package-lock.json (reproducible installs; enables `npm ci`).');
        } else {
          console.warn('[street] Could not generate package-lock.json (offline?). Run `npm install` before `npm ci` / the Docker build.');
        }
        resolvePromise();
      });
      proc.on('error', () => {
        console.warn('[street] npm not available — skipped package-lock.json generation.');
        resolvePromise();
      });
    });
  }

  private async installDependencies(cwd: string): Promise<void> {
    const { spawn } = await import('node:child_process');
    return new Promise((resolvePromise, reject) => {
      const proc = spawn('npm', ['install'], {
        cwd,
        stdio: 'inherit',
        shell: true,
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('\n[street] Dependencies installed. Ready to develop!');
          console.log(`  cd ${cwd.split('/').pop()}`);
          console.log('  street dev\n');
          resolvePromise();
        } else {
          reject(new Error(`npm install failed with exit code ${code}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run npm install: ${err.message}`));
      });
    });
  }

  private renderPackageJson(projectName: string): string {
    return JSON.stringify(
      {
        name: projectName,
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'street dev',
          build: 'street build',
          start: 'street start',
          test: 'street test',
          migrate: 'street migrate:run',
          'migrate:create': 'street migrate:create',
        },
        dependencies: {
          'streetjs': '^1.1.4',
          'reflect-metadata': '^0.2.2',
          ws: '^8.18.0',
        },
        devDependencies: {
          '@types/node': '^20.14.0',
          '@types/ws': '^8.5.10',
          typescript: '^5.4.5',
        },
      },
      null,
      2
    );
  }

  private renderStreetConfig(_projectName: string, database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `// street.config.ts
// Street framework configuration (SQLite — zero-config default).
// Environment variables are loaded automatically at runtime.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  // SQLite needs no server or credentials. ':memory:' is an ephemeral
  // in-process database (resets on restart) — perfect for first runs and tests.
  // Switch to PostgreSQL for production: recreate with \`--database postgres\`.
  dbDriver: process.env['DB_DRIVER'] ?? 'sqlite',
  sqlitePath: process.env['SQLITE_PATH'] ?? ':memory:',
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
`;
    }
    return `// street.config.ts
// Street framework configuration (PostgreSQL).
// Environment variables are loaded automatically at runtime.
//
// PG_USER / PG_PASSWORD / PG_DATABASE have NO defaults on purpose — set them in
// your .env (see .env.example). The app validates these on startup and refuses
// to connect with guessed credentials.

import type { StreetAppOptions } from 'streetjs';

export default {
  port: parseInt(process.env['PORT'] ?? '3000', 10),
  host: process.env['HOST'] ?? '0.0.0.0',
  dbDriver: process.env['DB_DRIVER'] ?? 'postgres',
  pgHost: process.env['PG_HOST'] ?? 'localhost',
  pgPort: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  pgDatabase: process.env['PG_DATABASE'],
  pgUser: process.env['PG_USER'],
  pgPassword: process.env['PG_PASSWORD'],
  jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production',
  sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key',
  nodeEnv: process.env['NODE_ENV'] ?? 'development',
  uploadsDir: process.env['UPLOADS_DIR'] ?? './uploads',
  migrationsDir: process.env['MIGRATIONS_DIR'] ?? './migrations',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,
} satisfies Partial<StreetAppOptions>;
`;
  }

  private renderMainTs(database = 'sqlite'): string {
    const isSqlite = database === 'sqlite';
    return `// src/main.ts
// Street application entry point.

import 'reflect-metadata';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  streetApp,
  container,
  securityHeaders,
  corsMiddleware,
  xssMiddleware,
  telemetryMiddleware,
  TelemetryTracker,
  RateLimiter,
  StreetWebSocketServer,
  ${isSqlite ? 'SqlitePool' : 'PgPool'},
  ${isSqlite ? '' : 'StreetMigrationRunner,\n  '}JwtService,
  SessionManager,
  WebhookDispatcher,
  LruCache,
} from 'streetjs';
import { HealthController } from './controllers/health.controller.js';
import { ExampleController } from './controllers/example.controller.js';

async function bootstrap(): Promise<void> {
  // ── Configuration ────────────────────────────────────────────────────
  const port = parseInt(process.env['PORT'] ?? '3000', 10);
  const host = process.env['HOST'] ?? '0.0.0.0';
  const uploadsDir = resolve(process.env['UPLOADS_DIR'] ?? './uploads');
  // Note: MIGRATIONS_DIR env var is used by the migration runner internally

  // ── Secrets ──────────────────────────────────────────────────────────
  // JwtService requires a secret ≥32 chars; SessionManager requires a 64-char
  // hex key. In development we generate a valid ephemeral key when one isn't
  // provided (so first run works with zero config). In production these MUST be
  // set explicitly — we fail fast rather than start with throwaway keys.
  const isProd = (process.env['NODE_ENV'] ?? 'development') === 'production';
  const resolveSecret = (name: string, bytes: number): string => {
    const provided = process.env[name];
    if (provided && provided.length > 0) return provided;
    if (isProd) {
      throw new Error(\`\${name} must be set in production. Generate one with: openssl rand -hex \${bytes}\`);
    }
    console.warn(\`[street] \${name} not set — using an ephemeral development key. Set it in .env for stable sessions/tokens and for production.\`);
    return randomBytes(bytes).toString('hex');
  };
  const jwtSecret = resolveSecret('JWT_SECRET', 24);   // 48 hex chars (≥32)
  const sessionKey = resolveSecret('SESSION_KEY', 32);  // 64 hex chars

  // ── CORS ─────────────────────────────────────────────────────────────
  // SECURITY: the default ['*'] allows requests from ANY origin, which is fine
  // for local development but UNSAFE in production — it lets any website call
  // your API with the user's credentials. Set CORS_ORIGINS to a comma-separated
  // allowlist (e.g. "https://app.example.com,https://admin.example.com") before
  // deploying. In production we refuse to fall back to the wildcard.
  const corsOrigins = (process.env['CORS_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  if (corsOrigins.length === 0) {
    if (isProd) {
      throw new Error('CORS_ORIGINS must be set in production (comma-separated allowlist of trusted origins).');
    }
    console.warn('[street] CORS_ORIGINS not set — allowing all origins (*) for development only. Set an allowlist before deploying.');
    corsOrigins.push('*');
  }

  // ── Database ─────────────────────────────────────────────────────────
${isSqlite ? `  // SQLite: zero-config, no server or credentials required. The default
  // ':memory:' database is ephemeral (resets on restart). Set SQLITE_PATH to a
  // file for local persistence, or recreate with \\\`--database postgres\\\` for
  // production.
  const pool = new SqlitePool({ filePath: process.env['SQLITE_PATH'] ?? ':memory:' });
  // Bootstrap the example schema so the app works out of the box.
  await pool.query(
    \`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )\`
  );
  container.register(SqlitePool, pool);
  console.log('[street] Database ready (sqlite).');` : `  // PostgreSQL: validate credentials BEFORE opening a connection. We never
  // guess a username/password — missing credentials are a configuration error,
  // not something to paper over with 'postgres'/'postgres'.
  function requireEnv(name: string): string | null {
    const v = process.env[name];
    return v && v.length > 0 ? v : null;
  }
  const pgUser = requireEnv('PG_USER');
  const pgPassword = requireEnv('PG_PASSWORD');
  const pgDatabase = requireEnv('PG_DATABASE');

  let pool: PgPool | null = null;
  if (!pgUser || !pgPassword || !pgDatabase) {
    const missing = [
      !pgUser ? 'PG_USER' : null,
      !pgPassword ? 'PG_PASSWORD' : null,
      !pgDatabase ? 'PG_DATABASE' : null,
    ].filter(Boolean).join(', ');
    console.warn(
      \`[street] Database not configured: missing \${missing}.\\n\` +
      '[street] Copy .env.example to .env and set your PostgreSQL credentials,\\n' +
      '[street] or recreate the project with: street create <name> --database sqlite\\n' +
      '[street] The server will start, but database-backed routes will return 503 until configured.'
    );
  } else {
    pool = new PgPool({
      host: process.env['PG_HOST'] ?? 'localhost',
      port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      minConnections: 2,
      maxConnections: 10,
      idleTimeoutMs: 30_000,
      acquireTimeoutMs: 5_000,
    });
    try {
      await pool.initialize();
      container.register(PgPool, pool);
      container.register(StreetMigrationRunner, new StreetMigrationRunner(pool));
      console.log('[street] Database ready (postgres).');
    } catch (err) {
      // Do not crash the dev server on a database connection failure — surface a
      // clear, actionable message and keep serving (health + non-DB routes work).
      console.warn(
        \`[street] Could not connect to PostgreSQL: \${err instanceof Error ? err.message : String(err)}\\n\` +
        '[street] Check PG_HOST/PG_PORT/PG_USER/PG_PASSWORD/PG_DATABASE in your .env.\\n' +
        '[street] The server will start, but database-backed routes will return 503 until the database is reachable.'
      );
      await pool.close().catch(() => {});
      pool = null;
    }
  }`}

  // ── Services ─────────────────────────────────────────────────────────
  const telemetry = new TelemetryTracker(60_000);
  container.register(TelemetryTracker, telemetry);

  const wsServer = new StreetWebSocketServer({
    heartbeatIntervalMs: 30_000,
    maxConnections: 10_000,
  });
  container.register(StreetWebSocketServer, wsServer);

  container.register(JwtService, new JwtService(jwtSecret));
  container.register(SessionManager, new SessionManager(sessionKey));
  container.register(WebhookDispatcher, new WebhookDispatcher());
  container.register(LruCache, new LruCache({ maxEntries: 1000, ttlMs: 60_000 }));

  // ── HTTP server ──────────────────────────────────────────────────────
  const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

  const app = streetApp({
    port,
    host,
    uploadsDir,
    requestTimeoutMs: 30_000,
    maxBodyBytes: 1_048_576,
  });

  // Global middleware
  app.use(securityHeaders);
  app.use(corsMiddleware(corsOrigins));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(rateLimiter.middleware());

  // Register controllers
  // WARNING: The example routes below are UNAUTHENTICATED and must be protected
  // before public exposure. Use JwtService or SessionManager (see src/middleware/auth.ts)
  // to add authentication guards before deploying to production.
  app.registerController(HealthController);
  app.registerController(ExampleController);

  // ── OpenAPI spec ──────────────────────────────────────────────────────
  const openApiSpec = app.openApiSpec();
  app.use(async (ctx, next) => {
    if (ctx.path === '/openapi.json' && ctx.method === 'GET') {
      ctx.json(openApiSpec);
      return;
    }
    await next();
  });

  // ── Start server ─────────────────────────────────────────────────────
  await app.listen(port, host);

  // ── Graceful shutdown ────────────────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    console.log(\`[street] Received \${signal}. Shutting down...\`);
    try {
      await app.close();
      await wsServer.close();
      ${isSqlite ? 'await pool.close();' : 'if (pool) await pool.close();'}
      telemetry.destroy();
      rateLimiter.destroy();
    } catch (err) {
      console.error('[street] Shutdown error:', err);
    }
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('[street] Fatal error:', err);
  process.exit(1);
});
`;
  }

  private renderExampleController(): string {
    return `// src/controllers/example.controller.ts
// Example REST controller demonstrating CRUD operations.

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  ApiOperation,
  container,
} from 'streetjs';
import type { StreetContext } from 'streetjs';
import { ExampleService, CreateItemInput, UpdateItemInput } from '../services/example.service.js';

@Controller('/api/items')
export class ExampleController {
  private readonly exampleService = container.resolve(ExampleService);

  @Get('/')
  @ApiOperation({ summary: 'List all items', tags: ['items'] })
  async findAll(ctx: StreetContext): Promise<void> {
    const page = parseInt(ctx.query['page'] ?? '1', 10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    const result = await this.exampleService.findAll(page, limit);
    ctx.json(result);
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get item by ID', tags: ['items'] })
  async findById(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    const item = await this.exampleService.findById(id);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Post('/')
  @ApiOperation({ summary: 'Create a new item', tags: ['items'] })
  async create(ctx: StreetContext): Promise<void> {
    const data = ctx.body as Record<string, unknown> | null;
    if (!data || typeof data !== 'object' || !data['name'] || typeof data['name'] !== 'string') {
      ctx.json({ error: 'Invalid request body — name is required' }, 400);
      return;
    }
    const input: CreateItemInput = {
      name: data['name'],
      description: typeof data['description'] === 'string' ? data['description'] : undefined,
    };
    const item = await this.exampleService.create(input);
    ctx.json(item, 201);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update an item', tags: ['items'] })
  async update(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    const data = ctx.body as Record<string, unknown> | null;
    if (!id || !data) {
      ctx.json({ error: 'Missing id or body' }, 400);
      return;
    }
    const item = await this.exampleService.update(id, data as UpdateItemInput);
    if (!item) {
      ctx.json({ error: 'Item not found' }, 404);
      return;
    }
    ctx.json(item);
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete an item', tags: ['items'] })
  async delete(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    if (!id) {
      ctx.json({ error: 'Missing id parameter' }, 400);
      return;
    }
    await this.exampleService.delete(id);
    ctx.send(204);
  }
}
`;
  }

  private renderHealthController(): string {
    return `// src/controllers/health.controller.ts
// Health check endpoint for monitoring and orchestration.

import { Controller, Get, ApiOperation } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/health')
export class HealthController {
  @Get('/')
  @ApiOperation({ summary: 'Health check', tags: ['system'] })
  async check(ctx: StreetContext): Promise<void> {
    ctx.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  }
}
`;
  }

  private renderExampleService(): string {
    return `// src/services/example.service.ts
// Example service with business logic layer.

import { Injectable } from 'streetjs';
import { ExampleRepository } from '../repositories/example.repository.js';

export interface Item {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateItemInput {
  name: string;
  description?: string;
}

export interface UpdateItemInput {
  name?: string;
  description?: string;
}

@Injectable()
export class ExampleService {
  constructor(private readonly repository: ExampleRepository) {}

  async findAll(page: number, limit: number) {
    return this.repository.findAll(page, limit);
  }

  async findById(id: string): Promise<Item | null> {
    return this.repository.findById(id);
  }

  async create(input: CreateItemInput): Promise<Item> {
    const now = new Date();
    const item: Item = {
      id: crypto.randomUUID(),
      name: input.name,
      description: input.description ?? '',
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.create(item);
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item | null> {
    const existing = await this.repository.findById(id);
    if (!existing) return null;

    const updated: Item = {
      ...existing,
      ...input,
      updatedAt: new Date(),
    };
    await this.repository.update(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
`;
  }

  private renderExampleRepository(database = 'sqlite'): string {
    const isSqlite = database === 'sqlite';
    const PoolType = isSqlite ? 'SqlitePool' : 'PgPool';
    // SQLite uses '?' positional placeholders; PostgreSQL uses '$1', '$2', …
    const ph = (n: number): string => (isSqlite ? '?' : `$${n}`);
    return `// src/repositories/example.repository.ts
// Example repository backed by the Street framework's ${isSqlite ? 'SQLite' : 'PostgreSQL'} pool.
//
// The pool is resolved LAZILY (inside each method), not in a field initializer,
// so the repository can be constructed even when the database is not yet
// configured. If it isn't, queries throw a clear error that the framework turns
// into an HTTP 503 — the server keeps running.

import { Injectable, container, ${PoolType}, ServiceUnavailableException } from 'streetjs';
import type { Item } from '../services/example.service.js';

type Row = Record<string, unknown>;

/** Map a database row to an Item */
function rowToItem(row: Row): Item {
  return {
    id: String(row['id'] ?? ''),
    name: String(row['name'] ?? ''),
    description: String(row['description'] ?? ''),
    createdAt: new Date(String(row['created_at'] ?? Date.now())),
    updatedAt: new Date(String(row['updated_at'] ?? Date.now())),
  };
}

@Injectable()
export class ExampleRepository {
  /** Lazily resolve the pool; throw a 503 (not a crash) if unconfigured. */
  private get pool(): ${PoolType} {
    try {
      return container.resolve(${PoolType});
    } catch {
      throw new ServiceUnavailableException('Database not configured — set credentials in .env (see .env.example).');
    }
  }

  async findAll(page: number, limit: number): Promise<{ items: Item[]; total: number }> {
    const offset = (page - 1) * limit;

    const [dataResult, countResult] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT ${ph(1)} OFFSET ${ph(2)}',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);

    const items = (dataResult.rows as Row[]).map(rowToItem);
    const total = parseInt(String(countResult.rows[0]?.['total'] ?? '0'), 10);

    return { items, total };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = ${ph(1)}',
      [id]
    );
    const row = result.rows[0] as Row | undefined;
    return row ? rowToItem(row) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      \`INSERT INTO items (id, name, description, created_at, updated_at)\n       VALUES (${ph(1)}, ${ph(2)}, ${ph(3)}, ${ph(4)}, ${ph(5)})\`,
      [item.id, item.name, item.description, item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      \`UPDATE items\n       SET name = ${ph(1)}, description = ${ph(2)}, updated_at = ${ph(3)}\n       WHERE id = ${ph(4)}\`,
      [item.name, item.description, item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = ${ph(1)}', [id]);
  }
}
`;
  }

  private renderAuthMiddleware(): string {
    return `// src/middleware/auth.ts
// Custom authentication and authorization middleware examples.

import type { StreetContext } from 'streetjs';
import { container, JwtService, UnauthorizedException } from 'streetjs';

/**
 * JWT-based authentication middleware.
 * Extracts Bearer token from Authorization header and sets ctx.user.
 */
export async function authenticate(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const authHeader = ctx.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedException('Missing or invalid authorization header');
  }

  const token = authHeader.slice(7);
  const jwtService = container.resolve(JwtService);

  try {
    const payload = jwtService.verify(token);
    ctx.user = payload as StreetContext['user'] ?? { id: '', email: '', roles: [] };
    await next();
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}

/**
 * Role-based authorization middleware.
 * Must be used after authenticate().
 */
export function requireRole(...roles: string[]) {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    const user = ctx.user;
    if (!user || !user.roles || !roles.some((r) => user.roles.includes(r))) {
      throw new UnauthorizedException('Insufficient permissions');
    }
    await next();
  };
}

/**
 * Request logging middleware.
 */
export async function requestLogger(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const start = Date.now();
  const method = ctx.req.method ?? 'UNKNOWN';
  const url = ctx.req.url ?? '/';

  console.log(\`[http] --> \${method} \${url}\`);

  await next();

  const duration = Date.now() - start;
  const status = ctx.res.statusCode ?? 200;
  console.log(\`[http] <-- \${method} \${url} \${status} (\${duration}ms)\`);
}
`;
  }

  private renderChatGateway(): string {
    return `// src/gateways/chat.gateway.ts
// Example WebSocket gateway for real-time chat.
// Attached to the HTTP server via StreetWebSocketServer.attach().

import { StreetSocket } from 'streetjs';
import type { IncomingMessage } from 'node:http';

interface ChatMessage {
  type: 'message' | 'join' | 'leave';
  user: string;
  text: string;
  timestamp: number;
}

// Unique client ID generator
let nextClientId = 1;

const connections = new Map<number, { socket: StreetSocket; user: string; clientId: number }>();

// NOTE: In main.ts, wire up the WebSocket server with:
//   import { chatConnectionHandler } from './gateways/chat.gateway.js';
//   import { createServer } from 'node:http';
//   ...
//   const httpServer = createServer(...);
//   wss.attach(httpServer, chatConnectionHandler);
//   httpServer.listen(port, host);

/** WebSocket connection handler — called for each new connection */
export function chatConnectionHandler(socket: StreetSocket, _req: IncomingMessage): void {
  const clientId = nextClientId++;
  let userName = \`Anonymous-\${clientId}\`;

  socket.on('message', (data: unknown) => {
    try {
      const msg = data as ChatMessage;

      switch (msg.type) {
        case 'join':
          userName = msg.user || userName;
          connections.set(clientId, { socket, user: userName, clientId });
          broadcast({
            type: 'join',
            user: userName,
            text: \`\${userName} joined the chat\`,
            timestamp: Date.now(),
          });
          break;

        case 'message':
          broadcast({
            type: 'message',
            user: userName,
            text: msg.text,
            timestamp: Date.now(),
          });
          break;

        default:
          socket.emit('error', { message: 'Unknown message type' });
      }
    } catch (err) {
      socket.emit('error', { message: 'Invalid message format', detail: String(err) });
    }
  });

  socket.on('close', () => {
    connections.delete(clientId);
    broadcast({
      type: 'leave',
      user: userName,
      text: \`\${userName} left the chat\`,
      timestamp: Date.now(),
    });
  });
}

function broadcast(message: ChatMessage): void {
  const data = JSON.stringify(message);
  for (const [, conn] of connections) {
    try {
      conn.socket.emit('chat', data);
    } catch {
      // Socket may have closed — remove it
      connections.delete(conn.clientId);
    }
  }
}
`;
  }

  private renderTsconfig(): string {
    return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`;
  }

  private renderDockerfile(): string {
    return `# Dockerfile — Multi-stage build for Street applications

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:24-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appuser \
  && adduser --system --uid 1001 appuser

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations

USER appuser

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/main.js"]
`;
  }

  private renderDockerCompose(database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `# docker-compose.yml
# Development environment (SQLite — no database server required).

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      HOST: "0.0.0.0"
      DB_DRIVER: sqlite
      # ':memory:' is ephemeral. For production, switch to PostgreSQL:
      # recreate the project with \`--database postgres\`.
      SQLITE_PATH: ":memory:"
      # JWT_SECRET / SESSION_KEY are auto-generated as valid ephemeral dev keys
      # when unset (NODE_ENV=development). Set them for stable sessions / prod.
      # CORS_ORIGINS empty = allow all in development; set an allowlist for prod.
      CORS_ORIGINS: ""
    volumes:
      - ./uploads:/app/uploads
`;
    }
    return `# docker-compose.yml
# Development environment with PostgreSQL. Compose provisions the database with
# credentials that match the app — no host PostgreSQL or manual setup needed.

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: development
      PORT: "3000"
      HOST: "0.0.0.0"
      DB_DRIVER: postgres
      PG_HOST: postgres
      PG_PORT: "5432"
      PG_DATABASE: street
      PG_USER: street
      PG_PASSWORD: street_pass
      # JWT_SECRET / SESSION_KEY are auto-generated as valid ephemeral dev keys
      # when unset (NODE_ENV=development). Set them for stable sessions / prod.
      # CORS_ORIGINS empty = allow all in development; set an allowlist for prod.
      CORS_ORIGINS: ""
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./uploads:/app/uploads

  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_DB: street
      POSTGRES_USER: street
      POSTGRES_PASSWORD: street_pass
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker-init:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U street -d street"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  pgdata:
`;
  }

  private renderEnvExample(database = 'sqlite'): string {
    if (database === 'sqlite') {
      return `# .env.example — Copy to .env. SQLite needs no credentials; this works as-is.

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database (SQLite — zero-config)
DB_DRIVER=sqlite
# ':memory:' is an ephemeral in-process database (resets on restart).
# Set a file path for local persistence, or switch to PostgreSQL for production
# by recreating with \`--database postgres\`.
SQLITE_PATH=:memory:

# Security — left empty so they are auto-generated as valid ephemeral dev keys
# (NODE_ENV=development). REQUIRED in production:
#   JWT_SECRET:  openssl rand -hex 24   (≥32 chars)
#   SESSION_KEY: openssl rand -hex 32   (exactly 64 hex chars)
JWT_SECRET=
SESSION_KEY=

# CORS — comma-separated allowlist of trusted origins. Leave empty in dev to
# allow all origins (*). REQUIRED in production (no wildcard fallback).
# Example: CORS_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ORIGINS=

# Paths
UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
`;
    }
    return `# .env.example — Copy to .env and fill in your values.
#
# PG_USER, PG_PASSWORD, and PG_DATABASE are REQUIRED and have no defaults — the
# app validates them on startup and will not guess credentials. If you don't
# have a PostgreSQL server, either run \`docker compose up\` (provisions one) or
# recreate the project with \`--database sqlite\` for a zero-config local database.

# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database (PostgreSQL) — REQUIRED
DB_DRIVER=postgres
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=
PG_USER=
PG_PASSWORD=

# Security — left empty so they are auto-generated as valid ephemeral dev keys
# (NODE_ENV=development). REQUIRED in production:
#   JWT_SECRET:  openssl rand -hex 24   (≥32 chars)
#   SESSION_KEY: openssl rand -hex 32   (exactly 64 hex chars)
JWT_SECRET=
SESSION_KEY=

# CORS — comma-separated allowlist of trusted origins. Leave empty in dev to
# allow all origins (*). REQUIRED in production (no wildcard fallback).
# Example: CORS_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ORIGINS=

# Paths
UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
`;
  }

  private renderGitignore(): string {
    return `# Dependencies
node_modules/

# Build output
dist/

# Environment
.env
.env.local
.env.production

# Uploads (keep directory, ignore contents)
uploads/*
!uploads/.gitkeep

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo

# Test coverage
coverage/

# Logs
*.log
npm-debug.log*
`;
  }

  private renderTestFile(): string {
    return `// tests/integration.test.ts
// Basic integration test for the Street application.

import { describe, it } from 'node:test';
import assert from 'node:assert';

// NOTE: These tests assume the server is running.
// In CI, start the server before running tests.

const BASE_URL = process.env['TEST_URL'] ?? 'http://localhost:3000';

describe('Street Application', () => {
  it('should return health check', async () => {
    const res = await fetch(\`\${BASE_URL}/health\`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assert.strictEqual(body['status'], 'ok');
    assert.ok(typeof body['timestamp'] === 'string');
  });

  it('should list items', async () => {
    const res = await fetch(\`\${BASE_URL}/api/items\`);
    assert.strictEqual(res.status, 200);

    const body = await res.json() as Record<string, unknown>;
    assert.ok(Array.isArray(body['items']));
    assert.ok(typeof body['total'] === 'number');
  });

  it('should return 404 for unknown routes', async () => {
    const res = await fetch(\`\${BASE_URL}/nonexistent\`);
    assert.strictEqual(res.status, 404);
  });
});
`;
  }

  private renderReadme(projectName: string): string {
    return `# ${projectName}

A [Street](https://hassanmubiru.github.io/StreetJS) framework application.

## Prerequisites

- Node.js >= 22.0.0
- PostgreSQL >= 14 (optional, for database features)

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Start development server
street dev
\`\`\`

## Available Commands

| Command                    | Description                        |
| -------------------------- | ---------------------------------- |
| \`street dev\`              | Start development server           |
| \`street build\`            | Compile for production             |
| \`street start\`            | Start production server            |
| \`street test\`             | Run tests                          |
| \`street migrate:run\`      | Run pending migrations             |
| \`street migrate:create\`   | Create a new migration file        |

## Project Structure

\`\`\`
${projectName}/
├── src/
│   ├── controllers/    # HTTP request handlers
│   ├── services/       # Business logic
│   ├── repositories/   # Data access layer
│   ├── middleware/     # Custom middleware
│   ├── gateways/       # WebSocket handlers
│   └── main.ts         # Application entry point
├── tests/              # Integration and unit tests
├── migrations/         # SQL migration files
├── uploads/            # File upload storage
├── package.json
├── tsconfig.json
├── Dockerfile
├── street.config.ts
└── README.md
\`\`\`

## Scripts

\`\`\`bash
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Production start
npm run test         # Run tests
npm run migrate      # Run migrations
\`\`\`
`;
  }
}
