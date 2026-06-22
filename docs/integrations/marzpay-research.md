# MarzPay Integration Research Artifact

> **Status:** Verify-don't-invent research foundation (Requirement 1, Task 1).
> **Single source of truth:** MarzPay_Documentation at `https://wallet.wearemarz.com/`.
> **Audited:** `https://wallet.wearemarz.com/documentation` and its sub-pages
> (`api`, `getting-started`, `payments`, `collections`/`card-payments`,
> `webhooks`, `security`, `sandbox`). All behaviors recorded below were read
> directly from those pages. Anything not documented there is recorded as a
> limitation and is **not** to be implemented.

This artifact is a **hard predecessor** for every downstream MarzPay capability.
The `MarzPaySpec` binding (Task 3) reads each concrete value **only** from a
`Verified_Capability` recorded here. Any topic recorded as a limitation leaves
its `MarzPaySpec` seam **unbound** and its dependent capability **unbuilt**.

## Topic Classification Summary

All ten required topics are classified as exactly one of `Verified_Capability`
or `recorded limitation`:

| # | Topic | Classification |
|---|-------|----------------|
| 1 | Authentication | **Verified_Capability** |
| 2 | Payment initialization | **Verified_Capability** |
| 3 | Payment verification | **Verified_Capability** |
| 4 | Webhooks (delivery + payload) | **Verified_Capability** |
| 5 | Refunds | **Limitation** (undocumented) |
| 6 | Subscriptions (customer billing) | **Limitation** (undocumented) |
| 7 | Recurring billing | **Limitation** (undocumented) |
| 8 | Sandbox environment | **Verified_Capability** |
| 9 | Production environment | **Verified_Capability** |
| 10 | Security requirements | **Verified_Capability** |

> **Webhook signature note (critical):** While *webhook delivery and payload
> shape* are documented and verified (topic 4), the **webhook signature
> verification scheme** (algorithm + header + encoding) is **NOT documented
> anywhere** in MarzPay_Documentation. It is therefore recorded as a distinct
> limitation (see Limitations §L4) and the `MarzPaySpec.webhook` seam MUST be
> left unbound. Do not invent an HMAC scheme.

---

## Section 1 — Verified Capabilities

Each entry records the verified behavior and a resolvable citation URL under
`https://wallet.wearemarz.com/`.

### V1. Authentication — Verified_Capability

- **Scheme:** HTTP **Basic Auth**. The `Authorization` header carries
  `Basic <credentials>` where
  `<credentials> = base64_encode("your_api_key:your_api_secret")`.
- **Required headers:** `Authorization: Basic YOUR_API_CREDENTIALS` and
  `Content-Type: application/json`.
- **Credential provisioning:** API key + secret are generated in the dashboard
  API Keys section; the key is shown once and must be stored securely.
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/api` (API Overview →
    "Authentication: API Key (Basic Auth)"; "Format: `YOUR_API_CREDENTIALS` =
    base64_encode(\"your_api_key:your_api_secret\")").
  - `https://wallet.wearemarz.com/documentation/getting-started` (§3 API Keys &
    Authentication).

> **Maps to plugin config:** `apiKey` → API key, `secretKey` → API secret.
> `authHeaders(cfg)` builds `{ Authorization: 'Basic ' + base64(apiKey:secretKey),
> 'Content-Type': 'application/json' }`.

### V2. Payment initialization — Verified_Capability

Two verified initialization paths, both on the **same** Collect Money endpoint:

- **Mobile money collection:** `POST /collect-money`.
  - **Required fields:** `amount` (UGX, 500–10,000,000), `phone_number`
    (`+256xxxxxxxxx`), `country` (`UG`), `reference` (**required**, UUID v4,
    unique, max 50 chars).
  - **Optional fields:** `description` (max 255), `callback_url` (max 255).
  - **Response (201/200):** `status: "success"`, `data.transaction`
    (`uuid`, `reference`, `status: "processing"`, `provider_reference` often
    `null`), `data.collection` (`amount{formatted,raw,currency}`, `provider`,
    `phone_number`, `mode`), `data.timeline`, `data.metadata.sandbox_mode`.
  - Provider (MTN/Airtel) is auto-detected from the phone number.
  - **Duplicate `reference`** returns `error_code: DUPLICATE_REFERENCE` (422).
