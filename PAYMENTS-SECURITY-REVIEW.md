# StreetJS Payments Security Review — 2026

> Provider-by-provider adversarial review of the StreetJS payment integrations: **MarzPay**, **Stripe**, **PayPal**. Source-verified; companion to `SECURITY-AUDIT-2026.md`. Each finding carries exploit path · impact · likelihood · remediation · effort.

## Scope & evidence

- `packages/plugin-marzpay/src/index.ts` and the `--with-marzpay` overlays in `packages/cli/src/commands/create.ts` (`004_marzpay_billing.sql`, MarzPay billing/subscription services + checkout/webhook controllers).
- `packages/plugin-stripe/src/index.ts`, `packages/core/src/platform/plugins/official/stripe.ts` (`StripeClient`), and the `--with-billing` Stripe overlays (`billing.service.ts`, `billing.controller.ts`, `005_stripe_events.sql`).
- `packages/plugin-paypal/src/index.ts`.

## Threat model for payment webhooks

Webhook routes are **unauthenticated** by network identity; trust must come from **(a)** provider signature verification over the **unmodified raw body** with a replay window, or **(b)** server-side re-verification of the referenced transaction. The state change must be **idempotent** (dedup keyed by event/transaction id, inside the same DB transaction) and **tenant-bound** to a server-derived org. The applied monetary amount must come from the verified source, never the raw payload.

---

## 1. Stripe

### Strengths (verified)
- **Idempotency is atomic.** `BillingService.handleEvent` runs `events.hasProcessed(tx, id)` / `events.recordProcessed(tx, id)` inside the **same** `uow.transaction` as `repo.upsertInTx(...)`. A duplicate event id is skipped; a persist failure rolls back both the upsert and the processed-event record (the controller then returns 500 → Stripe retries). Backed by `005_stripe_events.sql` (`event_id TEXT PRIMARY KEY`).
- **No monetary amount from payload.** Only `plan`/`status`/`stripe_customer_id`/`current_period_end` are applied; outbound `buildCreatePaymentIntent` enforces a positive-integer minor-unit amount.
- **No secret leakage.** Secrets read from env; errors don't echo secret/body values.

### PAY-1 — Stripe webhook signature verification is a phantom control — HIGH
- **Affected:** `create.ts` (`billing.controller.ts` overlay, `defaultVerifier()`); `packages/core/src/platform/plugins/official/stripe.ts` (`StripeClient`).
- **Evidence:** `defaultVerifier()` returns `new StripeClient(config) as unknown as StripeWebhookVerifier`, and `webhook()` calls `verifier.verify(rawBody, signature, secret, { tolerance: 300 })`. **`StripeClient` has no `verify` method** — only `buildRequest`, `buildCreatePaymentIntent`, `post`. No HMAC/timestamp/constant-time code exists anywhere. `rawBodyOf(ctx)` reads `ctx.state.rawBody`, which **no emitted middleware/route populates**, and `BillingController` is never instantiated in `main.ts`.
- **Exploit path:** As shipped, the `verify` call throws `TypeError`, is caught by `catch {}`, and returns 400 — *fail-closed but non-functional*. The documented "signature + 300 s tolerance" trust anchor **does not exist in code**. A developer enabling billing must implement verification themselves; if they instead trust the parsed payload (the path of least resistance), forged `checkout.session.completed`/`customer.subscription.updated` events grant entitlements.
- **Impact:** Forged/replayed subscription events → entitlement fraud / unauthorized plan changes.
- **Likelihood:** Medium (latent; materializes when billing is wired).
- **Remediation:** Implement a real `StripeClient.verify(rawBody, sigHeader, secret, { tolerance })`: parse the `t=`/`v1=` scheme, HMAC-SHA256 over `${t}.${rawBody}`, `timingSafeEqual` the hex, reject `|now − t| > tolerance`; return the typed event or throw. Emit a raw-body middleware that sets `ctx.state.rawBody` for `/webhooks/stripe`, register the route outside CSRF/tenant chains, and instantiate `BillingController`. Remove the `as unknown as` cast so the type checker enforces the contract.
- **Effort:** Medium.

