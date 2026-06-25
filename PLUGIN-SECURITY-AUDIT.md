# StreetJS Official Plugin Security Audit

Status: Analysis only — no plugin code was modified.
Scope: All official packages under `packages/` that are plugins or shared
provider modules: `plugin-marzpay`, `plugin-htmx`, `plugin-stripe`,
`plugin-paypal`, `plugin-redis`, `plugin-kafka`, `plugin-rabbitmq`,
`plugin-mongodb`, `plugin-mysql`, `plugin-postgres`, `plugin-nats`,
`plugin-openai`, `plugin-sendgrid`, `plugin-twilio`, `plugin-auth0`,
`plugin-clerk`, `plugin-firebase`, `plugin-supabase`, `plugin-africastalking`,
`plugin-r2`, `plugin-s3`, plus the `search` and `storage` modules.

Method: Each plugin's `src/` was read directly. Six plugins (`stripe`,
`sendgrid`, `twilio`, `auth0`, `s3`, `r2`) are thin re-export wrappers; their
canonical implementations live in
`packages/core/src/platform/plugins/official/*.ts` and were audited there.

## Controls assessed

For each plugin the following controls are marked **Present / Partial / Absent /
N-A**, with file/symbol evidence:

1. **No secrets logged** — no logging of apiKey/secret/token/authorization.
2. **Webhook signature verification** — for providers that send webhooks.
3. **Replay protection / idempotency** — idempotency keys or processed-event store.
4. **Outbound timeout** — hard timeout on outbound network calls.
5. **Bounded retries** — retry caps / backoff.
6. **SSRF protection / host allow-listing** — for plugins with user/config-influenced hosts.
7. **Credential handling** — config/env only, not runtime-mutable.

A repo-wide search for SSRF defenses (`allowlist`, `169.254`, `metadata`,
host pinning) found **no explicit allow-listing anywhere**. This is recorded as
a cross-cutting gap; per-plugin it is marked Absent (where a configurable host
exists) or N-A (where the host is hardcoded to the provider).

---

## Ranked summary table