- **Card payment:** `POST /collect-money` with `method: "card"` (no
  `phone_number`).
  - **Required fields:** `amount`, `method: "card"`, `reference` (UUID),
    `country`. Optional: `description`, `callback_url`.
  - **Response:** `data.transaction` (`uuid`, `reference`, `status: "pending"`)
    and `data.redirect_url` — the customer is sent to the **exact**
    `redirect_url` to complete payment on the card gateway (use as-is; do not
    construct it yourself).
  - Requires an active Card Payments subscription for the country (or GLOBAL).
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/api` (Collection API → Create
    Collection; Request Parameters; Reference Requirements).
  - `https://wallet.wearemarz.com/documentation/getting-started` (§4 Collect
    Money from Customer).
  - `https://wallet.wearemarz.com/documentation/card-payments` (Flow; Create
    card collection; Example request/response).

### V3. Payment verification — Verified_Capability

- **Endpoints:**
  - `GET /transactions/{transaction_id}` — accepts any of `uuid`, `reference`,
    `airtel_reference`, `provider_reference`, `provider_transaction_id`,
    `provider_reference_id`.
  - `GET /collect-money/{uuid}` — collection-specific detail lookup.
- **Response shape:** matches the **webhook callback format exactly** —
  top-level `event_type` (e.g. `collection.completed`), `transaction`
  (`uuid`, `reference`, `status`, `amount{formatted,raw,currency}`, `provider`,
  `phone_number`, `description`, `created_at`, `updated_at`) and a
  `collection`/`disbursement` object.
- **Statuses:** `pending`, `processing`, `successful`/`completed`, `failed`,
  `cancelled` (API list uses `successful`; transaction-detail/webhook responses
  use `completed`). Not-found returns `error_code: TRANSACTION_NOT_FOUND` (404).
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/payments` (Transaction Status
    Check; Transaction Identifiers; Response Format; Transaction Statuses).
  - `https://wallet.wearemarz.com/documentation/api` (Transactions API → Get
    Transaction Details, "Response (Webhook Format)").

### V4. Webhooks (delivery + payload) — Verified_Capability

- **Delivery model:** asynchronous HTTP **POST** to the `callback_url` supplied
  on a collection/disbursement request, sent only for **final** statuses
  (`completed`, `failed`, `cancelled`) — never for `pending`/`processing`.
- **Registration (alternative to inline `callback_url`):** `POST /webhooks`
  with `{ name, url, event_type, is_active }`; managed via
  `GET/POST /webhooks`, `GET/PUT/DELETE /webhooks/{uuid}`.
- **Payload shape:** `event_type` + `transaction{...}` +
  `collection{...}`/`disbursement{...}`. For collections use
  `collection.provider_transaction_id` (not `provider_reference`, which is not
  sent on collection callbacks). Card callbacks use `provider: "card payments"`
  and may have `phone_number: null`. Sandbox callbacks add `business` and
  `metadata.environment: "test"` objects.
- **Event types:** `collection.{completed,failed,pending,cancelled}` and
  `disbursement.{completed,failed,pending,cancelled}`.
- **Acknowledgement contract:** the receiver accepts `Content-Type:
  application/json`, returns **HTTP 200**, and matches the order using
  `transaction.reference`; idempotency is recommended.
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/webhooks` (Overview; Callback
    Flow; Callback Payload Structure; Best Practices).
  - `https://wallet.wearemarz.com/documentation/payments` (Event Types).
  - `https://wallet.wearemarz.com/documentation/sandbox` (Sandbox Callback
    Payload).

> **Boundary:** Topic 4 is verified for *delivery and payload only*. Webhook
> **signature verification** is undocumented — see Limitations §L4.