### PAY-4 — Cross-tenant write via attacker-influenceable mapping — MEDIUM
- **Affected:** `create.ts` `mapEventToSubscription`: `orgId = str(metadata,'org_id') ?? str(obj,'client_reference_id')`.
- **Evidence:** `org_id` is taken from event metadata / `client_reference_id` with no check that the paying customer owns that org; `stripe_customer_id` is stored but never matched back. `client_reference_id` is commonly attacker-settable at checkout creation.
- **Exploit path:** Attacker sets `client_reference_id` to a victim org id when creating a checkout session; the (eventually) verified event upserts the subscription onto the victim tenant.
- **Impact:** Cross-tenant subscription/billing manipulation. **Likelihood:** Low–Medium.
- **Remediation:** Establish `stripe_customer_id → org` at subscribe time (server-side) and derive `org_id` from the verified customer; reject events whose mapped org disagrees with the customer's bound org.
- **Effort:** Medium.

### LOW / informational
- The controller's broad `catch {}` collapses bad-signature / expired / missing-raw-body / TypeError into a single unlogged 400 — add structured logging to distinguish attack from misconfiguration. The `billing.service.ts` header comment claims "there is no migration for it" while `005_stripe_events.sql` now ships — correct the stale comment to avoid a developer wiring a non-unique KV store that could double-process. *Effort: Low.*

---

## 2. PayPal

### PAY-2 — No webhook authenticity verification exists — HIGH
- **Affected:** `packages/plugin-paypal/src/index.ts`.
- **Evidence:** The plugin is **outbound-only**: `buildTokenRequest` (OAuth2 client-credentials, Basic auth), `buildCreateOrderRequest` (validated amount/currency), and a `node:https` `PayPalClient`. There is **no webhook handler, no `/v1/notifications/verify-webhook-signature` call, no transmission-signature/cert-chain verification, and no order capture/verify**.
- **Exploit path:** An integrator who confirms PayPal payments via webhooks (the normal pattern) has no authenticity check in this plugin; they must hand-roll a handler, and nothing guides them to verify — a forged webhook POST is trusted.
- **Impact:** Payment spoofing / fulfilling unpaid orders.
- **Likelihood:** Medium (depends on integrator building confirmation on this plugin).
- **Remediation:** Add a `verifyWebhook()` that calls PayPal's `verify-webhook-signature` API (or validates the transmission signature against the downloaded cert chain) and an order **capture/verify** path; document that inbound events MUST be server-verified before fulfillment.
- **Effort:** Medium.

### Strengths (verified)
- Defaults to `sandbox`; `environment` validated to `sandbox|live`. Outbound amount/currency regex-validated (`/^\d+(\.\d{1,2})?$/`, `/^[A-Z]{3}$/`). Credentials via env/config only; no secret leakage in errors. OAuth token fetched per use over `node:https` (TLS enforced by scheme).

---

## 3. MarzPay

