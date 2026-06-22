// src/modules/audit/audit.service.ts
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
   * `before` pages backwards from a created_at cursor when provided.
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
   * appenderFor — build an AuditAppender that writes to audit_logs for `orgId`
   * inside transaction `tx`. Use this when a caller already owns a transaction
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