### V8. Sandbox environment — Verified_Capability

- **Behavior:** Sandbox mode is **automatically enabled by default** on signup
  and is **auto-detected from business settings** — it uses the **same base URL
  and the same endpoints** as production. There is **no separate sandbox host**.
- **Signals:** API responses carry `metadata.sandbox_mode: true`,
  `transaction.status: "sandbox"`, `collection.mode: "sandbox"`, and provider
  references of the form `SANDBOX_{PROVIDER}_{TIMESTAMP}`. Sandbox callbacks
  report `transaction.status: "completed"` and `metadata.environment: "test"`.
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/sandbox` (How Sandbox Mode
    Works; Collect Money API – Sandbox Mode; Sandbox Callback Payload;
    Important Notes).
  - `https://wallet.wearemarz.com/documentation/getting-started` (§4 Testing →
    Sandbox Mode).

### V9. Production environment — Verified_Capability

- **Behavior:** Production ("live") mode uses the identical base URL
  `https://wallet.wearemarz.com/api/v1`; live transactions report
  `status.mode: "live"` and `collection.mode: "mtnuganda"`/`"airteluganda"`/
  `"card paymentsuganda"`. The account moves from sandbox to live once business
  verification is complete. **The environment is determined by the account/key,
  not by a different base address.**
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/api` (Base URL; Balance API
    response `status.mode: "live"`; collection `mode: "live"`).
  - `https://wallet.wearemarz.com/documentation/sandbox` (Important Notes — same
    endpoint as production; sandbox auto-detected per business config).

### V10. Security requirements — Verified_Capability

- **Transport:** all traffic encrypted over **HTTPS**.
- **API key handling:** never expose keys client-side, never commit to version
  control, store in environment variables, rotate regularly; IP allowlisting is
  offered.
- **Account controls:** 2FA (TOTP via Google/Microsoft Authenticator),
  role-based access (Business Owner / Team Member with granular permissions),
  login alerts, and full activity/audit logs.
- **Citations:**
  - `https://wallet.wearemarz.com/documentation/security` (API Key Security;
    Two-Factor Authentication; Roles and Permissions; Activity Logs; Best
    Practices).
  - `https://wallet.wearemarz.com/` (Security section — "HTTPS & API keys",
    "API authentication with secret keys and IP allowlisting options").

---

## Section 2 — Limitations

Topics not documented in MarzPay_Documentation. Per Requirement 1.4 these record
**no assumed behavior** and MUST NOT be implemented from assumption.

### L5. Refunds — Limitation (undocumented)

- The string `refund` appears **only** as a value of the `type` query-parameter
  filter on `GET /transactions` (`type` ∈ `collection, withdrawal, charge,
  refund`). **No refund creation/initiation endpoint, request shape, or refund
  result shape is documented** anywhere in MarzPay_Documentation.
- **Recorded behavior:** none assumed. The `refund` operation and the
  `MarzPaySpec.paths.refund` seam are **unverified/unsupported** and MUST be
  left unbound and unimplemented unless/until MarzPay documents a refund API.
- **Evidence reviewed:** `https://wallet.wearemarz.com/documentation/api`
  (Transactions filter values); no `/refund` endpoint exists in the
  "Available Endpoints" list.

### L6. Subscriptions (customer billing) — Limitation (undocumented)

- "Subscription" in MarzPay_Documentation refers exclusively to a **business's
  subscription to a payment service** (e.g. subscribing to MTN/Airtel/Card
  *collection services*), surfaced read-only via `GET /services` /
  `GET /services/{uuid}` (`subscription.status`, `subscribed_at`, `expires_at`).
  This is **not** a customer-billing subscription/plan API.
- **Recorded behavior:** none assumed for customer billing subscriptions. There
  is **no documented endpoint** to create, manage, or charge a recurring
  customer subscription/plan. The capability is **unverified/unsupported**.
- **Evidence reviewed:** `https://wallet.wearemarz.com/documentation/api`
  (Services API — service subscription status only).

