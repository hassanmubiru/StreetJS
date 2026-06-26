# MarzPay Integration — Release Readiness Report

This report records the verified release readiness of the MarzPay integration
across the StreetJS ecosystem. It is generated per Requirement 15 of the
`marzpay-integration` spec. Each section below records a status of exactly one of
`pass`, `fail`, or `blocked`. The measured branch coverage is recorded as a
numeric percentage, and the overall readiness is derived from the section
statuses and the coverage value per the rules in Requirements 15.5 and 15.6.

| Field | Value |
|-------|-------|
| Report generated for | `@streetjs/plugin-marzpay` + CLI overlays + scaffolded SaaS/frontend code |
| Measured branch coverage | `95.32` |
| Coverage threshold | `90.0` |
| Overall readiness | `ready` |

---

## 1. Architecture

**Status: `pass`**

- MarzPay support ships as the official `@streetjs/plugin-marzpay` package
  (`packages/plugin-marzpay`), mirroring the audited `@streetjs/plugin-paypal`
  pattern: `PluginModule` subclass, dependency-free `MarzPayClient` over
  `node:https`, pure request-builder seams, `manifest.json` +
  `manifest.signed.json` + `manifest.pub`, strict `tsconfig.json`, and a
  `package.json` whose only runtime dependency is `streetjs`.
- TypeScript source compiles under strict configuration with no use of the `any`
  type.
- CLI support is delivered exclusively through additive overlays in
  `packages/cli/src/commands/create.ts` — the `--with-marzpay` SaaS flag and the
  `react` / `next` / `htmx` frontend overlays compose the existing
  `TEMPLATES` / `STARTER_ALIASES` / `FRONTENDS` / `--with-*` mechanisms. No
  separate scaffolding command is introduced.
- `packages/core` is not modified: every runtime capability is provided through
  the plugin, CLI overlays, and scaffolded application code.
- All API-shaped decisions (base addresses, auth scheme, endpoint paths, webhook
  signature scheme) are bound through the single `MARZPAY_SPEC` seam, populated
  only from `Verified_Capability` entries recorded in
  `docs/integrations/marzpay-research.md` (verify-don't-invent). Topics recorded
  as limitations leave their seam unbound and their dependent capability
  unbuilt.

## 2. Security Review

**Status: `pass`**

- Authentication uses the verified MarzPay HTTP Basic auth scheme constructed by
  the plugin from configured credentials; credentials are never logged.
- Inbound webhook trust is established through server-side re-verification before
  any persistence. MarzPay publishes no documented webhook signature scheme;
  this is explicitly recorded as a limitation in the Research_Artifact, and the
  scaffolded `WebhookController` validates via the plugin
  `validateWebhook` operation before creating or updating any billing record,
  rejecting negative results with no write.
- Multi-tenant billing data is isolated by `org_id` through `orgScopedRepo`, so a
  record created for one tenant is never returned to another.
- The plugin manifest is signed (`manifest.signed.json` + `manifest.pub`) and
  verified by the plugin host on load.
- No secrets are written to logs.

## 3. Test Results

**Status: `pass`**

- Plugin suite (Properties 1–7 plus unit, lifecycle, manifest, and webhook
  example tests): 67 tests, 0 failures, 0 skipped, 0 todo.
- CLI MarzPay suite: overlay gating, Properties 8/9/10/11, dashboard access /
  empty-state / unavailable-source rendering, HTMX failure fragment, subscription
  lifecycle, integration flow, and Next smoke build — all passing.
- Marketplace integration test (generator categorization + unlisted exclusion):
  passing.
- Examples startup and missing-env tests (21 tests): passing.
- No test is skipped, pending, or exclusive (Requirement 14.5 satisfied).

## 4. Coverage

**Status: `pass`**

- Measured branch coverage: `95.32` percent.
- Threshold: `90.0` percent (enforced by the c8 `branches: 90` gate in
  `packages/plugin-marzpay/package.json`).
- Command: `npm run coverage -w packages/plugin-marzpay` — exit code 0 (gate
  satisfied; the command exits non-success and reports the measured value when
  coverage falls below 90 percent).
- Scope: branch coverage over the MarzPay integration code (plugin source plus
  the scaffolded billing / checkout / webhook / subscription modules).

## 5. Documentation Status

**Status: `pass`**

- Ten documentation pages authored under `docs/integrations/marzpay/`:
  `getting-started.md`, `payments.md`, `subscriptions.md`, `webhooks.md`,
  `saas-billing.md`, `htmx-example.md`, `react-example.md`, `next-example.md`,
  `deployment.md`, `security.md`.
- Code examples are compile-ready under strict TypeScript with no `any`, contain
  no placeholder tokens (`...`, `TODO`, `FIXME`, `<your-value-here>`), and
  reference only behaviors recorded as a `Verified_Capability` in the
  Research_Artifact.

## 6. Marketplace Status

**Status: `pass`**

- `scripts/gen-plugins-data.mjs` routes the `payments` keyword to the existing
  `Payments` category.
- While `streetjs.unlisted` is `true`, the generator excludes the plugin from the
  marketplace data entry, the `Payments` category listing, and the detail page.
- The integration test (task 20.2) confirms that a listed package produces all
  three artifacts (data entry, `Payments` row, detail page) and that an
  unlisted/private package is excluded from all three.
- The marketplace entry derives its title, description, version, and category
  only from the package `name` / `description` / `version` / `keywords`.

## 7. Starter Status

**Status: `pass`**

- The `--with-marzpay` SaaS overlay scaffolds `BillingService`,
  `CheckoutController`, `WebhookController`, and `SubscriptionService` with gated
  emission: a plain `--starter saas` scaffold adds no MarzPay files or
  dependencies.
- The `react`, `next`, and `htmx` frontend overlays scaffold their respective
  MarzPay files and add the dependency only to the selected frontend's package
  manifest; no MarzPay files or dependencies are emitted when the frontend is not
  selected.
- `packages/core` remains untouched.

---

## Overall Release Readiness

**Overall readiness: `ready`**

Readiness rule (Requirements 15.5 and 15.6):

- Recorded branch coverage is `95.32` percent, which is `>= 90` percent, so the
  `not ready` condition (coverage `< 90`) does not apply.
- Every section status above is `pass`.

Because every section status is `pass` **and** the recorded branch coverage value
is `90` percent or greater, the overall release readiness is recorded as `ready`.