| Plugin | Category | Key controls present | Key gaps | Risk |
|---|---|---|---|---|
| plugin-stripe | Payments | No-secret-logging; config-only creds; resource `..` guard | No outbound timeout; **no webhook signature verify** (Stripe sends webhooks & offers a scheme); no retries | **High** |
| plugin-paypal | Payments | No-secret-logging; config-only creds; amount/currency regex guards | No outbound timeout; **no webhook signature verify**; no retries | **High** |
| plugin-marzpay | Payments + inbound webhook | No-secret-logging; outbound timeout; defensive parse; path percent-encoding; fail-closed `validateWebhook`; verify-don't-invent seams; config-only creds | No cryptographic webhook scheme exists (provider gap) — trust relies on app-side re-verification; no idempotency; no retries | **High** |
| plugin-africastalking | Payments (mobile money/B2C) + SMS + callback | No-secret-logging (explicit); **timeout (AbortController)**; **bounded retry + backoff**; callback verify helper (shared-secret); config-only creds | Callbacks unsigned by provider (shared-secret only); no idempotency; configurable nothing-but-env host (N-A) | **High** |
| plugin-auth0 | Identity | No-secret-logging; config-only creds; domain normalized | No outbound timeout; configurable `domain` host not allow-listed | **Medium-High** |
| plugin-clerk | Identity | No-secret-logging; config-only creds; `baseUrl` https-only; userId guard | No outbound timeout; `baseUrl` not allow-listed (SSRF surface) | **Medium-High** |
| plugin-firebase | Identity/Auth | No-secret-logging; config-only creds; email/password guards; hardcoded host | No outbound timeout; no webhook verify (N-A here) | **Medium-High** |
| plugin-supabase | Data API (service-role key) | No-secret-logging; config-only creds; `url` https-only; table-name guard | No outbound timeout; `url` host not allow-listed | **Medium-High** |
| plugin-twilio | SMS (spend) | No-secret-logging; config-only creds; hardcoded host | No outbound timeout; **no webhook signature verify** (Twilio signs webhooks); no retries | **Medium** |
| plugin-sendgrid | Email | No-secret-logging; config-only creds; hardcoded host | No outbound timeout; no webhook (event) verify; no retries | **Medium** |
| plugin-openai | AI (cost) | No-secret-logging; config-only creds; `baseUrl` https-only; ReDoS-safe parsing | No outbound timeout; `baseUrl` not allow-listed | **Medium** |
| plugin-s3 | Object storage | No-secret-logging; config-only creds; deterministic SigV4; key encoding | Host derived from bucket/region (no allow-list); transport via adapter | **Medium** |
| plugin-r2 | Object storage | No-secret-logging; config-only creds; deterministic SigV4; key encoding | Host derived from accountId (no allow-list) | **Medium** |
| storage (module) | Storage service | **Signed URLs (HMAC + timingSafeEqual + expiry)**; path-traversal guard; upload size cap; scan/transform hooks | Provider hosts (azure/gcs) configurable, not allow-listed; elastic-style retries N-A | **Medium** |
| plugin-mongodb | DB driver | No-secret-logging; **SCRAM-SHA-256 + server-signature verify**; connect/command timeout; config-only creds | No TLS in client (plaintext); host not allow-listed | **Medium** |
| plugin-postgres | DB driver | No-secret-logging; SCRAM via core `PgPool`; timeouts via pool; config-only creds | No TLS option surfaced; host not allow-listed | **Medium** |
| plugin-mysql | DB driver | No-secret-logging; config-only creds; timeouts via pool; core driver refuses cleartext over non-TLS | No TLS option surfaced; host not allow-listed | **Medium** |
| plugin-redis | Cache | No-secret-logging; **connect + command timeout**; config-only creds | AUTH over plaintext (no TLS); host not allow-listed | **Medium** |
| plugin-kafka | Messaging | No-secret-logging; connect timeout; config-only creds | No TLS/SASL surfaced; brokers not allow-listed | **Medium** |
| plugin-rabbitmq | Messaging | No-secret-logging; connect timeout + heartbeat; config-only creds; DLX support | No TLS surfaced; host not allow-listed | **Medium** |
| plugin-nats | Messaging | No-secret-logging; connect/flush timeout; subject validation; config-only creds | `tls_required: false` (plaintext); host not allow-listed | **Medium** |
| plugin-htmx | Views/HTML | Auto HTML-escaping; CSRF field helper; bounded partial depth; `viewsDir`-rooted reads | Raw `{{{ }}}` interpolation (by design); partial-name regex permits `..`/`/` (template-author trust); has a dedicated CI signing workflow | **Low-Medium** |
| search (module) | Search | Parameterized SQL (PG provider); FTS `config` identifier validated; limit clamping | Meili/Elastic provider `host` configurable, not allow-listed; elastic per-request timeout absent | **Low** |

---

## Per-plugin findings

### plugin-stripe (High)
Canonical impl: `packages/core/src/platform/plugins/official/stripe.ts`.
- No secrets logged — **Present** (no `console`/logger anywhere; verified by repo-wide grep).
- Webhook signature verify — **Absent**. Stripe sends webhooks and ships an HMAC
  scheme (`Stripe-Signature`), but the plugin offers no `constructEvent`/verify helper.
- Replay/idempotency — **Absent** (no idempotency-key support on `post`/`buildRequest`).
- Outbound timeout — **Absent** (`httpsRequest` with no `setTimeout`/destroy, `StripeClient.post`).
- Bounded retries — **Absent**.
- SSRF/allow-list — **N-A** (host hardcoded `api.stripe.com`); resource guarded against `..`.
- Credential handling — **Present** (`private readonly config`; `apiKey` from config only).
Recommendations: add a `constructEvent(rawBody, sig, secret)` HMAC verifier with
`timingSafeEqual`; add a `setTimeout`+`destroy` budget; allow an idempotency-key header.

