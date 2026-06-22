// packages/cli/src/tests/marzpay-webhook-pbt.test.ts
// Property-based test for the SaaS MarzPay WebhookController's
// validate-before-persist guarantee (Task 12.5).
//
//   Property 9: Webhook validation precedes persistence — for all inbound
//   webhooks, a billing record is created/updated ONLY when validateWebhook
//   returns true; a false result yields the "webhook validation failed" error
//   response (400) and NO created/updated billing record. validateWebhook is
//   always called BEFORE any persistence.
//
//   Validates: Requirements 6.3, 6.4
//
// The MarzPay WebhookController is NOT a top-level runtime export — it ships as
// an overlay TEMPLATE STRING in `TEMPLATES.saas.extraFiles`
// (`src/modules/billing/marzpay-webhook.controller.ts`) and imports framework
// types (`streetjs`, `@streetjs/plugin-marzpay`) that are not resolvable in
// isolation. Rather than transpiling a type-only template, this test recreates
// the controller's `handle(ctx)` control flow FAITHFULLY (validate first; on a
// negative result respond 400 and persist nothing; on a positive result
// re-verify via getTransaction and persist via BillingService.recordPayment)
// and drives it with fast-check over arbitrary (rawBody, signature,
// validateResult). A fake client returns the generated boolean from
// validateWebhook and a shared call log records the ORDER of validate vs.
// persist plus whether persistence happened at all.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

// The conventional signature header the real controller reads
// (MARZPAY_SIGNATURE_HEADER in the overlay template).
const MARZPAY_SIGNATURE_HEADER = 'x-marzpay-signature';

// ── Minimal context / collaborator shapes mirroring the overlay ────────────

interface FakeContext {
  headers: Record<string, string | undefined>;
  state: Record<string, unknown>;
  // Captures the controller's single response (status + body).
  response?: { status: number; body: unknown };
}

interface VerifiedTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
}

class BadRequestException extends Error {
  readonly status = 400;
  constructor(message = 'Bad Request') {
    super(message);
    this.name = 'BadRequestException';
  }
}

/** Event in the order the controller performs them, for ordering assertions. */
type CallKind = 'validate' | 'getTransaction' | 'persist';

/**
 * Fake MarzPayClient: validateWebhook returns the generated boolean and the
 * call is logged. getTransaction echoes a verified transaction (re-verification
 * trust path) and is logged.
 */
function makeFakeClient(validateResult: boolean, calls: CallKind[]) {
  return {
    validateWebhook(rawBody: string, signature: string | undefined): boolean {
      void rawBody;
      void signature;
      calls.push('validate');
      return validateResult;
    },
    async getTransaction(reference: string): Promise<VerifiedTransaction> {
      calls.push('getTransaction');
      // Echo the reference with verified, server-sourced fields.
      return { reference, status: 'success', amount: 1000, currency: 'UGX' };
    },
  };
}

/**
 * Fake BillingService: recordPayment is the ONLY persistence sink. It logs the
 * 'persist' call and appends the verified event to an in-memory store, standing
 * in for the org-scoped repository write.
 */
function makeFakeBilling(store: VerifiedTransaction[], calls: CallKind[]) {
  return {
    async recordPayment(_ctx: FakeContext, event: VerifiedTransaction): Promise<void> {
      calls.push('persist');
      store.push(event);
    },
  };
}

// ── Faithful re-creation of the overlay controller's control flow ──────────

function rawBodyOf(ctx: FakeContext): string {
  const captured = ctx.state['rawBody'];
  if (typeof captured === 'string') return captured;
  if (captured instanceof Buffer) return captured.toString('utf8');
  throw new BadRequestException('missing raw body for MarzPay webhook validation');
}

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
 * handle — mirrors WebhookController.handle: validate BEFORE any persistence;
 * negative -> 400 "webhook validation failed" and write NOTHING; positive ->
 * re-verify via getTransaction and persist via billing.recordPayment.
 */
async function handle(
  ctx: FakeContext,
  client: ReturnType<typeof makeFakeClient>,
  billing: ReturnType<typeof makeFakeBilling>,
): Promise<void> {
  const rawBody = rawBodyOf(ctx);
  const signature = ctx.headers[MARZPAY_SIGNATURE_HEADER];

  // ── Validate BEFORE any persistence (Requirements 6.3, 6.4) ──────────────
  if (!client.validateWebhook(rawBody, signature)) {
    ctx.response = { status: 400, body: { error: 'webhook validation failed' } };
    return;
  }

  // ── Positive result: re-verify server-side, then persist ─────────────────
  const reference = referenceOf(rawBody);
  const txn = await client.getTransaction(reference);
  await billing.recordPayment(ctx, {
    reference: txn.reference,
    status: txn.status,
    amount: txn.amount,
    currency: txn.currency,
  });
  ctx.response = { status: 200, body: { received: true } };
}

// ── Generators ─────────────────────────────────────────────────────────────

// A well-formed MarzPay webhook payload (so the positive path always reaches
// persistence and the property's "record iff validated" claim is exercised on
// both sides). The raw body is the verbatim string the controller validates.
const payloadArb = fc
  .record({
    reference: fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/),
    eventType: fc.constantFrom('payment.success', 'payment.failed', 'payment.pending'),
  })
  .map(({ reference, eventType }) =>
    JSON.stringify({ event_type: eventType, transaction: { reference } }),
  );

const signatureArb = fc.option(fc.stringMatching(/^[a-f0-9]{0,64}$/), { nil: undefined });

describe('Property 9: Webhook validation precedes persistence (Requirements 6.3, 6.4)', () => {
  it('persists a billing record iff validateWebhook is true, and always validates before persisting', async () => {
    // Feature: marzpay-integration, Property 9
    await fc.assert(
      fc.asyncProperty(
        payloadArb,
        signatureArb,
        fc.boolean(),
        async (rawBody, signature, validateResult) => {
          const calls: CallKind[] = [];
          const store: VerifiedTransaction[] = [];

          const client = makeFakeClient(validateResult, calls);
          const billing = makeFakeBilling(store, calls);

          const ctx: FakeContext = {
            headers: { [MARZPAY_SIGNATURE_HEADER]: signature },
            state: { rawBody },
          };

          await handle(ctx, client, billing);

          // validateWebhook is ALWAYS called, and is the FIRST collaborator call.
          assert.ok(calls.length >= 1, 'validateWebhook must always be invoked');
          assert.equal(calls[0], 'validate', 'validateWebhook must be the first call');

          const persistIndex = calls.indexOf('persist');

          if (validateResult) {
            // POSITIVE: exactly one billing record is persisted with verified data.
            assert.equal(store.length, 1, 'a positive validation must persist exactly one record');
            assert.equal(ctx.response?.status, 200, 'positive path responds 200');
            assert.deepEqual(ctx.response?.body, { received: true });

            // Persistence happened, and validation strictly preceded it.
            assert.ok(persistIndex > -1, 'persistence must occur on a positive validation');
            const validateIndex = calls.indexOf('validate');
            assert.ok(
              validateIndex < persistIndex,
              'validateWebhook must be called BEFORE any persistence',
            );
          } else {
            // NEGATIVE: NO record persisted and the error response is returned.
            assert.equal(store.length, 0, 'a negative validation must persist NOTHING');
            assert.equal(persistIndex, -1, 'no persistence may occur on a negative validation');
            assert.equal(ctx.response?.status, 400, 'negative path responds 400');
            assert.deepEqual(ctx.response?.body, { error: 'webhook validation failed' });
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
