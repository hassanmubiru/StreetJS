// src/modules/billing/billing.service.ts
// Stripe billing module for the SaaS starter (overlay code — NOT framework code).
// Requires `--with-billing` (composes @streetjs/plugin-stripe; install-on-demand).
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
// `stripe_events(event_id PRIMARY KEY, processed_at)` table or the core KV
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
 * event. org_id is taken from the object metadata (Stripe `metadata.org_id`) or
 * `client_reference_id` (set when creating the checkout session). A deletion
 * event is normalised to status `canceled`.
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