### plugin-paypal (High)
`packages/plugin-paypal/src/index.ts`.
- No secrets logged — **Present**. Credentials/amount/currency validated (`validatePayPalConfig`, regex guards in `buildCreateOrderRequest`).
- Webhook signature verify — **Absent** (PayPal offers webhook verification; none here).
- Replay/idempotency — **Absent** (PayPal supports `PayPal-Request-Id`; not surfaced).
- Outbound timeout — **Absent** (`PayPalClient.send`, raw `httpsRequest`).
- Bounded retries — **Absent**.
- SSRF/allow-list — **N-A** (host fixed by `baseUrl(environment)`).
- Credential handling — **Present** (config-only).
Recommendations: add timeout + `PayPal-Request-Id` idempotency support; add a webhook verifier.

### plugin-marzpay (High)
`packages/plugin-marzpay/src/index.ts` (2077 lines; the most rigorously built plugin).
- No secrets logged — **Present**. Basic-auth header built in `MARZPAY_SPEC.authHeaders`; never logged or thrown.
- Webhook signature verify — **Partial / verify-don't-invent**. `verifyWebhookSignature`
  is a correct scheme-parameterized HMAC with `timingSafeEqual` + equal-length guard,
  but `MARZPAY_SPEC.webhook` is intentionally **unbound** because MarzPay documents
  no signature scheme (Research_Artifact §L4). `validateWebhook` is therefore
  **fail-closed**: it returns `false` for absent/empty/malformed material and has
  no positive path against an undocumented scheme. Trust is expected to come from
  documented server-side re-verification (re-fetching the transaction), composed by
  the app/`WebhookController`, not the plugin. This is the correct posture given
  the provider gap, but the residual risk (an attacker forging a callback that the
  app trusts without re-verification) is real and inherent to MarzPay.
- Replay/idempotency — **Absent** in the plugin (client `reference` is caller-supplied; no processed-event store).
- Outbound timeout — **Present** (`defaultMarzPayTransport`: `setTimeout` + `req.destroy()`, default 30s).
- Bounded retries — **Absent** (single attempt; reasonable for payments to avoid double-charge).
- SSRF/allow-list — **N-A** (single hardcoded base `https://wallet.wearemarz.com/api/v1`; path segments percent-encoded in `verifyPayment`/`getTransaction` to prevent path/query injection).
- Credential handling — **Present** (validated in `validateMarzPayConfig`, stored `private readonly`, defaults applied once).
Recommendations: document the mandatory app-side re-verification trust path
prominently; add an optional processed-`reference` idempotency guard helper; if
MarzPay ever publishes a signing scheme, bind `MARZPAY_SPEC.webhook`.

### plugin-africastalking (High)
`packages/plugin-africastalking/src/{types,sms,mobile-money,voice,airtime,ussd,plugin}.ts`.
- No secrets logged — **Present** (explicit design in `types.ts`: "No credential is ever logged or thrown"; `AfricaTalkingError` never carries secrets).
- Webhook/callback verify — **Partial**. `verifyMobileMoneyCallback` checks an
  optional shared secret (`expectedSecret`/`providedSecret`); AT callbacks are
  unsigned, so trust is HTTPS + shared secret. No HMAC available from provider.
- Replay/idempotency — **Absent**.
- Outbound timeout — **Present** (`execute()` uses `AbortController` + `setTimeout`, default 15s).
- Bounded retries — **Present** (`retries` default 2, exponential backoff `2**attempt*200`, only on 429/5xx/network).
- SSRF/allow-list — **N-A** (hosts derived from fixed `baseUrl(host, sandbox)` map).
- Credential handling — **Present** (`validateAfricaTalkingConfig`; `apiKey` header only).
This is the reference-quality transport. Recommendations: add idempotency keys for
B2C payouts; document that callbacks need a strong shared secret + HTTPS.

