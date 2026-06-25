# MarzPay StreetJS Plugin — Gap Analysis

> **Deliverable:** Requirements 12.8 and 15.6 of the `marzpay-scope-alignment` spec.
>
> This document enumerates every intentional exclusion declared in **Requirement 12
> (Intentional Exclusions)** together with its rationale, and states the approximate
> share of practical backend value the plugin provides relative to the full
> `marzpay-js` SDK.

## Purpose

The `@streetjs/plugin-marzpay` plugin is a deliberately scoped, backend-only
integration. It is **not** a port of the full `marzpay-js` SDK. To keep the plugin
lightweight, secure, and focused on server-side payment workflows, several SDK
surfaces are intentionally omitted. Each omission below is a deliberate design
decision with a recorded rationale, so the scope boundary against full `marzpay-js`
parity is defensible rather than accidental.

## Coverage Statement

The plugin targets **approximately 70–80% of the practical backend value** of the
full `marzpay-js` SDK while remaining **substantially simpler**. It concentrates on
the operations a StreetJS backend actually needs — money collection, disbursement,
transaction lookup, account balance, phone verification, webhook verification, and
the SaaS billing overlay — and omits SDK-management, browser, administrative, and
unverified surfaces. The remaining ~20–30% (administrative dashboards, browser
distribution, full reporting/history parity, and operations against undocumented
endpoints) is intentionally out of scope.

## Intentional Exclusions (Requirement 12)

Each row corresponds to an acceptance criterion in Requirement 12 of
`requirements.md`. The plugin **does not** provide the listed surface.

### 12.1 — SDK credential-management operations

**Excluded:** Runtime credential mutation such as `setCredentials(...)`.

**Rationale:** Credentials are supplied through validated plugin configuration read
from environment variables, not mutated at runtime. Removing a runtime credential
setter keeps the credential lifecycle in one validated, auditable place and avoids a
mutable-secret surface inside the request path.

### 12.2 — Browser SDK artifacts

**Excluded:** UMD bundles, minified browser builds, browser-only tooling, and CDN
distributions.

**Rationale:** StreetJS is a backend framework and this plugin is a `node:https`
server-side client. There is no supported browser execution context, so shipping
browser artifacts would add weight and a misleading usage path with no benefit.

### 12.3 — Account-administration operations

**Excluded:** Operations such as `updateAccountSettings(...)`.

**Rationale:** Account administration belongs in the MarzPay dashboard, not in a
backend integration plugin. Keeping administration out of the plugin preserves a
clear trust boundary and avoids embedding privileged mutation in application code.

### 12.4 — Webhook-administration operations

**Excluded:** `registerWebhook(...)`, `deleteWebhook(...)`, and `testWebhook(...)`.

**Rationale:** Webhook endpoints are configured per-application via `callback_url`,
and administration of those endpoints sits outside the plugin's trust boundary. The
plugin's responsibility is to **verify** inbound webhooks, not to provision or
manage them.

### 12.5 — Full SDK utility surface as public API

**Excluded:** Public exposure of the full SDK utility surface, such as
`generateReference(...)`, `parseAmount(...)`, and `formatAmount(...)`, as public
API. (A helper may exist internally where required, but remains unexported.)

**Rationale:** The plugin exposes only utilities that fit backend workflows. The
public `utils` namespace is limited to `formatPhoneNumber` and `isValidPhoneNumber`;
general-purpose SDK helpers are not part of the supported surface, keeping the public
API small and intentional.

### 12.6 — Full `marzpay-js` parity

**Excluded:** Complete `marzpay-js` parity across account, reporting, history, and
administrative endpoints.

**Rationale:** The plugin targets ~70–80% of practical backend value while remaining
substantially simpler than the full SDK. Exhaustive parity across reporting,
history, and admin endpoints would multiply the surface area and maintenance burden
without serving the core backend payment, billing, and verification workflows the
plugin is built for.

### 12.7 — Refund against an invented endpoint

**Excluded:** A refund operation implemented against an invented endpoint.

**Rationale:** MarzPay documents no refund creation endpoint
(Research_Artifact §L5), so refunds remain a **Recorded_Limitation**. Per the
verify-don't-invent discipline (Requirement 1), the refund seam is left unbound;
invoking it raises an explicit unsupported-operation error naming the capability and
issues **zero** network requests rather than calling a fabricated endpoint.

## What IS Provided vs Excluded

To make the boundary concrete, the table below contrasts the supported surface with
the intentional exclusions.

| Provided (in scope) | Excluded (out of scope) |
|---|---|
| `collections` namespace — collect money, status | SDK credential mutation (`setCredentials`) — 12.1 |
| `disbursements` namespace — send money, status | Browser SDK artifacts / UMD / CDN — 12.2 |
| `transactions` namespace — transaction lookup | Account administration (`updateAccountSettings`) — 12.3 |
| `accounts` namespace — account balance | Webhook administration (`registerWebhook` / `deleteWebhook` / `testWebhook`) — 12.4 |
| `phoneVerification` namespace — verify, isVerified, getUserInfo | Full SDK utility surface as public API (`generateReference` / `parseAmount` / `formatAmount`) — 12.5 |
| `utils` namespace — `formatPhoneNumber`, `isValidPhoneNumber` | Full `marzpay-js` parity (account / reporting / history / admin) — 12.6 |
| Webhook **verification** + SaaS billing overlay | Refund against an invented endpoint (Recorded_Limitation §L5) — 12.7 |

The six supported namespaces — `collections`, `disbursements`, `transactions`,
`accounts`, `phoneVerification`, and `utils` — represent the practical backend value
the plugin delivers. Seams whose endpoints are not recorded as Verified_Capabilities
(for example refund, and any unverified disbursement/balance/verification paths)
remain unbound and surface explicit unsupported-operation errors until verified,
consistent with the verify-don't-invent discipline.

## Summary

Every exclusion above is deliberate and recorded. Together they define a defensible
scope boundary: the plugin delivers ~70–80% of the practical backend value of the
full `marzpay-js` SDK — focused on payments, disbursements, transactions, balances,
phone verification, webhook verification, and billing — while staying lightweight,
secure, dependency-light, and substantially simpler than the full SDK.
