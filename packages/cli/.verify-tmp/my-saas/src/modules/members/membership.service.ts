// src/modules/members/membership.service.ts
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