### plugin-auth0 (Medium-High)
`packages/core/src/platform/plugins/official/auth0.ts`.
- No secrets logged — **Present**; `clientSecret` only in JSON token body.
- Webhook verify — **N-A** (outbound client-credentials only).
- Outbound timeout — **Absent** (`Auth0Client.getToken`, raw `httpsRequest`).
- Bounded retries — **Absent**.
- SSRF/allow-list — **Absent**. `domain` is config-influenced and becomes the
  request host (`https://${domain}/oauth/token`); normalized but not allow-listed.
- Credential handling — **Present** (config-only).
Recommendations: add timeout; consider validating `domain` against `*.auth0.com`/
custom-domain expectations.

### plugin-clerk (Medium-High)
`packages/plugin-clerk/src/index.ts`.
- No secrets logged — **Present**; `secretKey` bearer only.
- Outbound timeout — **Absent** (`ClerkClient.send`).
- SSRF/allow-list — **Absent**. `baseUrl` configurable; validated https-only
  (`/^https:\/\//`) but not host-restricted.
- Input guards — `assertUserId` rejects whitespace/slash.
- Credential handling — **Present** (config-only).
Recommendations: add timeout; default-deny non-`api.clerk.com` hosts or document the SSRF surface.

### plugin-firebase (Medium-High)
`packages/plugin-firebase/src/index.ts`.
- No secrets logged — **Present**; Web API key in query param (`encodeURIComponent`).
- Outbound timeout — **Absent** (`FirebaseAuthClient.send`).
- SSRF/allow-list — **N-A** (host fixed `identitytoolkit.googleapis.com`).
- Input guards — linear, ReDoS-safe `assertEmail`; password length checks.
- Credential handling — **Present** (config-only).
Recommendations: add timeout.

### plugin-supabase (Medium-High)
`packages/plugin-supabase/src/index.ts`.
- No secrets logged — **Present**; `apiKey`/service-role key as `apikey` + bearer.
- Outbound timeout — **Absent** (`SupabaseClient.send`).
- SSRF/allow-list — **Absent**; `url` configurable (https-only validated).
- Input guards — `assertTable` restricts to identifier charset; PostgREST filters pass-through (operator strings) — note potential for over-broad queries with the service-role key.
- Credential handling — **Present** (config-only).
Recommendations: add timeout; warn against using the service-role key in request-path code; consider restricting filter operators.

### plugin-twilio (Medium)
`packages/core/src/platform/plugins/official/twilio.ts`.
- No secrets logged — **Present**; Basic auth from `accountSid:authToken`.
- Webhook verify — **Absent** (Twilio signs request webhooks with `X-Twilio-Signature`; no verifier shipped).
- Outbound timeout — **Absent** (`TwilioClient.send`).
- SSRF/allow-list — **N-A** (host fixed `api.twilio.com`; `accountSid` path-encoded).
- Credential handling — **Present**.
Recommendations: add a `X-Twilio-Signature` verifier and an outbound timeout.

### plugin-sendgrid (Medium)
`packages/core/src/platform/plugins/official/sendgrid.ts`.
- No secrets logged — **Present**; bearer key only.
- Webhook (Event Webhook) verify — **Absent** (SendGrid offers ECDSA signed event webhooks; none here).
- Outbound timeout — **Absent** (`SendGridClient.send`).
- SSRF/allow-list — **N-A** (host fixed `api.sendgrid.com`).
- Credential handling — **Present**.
Recommendations: add timeout; offer an Event Webhook signature verifier.

### plugin-openai (Medium)
`packages/plugin-openai/src/index.ts`.
- No secrets logged — **Present**; bearer key + optional org header.
- Outbound timeout — **Absent** (`OpenAiClient.send`).
- SSRF/allow-list — **Absent**; `baseUrl` configurable, https-only validated, not host-restricted (supports Azure/gateways by design).
- ReDoS-safe `stripTrailingSlashes`.
- Credential handling — **Present**.
Recommendations: add timeout (LLM calls are long-lived — make it generous but bounded); document the `baseUrl` SSRF tradeoff.

