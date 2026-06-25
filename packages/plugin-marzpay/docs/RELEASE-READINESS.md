# Release-Readiness Report — `@streetjs/plugin-marzpay`

**Feature:** marzpay-scope-alignment
**Package:** `@streetjs/plugin-marzpay` (`packages/plugin-marzpay/`)
**Scope of report:** Req 15.5 — coverage, security posture (verified Req 6/7/8
outcomes), and remaining `Recorded_Limitation`s.

> Positioning: *MarzPay for StreetJS applications — payments, billing, webhooks,
> and verification, without the complexity of a full payment SDK.*

This report summarizes the **actual verified outcomes** of the refinement that
reshaped the flat `MarzPayClient` into the six capability namespaces
(`collections`, `disbursements`, `transactions`, `accounts`, `phoneVerification`,
`utils`) under a strict verify-don't-invent discipline.

---

## 1. Coverage and test posture

| Metric | Result | Gate |
|--------|--------|------|
| Branch coverage (c8) | **~97.4%** (97.42% branch, 97.68% stmts/lines, 98.57% funcs) | ≥ **90%** branches (`coverage` script, `check-coverage: true`) — **PASS** |
| Plugin test suite | **131 tests / 54 suites pass, 0 fail** (`node --test test/*.test.mjs`) | All green — **PASS** |
| CLI SaaS overlay suite | Passes against the reshaped namespaced client surface (compatibility shim + namespaces) | All green — **PASS** |
| Property-based tests | **10 properties implemented (Properties 1–10)** | Req 14.2 — **PASS** |
| Signed-manifest contract | `manifest.test.mjs` passes — signed manifest unchanged by the added namespaces (Req 13.2) | **PASS** |
| Provenance / SBOM | Preserved in the publish pipeline (Req 13.3) | **PASS** |

The `coverage` gate is enforced by the package `c8` config
(`branches: 90`, `check-coverage: true`); the build runs `tsc` then
`c8 node --test`. The current run reports **97.42% branch coverage**, comfortably
above the 90% threshold. The only remaining uncovered lines (`616-617`,
`994-1039` in `index.ts`) sit on the **unbound-seam defensive parse paths** that
are intentionally unreachable until a `Verified_Capability` is recorded (see
`Recorded_Limitation`s below).

### Property-based tests (Properties 1–10)

Each design property is implemented as its own PBT and validates the listed
requirement sub-clauses:

| Property | What it proves | Validates |
|----------|----------------|-----------|
| 1 | Argument guards never touch the network (zero sends on invalid input) | 2.3, 2.5, 3.3, 3.5, 4.3, 10.4, 14.3 |
| 2 | Phone formatting round-trip + idempotence; invalid input throws | 11.1, 11.2, 11.4, 14.4 |
| 3 | Webhook processing idempotent (sequential **and** concurrent) — billing write applied at most once | 7.2, 7.3, 14.5 |
| 4 | Tenant isolation + server-derived org binding | 8.1, 8.3, 8.4, 9.3, 13.4 |
| 5 | Verify-don't-invent — unbound-seam ops issue no request | 1.3, 3.6, 5.3, 10.5, 12.7 |
| 6 | Non-2xx responses fail with the status and no partial result | 2.6, 3.7, 4.4 |
| 7 | Webhook signature fail-closed; exact under an explicit scheme | 6.4, 6.5 |
| 8 | Interpolated path/query segments are percent-encoded | 6.6, 13.7 |
| 9 | Unknown plans rejected without persistence or network | 9.4 |
| 10 | Monetary values come only from the verified transaction | 6.3 |

---

## 2. Security posture (verified Req 6/7/8 outcomes)

### Req 6 — Secure webhook handling (verified)

- **Server-side re-verification before persist (6.1/6.3):** the webhook
  controller establishes trust by re-verifying the referenced transaction
  server-side via `transactions.get(reference)` **before** any billing-state
  write. The only value taken from the `Raw_Body` is the `reference` used to
  select which transaction to re-verify. Persisted `amount`, `currency`, and
  `status` are taken **only** from the re-verified transaction — never from the
  `Raw_Body` (proven by **Property 10**).
- **Fail-closed signature validation (6.4/6.5):** while the `MARZPAY_SPEC.webhook`
  signature scheme is **unbound** (`Recorded_Limitation` §L4), `validateWebhook`
  returns `false` for absent, empty, malformed, or mismatched signature material
  — **there is no fail-open path**. When an explicit scheme is supplied,
  `verifyWebhookSignature` returns `true` **only** on constant-time HMAC equality
  over the `Raw_Body` (equal-length guard + `timingSafeEqual`) and `false`
  otherwise (proven by **Property 7**).
- **Percent-encoded interpolation (6.6/13.7):** every interpolated request path
  and query segment is built with `encodeURIComponent`, so an identifier from the
  `Raw_Body` cannot inject path or query structure (proven by **Property 8**).

### Req 7 — Replay protection and idempotency (verified)

- **Processed_Event_Store (7.1/7.5):** migration `005_marzpay_events.sql` creates
  `marzpay_events` (PK on `reference`, `org_id` FK + index) and adds a
  `UNIQUE(reference)` index on `billing_records`. The migration is additive and
  idempotent.
