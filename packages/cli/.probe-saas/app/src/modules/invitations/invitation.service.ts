// src/modules/invitations/invitation.service.ts
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