### plugin-s3 / plugin-r2 (Medium)
`packages/core/src/platform/plugins/official/{s3,r2}.ts`.
- No secrets logged — **Present**; `secretAccessKey` only used by SigV4 signer.
- SigV4 — deterministic, offline-verifiable; object keys percent-encoded per segment.
- Outbound timeout — **Unverified — needs manual review** (transport delegated to the core `S3StorageAdapter`/signer; not inspected here).
- SSRF/allow-list — **Absent/N-A**; host derived from `bucket`+`region` (S3) or `accountId` (R2), not externally arbitrary but not pinned.
- Credential handling — **Present** (config-only).
Recommendations: confirm the core adapter enforces a request timeout; consider an endpoint allow-list for non-AWS S3-compatible overrides.

### storage (module) (Medium)
`packages/storage/src/{index,internal,azure,gcs,pg}.ts`.
- Signed URLs — **Present & strong**: `UrlSigner` HMAC-SHA-256 over `op:key:expiry`,
  verified with `timingSafeEqual` + expiry check (`UrlSigner.verify`) — resists
  replay for a different object/op and after expiry; secret length enforced (≥16).
- Path traversal — **Present**: `LocalStorageProvider.resolve` + `validateKey` reject traversal.
- Upload limits / scan / transform hooks — **Present** (`StorageService.upload`).
- Azure/GCS providers — credentials are constructor options held privately; not logged.
  `endpoint` configurable, not allow-listed.
- Outbound timeout/retry on azure/gcs/elastic-style — **Absent** for azure/gcs fetch calls.
Recommendations: add timeouts to azure/gcs fetches; allow-list/validate `endpoint`.

### plugin-mongodb (Medium)
`packages/plugin-mongodb/src/{index,scram,bson,opmsg}.ts`.
- No secrets logged — **Present**.
- Auth — **Present**: SCRAM-SHA-256 with server-signature verification
  (`verifyServerSignature`, `MongoClient.authenticate`); RFC 7677 vectors referenced.
- Outbound timeout — **Present** (`connect`/`runCommand` use socket `setTimeout` + command timer, default 10s).
- TLS — **Absent** (plaintext `node:net` socket; credentials sent over SCRAM but no transport encryption).
- SSRF/allow-list — **N-A/Absent** (host is operator config).
- Credential handling — **Present** (config-only).
Recommendations: add an optional TLS socket; document plaintext default.

### plugin-postgres / plugin-mysql (Medium)
`packages/plugin-{postgres,mysql}/src/index.ts` (wrap core `PgPool`/`MysqlPool`).
- No secrets logged — **Present**; config-only creds; password explicitly validated.
- Auth — Postgres uses SCRAM-SHA-256 (per core); MySQL core driver refuses cleartext
  over a non-TLS link (noted in `ci-cd.yml`).
- Timeouts — **Present** via pool options (`connectTimeoutMs`/`acquireTimeoutMs`/`idleTimeoutMs`).
- TLS — **Unverified — needs manual review** (no TLS option surfaced in the plugin config; core pool behavior not inspected here).
- SSRF/allow-list — **N-A** (operator-configured host).
Recommendations: surface a TLS/sslmode option; document transport security.

### plugin-redis (Medium)
`packages/plugin-redis/src/index.ts`.
- No secrets logged — **Present**; `password` used only in `AUTH`.
- Timeout — **Present** (`sock.setTimeout` on connect; per-command `setTimeout`, default 5s).
- TLS — **Absent** (plaintext; AUTH password crosses the wire unencrypted without TLS).
- Parser — bounded incremental RESP2 parser.
- Credential handling — **Present**.
Recommendations: add a TLS option; document plaintext AUTH risk.

### plugin-kafka / plugin-rabbitmq / plugin-nats (Medium)
`packages/plugin-{kafka,rabbitmq,nats}/src/index.ts`.
- No secrets logged — **Present** (NATS token/user/pass in CONNECT frame, never logged; RabbitMQ/Kafka creds via core options).
- Timeout — **Present** (`connectTimeoutMs` for kafka/rabbitmq; connect/flush timeout for nats; rabbitmq heartbeat).
- TLS/SASL — **Absent/Unverified**: NATS explicitly sends `tls_required: false`;
  kafka/rabbitmq surface no TLS/SASL option in the plugin config.
