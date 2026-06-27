# StreetJS Official Plugin Maturity Matrix

> Maturity of every official `@streetjs/plugin-*`. Legend: ✅ yes · ◑ partial ·
> ⬜ no/gap · N-A. Sourced from `security/PLUGIN-SECURITY-AUDIT.md`,
> `audits/PLUGIN-SECURITY-REPORT.md`, and direct inspection. All 21 are **signed**
> (manifest matches official anchor) and ship README + manifest + SECURITY.md + LICENSE.

| Plugin | Prod-ready | Signed/Provenance | Tests/Cov | Webhook verify | Timeout | Retry | Input valid. | Multi-tenant | Example | Enterprise-ready |
|---|---|---|---|---|---|---|---|---|---|---|
| marzpay | ✅ | ✅ | ✅ ~97% | ◑ fail-closed+re-verify | ✅ | ⬜ (by design) | ✅ | ✅ overlay | ✅ marzpay-react/next | ✅ |
| africastalking | ✅ | ✅ | ◑ | ◑ shared-secret | ✅ | ✅ | ✅ | ◑ | ◑ | ◑ |
| htmx | ✅ | ✅ | ◑ | N-A | N-A | N-A | ✅ escape | N-A | ✅ app-htmx | ✅ |
| stripe | ✅ | ✅ | ◑ | ✅ HMAC-SHA256 (`verifyStripeWebhook`) | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| paypal | ✅ | ✅ | ◑ | ✅ RSA-SHA256 (`verifyPayPalWebhook`, local cert) | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| sendgrid | ✅ | ✅ | ◑ | ✅ ECDSA event (`verifySendGridWebhook`) | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| twilio | ✅ | ✅ | ◑ | ✅ HMAC-SHA1 (`verifyTwilioSignature`) | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| openai | ✅ | ✅ | ◑ | N-A | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| auth0 | ✅ | ✅ | ◑ | N-A | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| clerk | ✅ | ✅ | ◑ | N-A | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| firebase | ✅ | ✅ | ◑ | N-A | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| supabase | ✅ | ✅ | ◑ | N-A | ✅ `timeoutMs` | ⬜ | ✅ | N-A | ◑ | ◑ |
| s3 / r2 | ✅ | ✅ | ◑ | N-A | ◑ adapter | ⬜ | ✅ | N-A | ◑ | ◑ |
| mongodb | ✅ | ✅ | ◑ | N-A | ✅ | N-A | ✅ + ✅ TLS | N-A | ◑ | ◑ |
| postgres / mysql | ✅ | ✅ | ◑ | N-A | ✅ pool | N-A | ✅ | N-A | ◑ | ◑ |
| redis | ✅ | ✅ | ◑ | N-A | ✅ | N-A | ✅ + ✅ TLS | N-A | ◑ | ◑ |
| kafka / rabbitmq / nats | ✅ | ✅ | ◑ | N-A | ✅ connect | N-A | ✅ + ✅ TLS | N-A | ◑ | ◑ |

> **Example column:** ◑ = a runnable `example/index.mjs` ships in the plugin
> package (present for 20/21 packages; offline where a live server isn't assumed)
> and is syntax-checked in CI via `npm run test:plugins-offline`. ✅ = a full
> standalone example application (marzpay → `examples/marzpay-react|next`; htmx →
> `examples/scaffold-*`). Promoting ◑→✅ requires a standalone app per plugin.
> + **rabbitmq** (AMQPS) + **nats** (STARTTLS) all expose `tls` /
> `tlsRejectUnauthorized` / `tlsServerName` / `tlsCa` (default plain TCP). redis,
> mongodb, kafka, rabbitmq use connect-from-start TLS; nats performs the protocol
> STARTTLS upgrade after the plaintext `INFO`. Config validation is unit-tested;
> the TLS handshakes are exercised in integration when a TLS endpoint is available.

## Documentation & security review
- **Documentation:** ✅ all 21 ship `README.md` + `SECURITY.md`.
- **Security review:** ✅ all covered in `security/PLUGIN-SECURITY-AUDIT.md`; marzpay has a dedicated `security/MARZPAY-SECURITY-REVIEW.md`.
- **Code safety:** ✅ 0 `eval`/`Function`/`child_process`/`exec`/`any` across all plugin source.

## Maturity tiers
- **Reference (Enterprise-ready):** marzpay, htmx.
- **Solid:** africastalking, DB/messaging plugins (timeouts present; redis+mongodb
  add opt-in TLS), s3/r2.
- **Hardened (timeouts shipped; webhook verifiers where the provider signs):** the
  `node:https` HTTP plugins now all enforce outbound `timeoutMs`; stripe + twilio
  ship constant-time webhook verifiers. Remaining to reach ✅ enterprise-ready:
  per-plugin example apps, raised coverage gates, and the paypal/sendgrid verifiers.

## Top cross-plugin actions (runtime change, tracked separately)
1. ✅ **Done** — outbound timeout on all 9 HTTP plugins (`timeoutMs`, default 30s).
2. ✅ **Done** — webhook verifiers: stripe + twilio + sendgrid (ECDSA) + paypal (local cert).
3. ◑ **In progress** — per-plugin example apps + raised coverage gates to promote ◑ → ✅.