### L7. Recurring billing — Limitation (undocumented)

- **No scheduled, automatic, or recurring charge mechanism** is documented.
  Every collection requires an explicit `POST /collect-money` with a unique
  per-transaction `reference`; there is no documented schedule, mandate,
  tokenized re-charge, or "charge again" capability.
- **Recorded behavior:** none assumed. Recurring billing is
  **unverified/unsupported** and MUST NOT be implemented from assumption.
- **Evidence reviewed:** `https://wallet.wearemarz.com/documentation/api`,
  `https://wallet.wearemarz.com/documentation/collections`,
  `https://wallet.wearemarz.com/documentation/card-payments` — all describe only
  one-shot collections.

### L4. Webhook signature verification scheme — Limitation (undocumented)

> This is a sub-capability of the verified Webhooks topic (V4), recorded as a
> distinct limitation because downstream design depends on it.

- MarzPay_Documentation describes webhook **delivery and payload** but documents
  **no signature header, no HMAC/signing algorithm, no encoding, and no shared
  signing secret** for verifying webhook authenticity. The only documented
  trust/identification mechanisms are HTTPS transport and matching by
  `transaction.reference` (with recommended idempotency).
- **Recorded behavior:** none assumed. The values the design wanted to bind —
  `MarzPaySpec.webhook.signatureHeader`, `.algorithm`, `.encoding` — are
  **unverified** and MUST be left **unbound**.
- **Evidence reviewed:** `https://wallet.wearemarz.com/documentation/webhooks`
  (no signature/HMAC section); `https://wallet.wearemarz.com/documentation/security`
  (no webhook-signing guidance).

---

## Section 3 — Risks

- **R1 — Webhook authenticity gap (high).** With no documented signature scheme,
  a strict HMAC-based `validateWebhook` (Requirements 3.6/3.7, Property 7) cannot
  be implemented from verified docs. Treating any POST to the callback URL as
  authentic risks spoofed billing events. Mitigations the docs *do* support:
  HTTPS-only endpoints, unguessable per-tenant callback URLs, idempotency keyed
  on `transaction.reference`, and **server-side re-verification** of each event
  via `GET /transactions/{reference}` before mutating billing state.
- **R2 — Environment model mismatch (high vs. design).** The design's
  `MarzPaySpec.baseAddress` assumed **distinct sandbox/production base
  addresses**. The documentation shows a **single base URL**
  (`https://wallet.wearemarz.com/api/v1`) with sandbox **auto-detected from
  account/key configuration**. Implementing two hard-coded base addresses would
  be inventing behavior.
- **R3 — Regional/currency scope (medium).** MarzPay is **Uganda-only, UGX**
  today (Kenya/Tanzania/Rwanda "soon"). Amounts are bounded (collections
  500–10,000,000 UGX). Multi-currency/multi-country billing flows are not
  supported.
- **R4 — Unsupported commerce primitives (medium).** Refunds, customer
  subscriptions, and recurring billing are undocumented (L5–L7). Any starter or
  dashboard feature that implies them must be composed from verified primitives
  or omitted, never faked.
- **R5 — Card vs. main wallet split (low/medium).** Card collections credit a
  separate `card_balance` (withdrawable only via `POST /bank-transfer` with
  `wallet_source: "card"`). Billing reconciliation must account for two wallets.
- **R6 — Status vocabulary skew (low).** API list responses use `successful`
  while transaction-detail/webhook responses use `completed`; both `sandbox`
  and `processing`/`pending` appear. Verification logic must treat the documented
  set explicitly rather than assuming a single "success" token.

---

## Section 4 — Implementation Recommendations

These guide the `MarzPaySpec` binding (Task 3) and all downstream artifacts.
Only `Verified_Capability` values may be bound.

1. **Auth seam (from V1):** bind `authHeaders(cfg)` to
   `Authorization: Basic base64(apiKey + ':' + secretKey)` plus
   `Content-Type: application/json`. Map plugin `apiKey`→API key,
   `secretKey`→API secret.