- Input validation — NATS validates subjects (`isValidSubject`, no whitespace/NUL); Kafka validates `host:port` brokers.
- Credential handling — **Present** (config-only; user/pass enforced as a pair).
Recommendations: add TLS (and SASL for Kafka) options; flip NATS to support TLS.

### plugin-htmx (Low-Medium)
`packages/plugin-htmx/src/{index,htmx,view-engine}.ts`.
- No secrets — **N-A** (no credentials; permission set is `['middleware']` only).
- XSS — **Partial/by-design**: `{{ }}` auto-escapes via `escapeHtml`; `{{{ }}}` is
  intentionally raw (documented). `csrfField` escapes name/value.
- Template path safety — **Partial**: `ViewEngine.read` joins under `viewsDir`, but
  the partial-name regex `[\w./-]+` and `view()/partial()` `name` args permit `..`
  and `/`. Page/partial names are normally developer-controlled, but a controller
  that forwards a user-supplied template name could traverse outside `viewsDir`.
- Bounded recursion — **Present** (`MAX_PARTIAL_DEPTH = 16`).
- CI signing — htmx has a **dedicated** one-shot workflow (`.github/workflows/sign-htmx.yml`).
Recommendations: reject `..`/absolute segments in `read`/partial names; document that
`{{{ }}}` and developer-supplied template names must never take untrusted input.

### search (module) (Low)
`packages/search/src/{index,internal,meili,elastic}.ts`.
- SQL injection — **Present** mitigation: `PgSearchProvider` uses parameterized
  queries; the only interpolated identifier (`config`) is validated against
  `^[a-z_][a-z0-9_]*$`.
- Meili/Elastic providers — `host` configurable, **not allow-listed** (SSRF surface);
  `apiKey`/Basic creds held privately, not logged.
- Timeout — Meili has `taskTimeoutMs`; Elastic per-request timeout **Absent**.
- Input clamping — limits/offsets clamped (`clamp`, `MAX_LIMIT`).
Recommendations: add a request timeout to the Elastic provider; validate/allow-list provider `host`.

---

## Cross-cutting findings

1. **No explicit SSRF host allow-listing anywhere.** A repo-wide search for
   `allowlist`/`169.254`/`metadata`/host pinning returned nothing. Plugins that
   accept a configurable base URL or endpoint — `openai` (`baseUrl`), `clerk`
   (`baseUrl`), `supabase` (`url`), `auth0` (`domain`), `search` meili/elastic
   (`host`), `storage` azure/gcs (`endpoint`) — validate only the scheme
   (https-only at best) and never restrict the host. If any of these values can be
   influenced by untrusted input, they are SSRF vectors (including cloud metadata
   endpoints). Hardcoded-host plugins (stripe/paypal/twilio/sendgrid/firebase/marzpay)
   are not affected.

2. **Inconsistent timeout/retry conventions.** Three different stances coexist:
   - Best: `plugin-africastalking` (AbortController timeout + bounded retry/backoff)
     and `plugin-marzpay` (timeout + destroy, deliberately no retry).
   - DB/messaging plugins consistently expose `*TimeoutMs` config and enforce it.
   - The `node:https` outbound HTTP plugins — **stripe, paypal, twilio, sendgrid,
     auth0, clerk, firebase, supabase, openai** — set **no timeout at all** and no
     retries. A hung TLS connection can pin a request indefinitely. This is the most
     widespread concrete gap.

3. **No webhook signature verification on providers that sign webhooks.** Stripe,
   PayPal, Twilio, and SendGrid all publish webhook signing schemes, but none of the
   corresponding plugins ship a verifier. MarzPay and Africa's Talking lack a
   provider scheme entirely and correctly fall back to fail-closed / shared-secret
   postures. The asymmetry (capable providers with no verifier shipped) is the
   higher-priority gap.

