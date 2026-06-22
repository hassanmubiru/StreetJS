// src/modules/orgs/org.service.ts
// Organization module for the SaaS starter (overlay code — NOT framework code).
//
// OrgService.create persists an `organizations` row PLUS an owner `memberships`
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
   * create — persist an organization and grant the creator the `owner` role.
   *
   * The slug is checked first: a duplicate slug rejects with 409 and NO
   * `organizations` or `memberships` row is written. Otherwise the org row and
   * the owner membership row are written together inside one transaction.
   */
  async create(actorId: string, input: { name: string; slug: string }): Promise<Organization> {
    const existing = await this.orgs.findBySlug(input.slug);
    if (existing) {
      throw new ConflictException(`organization slug "${input.slug}" already exists`);
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