2. **Single base address (from V8/V9, R2):** bind **one** base address
   `https://wallet.wearemarz.com/api/v1` for both `sandbox` and `production`
   selections. Keep the plugin's `environment` config option (Requirement 2.6/2.7
   still require accepting/validating `sandbox`|`production`), but document that
   the **active mode is determined by the API key/account**, and detect sandbox
   at runtime via response `metadata.sandbox_mode` / `transaction.status`
   rather than via a different host. Do **not** invent a second base URL.
3. **initializePayment (from V2):** `POST /collect-money`. Required-field guard
   on `amount`, `phone_number` (mobile money) or `method: "card"` (card),
   `country`, and a unique UUID `reference`; reject missing/empty fields naming
   the field before sending (Requirements 3.1/3.9). For card, return/propagate
   `data.redirect_url` as-is.
4. **verifyPayment / getTransaction (from V3):** `GET /transactions/{id}`
   (accepts reference or uuid). Trim and length-guard the identifier
   (≤256 chars per Requirements 3.2/3.3/3.10). Parse the webhook-shaped response;
   map `status` across the documented set (treat both `successful` and
   `completed` as success).
5. **listTransactions (from V3):** `GET /transactions` with documented filters
   (`page`, `per_page` 1–100, `type`, `status`, `provider`, `start_date`,
   `end_date`, `reference`). Parse `data.transactions` + `data.pagination`.
6. **refund (from L5): LEAVE UNBOUND.** Do not implement a `refund` operation or
   `MarzPaySpec.paths.refund`. Where Requirement 3.5 references refunds, record
   the gap as a limitation and surface an explicit "refunds not supported by
   MarzPay" error/behavior rather than calling an invented endpoint.