- **Single-transaction idempotent persistence (7.2/7.3/7.4):** the controller
  checks `hasProcessed` and records the processed `reference` **in the same DB
  transaction** as the billing-state write. A duplicate `reference` skips the
  billing write; a billing-write failure rolls back both rows; concurrent
  inserts are resolved by the `UNIQUE(reference)` constraint (loser treated as
  already-processed). Idempotency under both sequential and concurrent delivery
  is proven by **Property 3**.

### Req 8 — Multi-tenant webhook awareness (verified)

- **Server-derived org binding (8.1):** the target `org_id` is derived from the
  verified `reference → organization` mapping, never from the `Raw_Body`.
- **Mismatch / unresolved → no write (8.2/8.4):** if the org cannot be resolved,
  or a `Raw_Body` org identifier disagrees with the mapped org, the controller
  persists nothing and responds with an error status.
- **All writes org-scoped (8.3):** every billing/event write flows through
  `orgScopedRepo`, which stamps `org_id` and rejects cross-tenant access. Tenant
  isolation and server-derived binding are proven by **Property 4**.

---

## 3. Recorded_Limitations

The following seams are **intentionally left unbound** under the
verify-don't-invent discipline. Each surfaces an explicit
`UnsupportedOperationError` (a `PluginError` subclass) naming the capability and
issues **no** network request (proven by **Property 5**). None of them invent a
MarzPay endpoint.

| Seam | Operation(s) | Behavior while unbound | Source |
|------|--------------|------------------------|--------|
| `paths.disburse` | `disbursements.sendMoney` | Validates required fields, then throws `UnsupportedOperationError`; no network | unverified — no `Verified_Capability` |
| `paths.balance` | `accounts.getBalance` | Throws `UnsupportedOperationError`; no network | unverified — Appendix A mentions Balance only incidentally; no endpoint recorded |
| `paths.phoneVerification.*` | `phoneVerification.verify` / `isVerified` / `getUserInfo` | Validates required fields, then throws `UnsupportedOperationError`; no network | unverified — no `Verified_Capability` |
| `MARZPAY_SPEC.webhook` | webhook signature scheme | `validateWebhook` is fail-closed (always `false`); trust comes from server-side re-verification | **§L4** — signature scheme undocumented |
| `paths.refund` | `refund` (flat compat method) | Throws `UnsupportedOperationError`; no network | **§L5** — no refund creation endpoint documented |

> Note: `disbursements.getStatus(reference)` **is** fully functional — it reads
> the **verified** `GET /transactions/{reference}` endpoint. Only the
> `sendMoney` send path is unbound.

### Design note — no prior dedicated phone validator existed (flagged explicitly)

There was **no existing dedicated phone-validation function** in the plugin prior
to this refinement — only an `isNonEmptyString` channel guard inside
`buildInitializePaymentRequest`. Requirement 11.3 directs the plugin to "reuse the
existing internal phone validation logic and SHALL NOT introduce a new validation
implementation." Because no such validator existed, this refinement introduces
**exactly one** internal helper, `normalizeUgandaMsisdn`, as the **single source
of truth**; both `utils.isValidPhoneNumber` (→ `isValidUgandaMsisdn`) and
`utils.formatPhoneNumber` (→ `formatUgandaMsisdn`) delegate to it. This honors the
intent of Req 11.3 (no scattered/duplicate validation) while making the
discrepancy explicit, as required by the design.

### Binding the unbound seams

Binding `disburse`, `balance`, or `phoneVerification.*` requires **first** adding
audited `Verified_Capability` entries (with citations) for each endpoint to the
research artifact — see
[`docs/integrations/marzpay-research.md` §5](../../../docs/integrations/marzpay-research.md).
Until those entries exist, the seams stay `undefined` and the operations fail fast
with no network request. This is a documented **non-coding prerequisite**; no
endpoint is invented here.

---

## 4. Architecture & quality constraints (verified)

- **Strict TypeScript, no `any` in the public surface** (Req 13.5): `tsc` strict
  passes; the public namespace types use no `any`.
- **Dependency-light** (Req 13.6): runtime uses only `node:https`, `node:crypto`,
  and the `streetjs` peer — no new third-party runtime dependency.
- **No `packages/core` changes** (Req 13.1): the refinement touches only the
  plugin and the CLI overlay templates; `packages/core` is unchanged.
- **Signed plugin architecture preserved** (Req 13.2): the Ed25519-signed manifest
  contract is unchanged by the added namespaces (`manifest.test.mjs` passes).
- **Provenance / SBOM preserved** (Req 13.3) in the publish pipeline.
- **Tenant isolation preserved** (Req 13.4): all writes flow through
  `orgScopedRepo` (Property 4).

---

## 5. Release recommendation

**Ready for release.** Coverage exceeds the 90% branch gate (~97.4%), the full
plugin suite and the CLI SaaS overlay suite are green, all 10 correctness
properties hold, the signed-manifest contract and provenance/SBOM are preserved,
and the security-sensitive webhook path (Req 6/7/8) is verified by both unit and
property-based tests. The only outstanding items are the documented
`Recorded_Limitation`s (unbound `disburse` / `balance` / `phoneVerification.*` /
webhook-signature seams and the refund §L5 limitation), each of which fails fast
with `UnsupportedOperationError` and issues no network request until an audited
`Verified_Capability` is recorded.