4. **No idempotency/replay protection in any payment plugin.** Stripe
   (`Idempotency-Key`) and PayPal (`PayPal-Request-Id`) support idempotency keys;
   neither plugin surfaces them. MarzPay/AT rely on caller-supplied `reference`.

5. **Plaintext transport defaults for DB/messaging.** redis, mongodb, nats (explicit
   `tls_required: false`), kafka, and rabbitmq connect over plaintext `node:net`
   with no TLS option in plugin config; credentials (AUTH/SCRAM/CONNECT) cross the
   wire without transport encryption unless the network is otherwise secured.

6. **Signing is centralized, not htmx-only.** Contrary to the "only htmx has a CI
   signing workflow" framing: `publish-plugins.yml` Ed25519-signs **every** plugin
   with the official `STREET_PLUGIN_SIGNING_KEY` at publish, and all 21 plugins
   already carry a committed `manifest.signed.json`. htmx additionally has a
   **dedicated one-shot** workflow (`sign-htmx.yml`) because it was historically the
   last plugin without a committed signed manifest. The repo also signs release
   tarballs with cosign/Sigstore (`ci-cd.yml`). (`search` and `storage` are modules,
   not signed plugins — no manifest.)

7. **Consistently good practices** worth preserving: no plugin logs secrets (grep
   for `console`/`logger` in `packages/plugin-*/src` returned nothing); all store
   credentials as `private readonly` config set once at install (not runtime-mutable);
   validators throw `PluginError` naming the offending field before any client is
   injected; several use ReDoS-safe string handling and per-segment percent-encoding.

---

## Recommendations

### Immediate (7 days)
- Add an outbound request timeout (`setTimeout` + `req.destroy()`/`AbortController`)
  to every `node:https` HTTP plugin: **stripe, paypal, twilio, sendgrid, auth0,
  clerk, firebase, supabase, openai**. This is a small, uniform, high-value change.
- Ship webhook signature verifiers for **stripe** (`Stripe-Signature`) and **twilio**
  (`X-Twilio-Signature`), reusing the `timingSafeEqual` pattern already in
  `plugin-marzpay`/`storage`.
- Document the mandatory app-side re-verification trust path for **marzpay** and
  **africastalking** callbacks (provider has no signature scheme).

### Medium (30 days)
- Add webhook/event verifiers for **paypal** and **sendgrid**.
- Surface idempotency keys in **stripe** (`Idempotency-Key`) and **paypal**
  (`PayPal-Request-Id`); add an optional processed-`reference` guard for marzpay/AT.
- Introduce an optional host allow-list / validator for configurable-host plugins
  (**openai, clerk, supabase, auth0, search, storage**); at minimum block
  link-local/metadata ranges (`169.254.0.0/16`, `metadata.google.internal`).
- Add request timeouts to the **search** Elastic provider and **storage** azure/gcs fetches.

### Long (90 days)
- Add TLS (and SASL where relevant) options to **redis, mongodb, nats, kafka,
  rabbitmq, postgres, mysql**; default to TLS where the provider supports it.
- Establish a shared outbound-HTTP helper (timeout + bounded retry + SSRF guard +
  secret-safe errors) modeled on `plugin-africastalking/src/types.ts:execute`, and
  refactor the HTTP plugins onto it to remove the per-plugin inconsistency.
- Harden the **htmx** view engine to reject `..`/absolute path segments in template
  and partial names, and document the raw-interpolation / template-name trust boundary.
- Add a recurring property-based test suite for signature verifiers and signed-URL
  replay to lock in the constant-time/expiry guarantees.

---

## Verification notes
- Items marked **Unverified — needs manual review**: outbound timeout in the core
  `S3StorageAdapter` (used by plugin-s3/r2) and TLS behavior of the core
  `PgPool`/`MysqlPool` — these live outside the audited plugin `src/` and were not
  inspected.
- All other markings are backed by the cited file/symbol evidence above.