### PAY-3 — No idempotency/replay store and no tenant binding — HIGH (latent)
- **Affected:** `packages/cli/src/commands/create.ts` (MarzPay `recordPayment`, webhook controller, `004_marzpay_billing.sql`); `packages/plugin-marzpay/src/index.ts`.
- **Evidence:**
  - **Idempotency:** `recordPayment` is a bare `orgScopedRepo(repo, ctx).insert({ reference, amount, currency, ... })`. `billing_records` has **no UNIQUE on `reference`** and there is **no processed-event store/migration** (Stripe got `005_stripe_events.sql`; MarzPay's `004` has no equivalent). Dedup is also not inside the credit transaction.
  - **Tenant binding:** the webhook route is unauthenticated; `orgScopedRepo` requires `ctx.org`, which the webhook path cannot set from an authenticated user. `org_id` is **not** derived from the verified transaction (no `reference → org` lookup). If forced to work by injecting `ctx.org`, it becomes attacker-influenceable.
  - **Current behavior:** `validateWebhook` returns `false` unconditionally because MarzPay publishes no signature scheme (`MARZPAY_SPEC.webhook` unbound) — so the persist path is presently **unreachable dead code**, and the controller returns 400 for every webhook (fail-closed). The contradiction (a re-verify "positive path" that can never execute) invites a developer to "fix" the always-400 by relaxing the gate, which would open both gaps at once.
- **Exploit path:** Once settlement is enabled (the documented `getTransaction` re-verify path), a duplicated/replayed webhook inserts the same settlement N times, and tenant attribution is broken or attacker-influenceable.
- **Impact:** Double-credited payments / inflated billing; potential cross-tenant write.
- **Likelihood:** Medium (latent until settlement is wired).
- **Remediation:** Add `marzpay_events(reference PRIMARY KEY, processed_at)` + a UNIQUE constraint on `billing_records.reference`; dedup inside the insert transaction (mirror Stripe's `ProcessedEventStore`). Derive `org_id` from the verified transaction (`reference → customer/order → org`) and validate against the mapped org. Resolve the dead-path contradiction by making the controller's intent explicit (poll/re-verify only) until a vendor signature scheme exists.
- **Effort:** Medium.

### PAY-5 — Unencoded path-segment interpolation — LOW
- **Affected:** `packages/plugin-marzpay/src/index.ts` (resource paths built by interpolating identifiers without `encodeURIComponent`).
- **Evidence:** The outbound host is fixed (`https://wallet.wearemarz.com/api/v1`), so there is **no cross-host SSRF**, but unencoded `reference`/identifier segments allow limited same-host path/query injection.
- **Impact:** Limited same-host request manipulation. **Likelihood:** Low. **Remediation:** `encodeURIComponent` every interpolated path/query segment. **Effort:** Low.

### Strengths (verified)
- **Amount/currency integrity:** credited values come from a **server-side `getTransaction` re-verification** (`verifiedEvent`), not the webhook payload — the strongest part of the design. (Caveat: the `reference` selecting which transaction to re-verify is payload-controlled; PAY-4-style binding still applies.)
- **Verification fail-closed:** `verifyWebhookSignature` computes an HMAC with `timingSafeEqual` + equal-length guard and returns `false` for absent/empty/malformed material and for the unbound scheme — no fail-open path.
- **Credential handling:** HTTP Basic over HTTPS only; no secret logging; errors don't echo secrets.
- **Vendor honesty:** MarzPay genuinely publishes no webhook signature scheme; leaving it unbound (rather than inventing one) is correct.

---

## 4. Cross-provider remediation summary

| Finding | Provider | Severity | Fix | Effort |
|---|---|---|---|---|
| PAY-1 | Stripe | HIGH | Real `StripeClient.verify` (HMAC+tolerance+const-time) + raw-body wiring + instantiate controller; drop `as unknown as` cast | Medium |
| PAY-2 | PayPal | HIGH | Add webhook signature verification + order capture/verify; document verify-before-fulfill | Medium |
| PAY-3 | MarzPay | HIGH | `marzpay_events` store + UNIQUE(reference) + in-tx dedup; derive tenant from verified txn | Medium |
| PAY-4 | Stripe/MarzPay | MEDIUM | Bind org to verified customer/transaction; reject mismatched mapping | Medium |
| PAY-5 | MarzPay | LOW | `encodeURIComponent` path segments | Low |

**Guardrails:** reuse `node:crypto` (HMAC/`timingSafeEqual`) — no new runtime dependency. Mirror the proven Stripe idempotency pattern (in-transaction processed-event store) for every provider. Treat the webhook payload as untrusted for everything except selecting the id to re-verify.