7. **Webhook signature (from L4/R1): LEAVE `MarzPaySpec.webhook` UNBOUND.**
   Implement `validateWebhook` defensively against what is documented:
   - Reject when signature material is absent/empty/malformed → returns negative
     (consistent with Requirement 3.7's negative cases).
   - For positive authentication, **re-verify the event server-side** via
     `GET /transactions/{reference}` and match `amount`/`status`/`reference`
     before persisting (the documented, verifiable trust path).
   - **Flag to maintainers/user:** the HMAC round-trip property (Property 7,
     Requirements 3.6/14.6) presumes a signing scheme MarzPay has not published.
     This needs vendor confirmation; until then the strict signature scheme is a
     recorded limitation, not an implemented capability.
8. **Subscriptions & recurring billing (from L6/L7):** the SaaS starter's
   `SubscriptionService` MUST compose only verified primitives — store plan
   definitions in config, drive each billing cycle with an explicit
   `POST /collect-money` (manual/operator-triggered), and reconcile via
   `GET /transactions`. Do not present automatic recurring charges as a MarzPay
   capability; record the gap as a limitation in user-facing docs.
9. **Security (from V10):** require HTTPS callback endpoints, read credentials
   from environment variables only, never log secrets, and document key rotation
   and IP allowlisting. Align with Requirements 2.3/2.4 credential validation.
10. **Currency/region (from R3):** default and validate `currency: "UGX"` and
    `country: "UG"`; bound amounts to the documented 500–10,000,000 UGX range for
    collections.

---

## Appendix A — Verified Wire Facts for `MarzPaySpec` Binding

| Field | Verified value | Source |
|-------|----------------|--------|
| Base address (sandbox) | `https://wallet.wearemarz.com/api/v1` (same as production; sandbox auto-detected by account) | `/documentation/api`, `/documentation/sandbox` |
| Base address (production) | `https://wallet.wearemarz.com/api/v1` | `/documentation/api`, `/documentation/getting-started` |
| Auth scheme | HTTP Basic: `Authorization: Basic base64(apiKey:secretKey)` | `/documentation/api`, `/documentation/security` |
| Content type | `application/json` | `/documentation/api` |
| initializePayment path | `POST /collect-money` (mobile money or `method:"card"`) | `/documentation/api`, `/documentation/card-payments` |
| verifyPayment path | `GET /transactions/{id}` (id = reference or uuid) | `/documentation/payments`, `/documentation/api` |
| getTransaction path | `GET /transactions/{uuid}` (also `GET /collect-money/{uuid}`) | `/documentation/api`, `/documentation/payments` |
| listTransactions path | `GET /transactions` (filters: page, per_page, type, status, provider, start_date, end_date, reference) | `/documentation/api`, `/documentation/payments` |
| refund path | **UNVERIFIED — leave unbound** (no endpoint documented) | `/documentation/api` (filter value only) |
| Webhook delivery | HTTP POST to `callback_url`, JSON body, receiver returns 200, final statuses only | `/documentation/webhooks` |
| Webhook signature algorithm | **UNVERIFIED — leave unbound** (none documented) | `/documentation/webhooks`, `/documentation/security` |
| Webhook signature header | **UNVERIFIED — leave unbound** (none documented) | `/documentation/webhooks` |
| Webhook signature encoding | **UNVERIFIED — leave unbound** (none documented) | `/documentation/webhooks` |
| Success HTTP codes | `200` (GET/PUT/DELETE), `201` (POST) | `/documentation/api` |
| Error HTTP codes | `400, 401, 403, 404, 422, 500` | `/documentation/api` |
| Error body shape | `{ status:"error", message, error_code }` (or `errors{}` map on 422) | `/documentation/api` |

### Request shape — `POST /collect-money` (verified)

```json
{
  "amount": 1000,
  "phone_number": "+256781230949",
  "country": "UG",
  "reference": "c97fae8b-9b7f-4192-9f72-6f0859d33e67",
  "description": "Payment for services",
  "callback_url": "https://your-app.com/marz/callback"
}
```

Card variant: omit `phone_number`, add `"method": "card"`; response returns
`data.redirect_url`.

### Response shape — collection create (verified)

```json
{
  "status": "success",
  "message": "Collection initiated successfully.",
  "data": {
    "transaction": { "uuid": "…", "reference": "…", "status": "processing", "provider_reference": null },
    "collection": { "amount": { "formatted": "1,000.00", "raw": 1000, "currency": "UGX" }, "provider": "mtn", "phone_number": "+256781230949", "mode": "live" },
    "timeline": { "initiated_at": "…", "estimated_settlement": "…" },
    "metadata": { "response_timestamp": "…", "sandbox_mode": false }
  }
}
```

### Response shape — transaction detail / webhook callback (verified, identical)

```json
{
  "event_type": "collection.completed",
  "transaction": {
    "uuid": "…", "reference": "…", "status": "completed",
    "amount": { "formatted": "1,000.00", "raw": 1000, "currency": "UGX" },
    "provider": "mtn", "phone_number": "+256712345678",
    "description": "…", "created_at": "…Z", "updated_at": "…Z"
  },
  "collection": {
    "provider": "mtn", "phone_number": "+256712345678",
    "amount": { "formatted": "1,000.00", "raw": 1000, "currency": "UGX" },
    "mode": "mtnuganda", "provider_transaction_id": "148769164724"
  }
}
```

## Appendix B — Pages Audited

- `https://wallet.wearemarz.com/` (landing — security & developer overview)
- `https://wallet.wearemarz.com/documentation` (index)
- `https://wallet.wearemarz.com/documentation/api` (API Reference)
- `https://wallet.wearemarz.com/documentation/getting-started`
- `https://wallet.wearemarz.com/documentation/payments` (Transaction Details & Status)
- `https://wallet.wearemarz.com/documentation/card-payments`
- `https://wallet.wearemarz.com/documentation/webhooks`
- `https://wallet.wearemarz.com/documentation/security`
- `https://wallet.wearemarz.com/documentation/sandbox`

> Content from these third-party pages was paraphrased and summarized for
> compliance with licensing restrictions; citation URLs are provided for
> verification.
