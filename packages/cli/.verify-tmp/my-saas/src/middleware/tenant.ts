// src/middleware/tenant.ts
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
