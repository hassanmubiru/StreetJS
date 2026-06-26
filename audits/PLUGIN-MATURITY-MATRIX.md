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
| stripe | ✅ | ✅ | ◑ | ⬜ verifier missing | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| paypal | ✅ | ✅ | ◑ | ⬜ | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| sendgrid | ✅ | ✅ | ◑ | ⬜ event verify | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| twilio | ✅ | ✅ | ◑ | ⬜ X-Twilio-Sig | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| openai | ✅ | ✅ | ◑ | N-A | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| auth0 | ✅ | ✅ | ◑ | N-A | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| clerk | ✅ | ✅ | ◑ | N-A | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| firebase | ✅ | ✅ | ◑ | N-A | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| supabase | ✅ | ✅ | ◑ | N-A | ⬜ | ⬜ | ✅ | N-A | ◑ | ◑ |
| s3 / r2 | ✅ | ✅ | ◑ | N-A | ◑ adapter | ⬜ | ✅ | N-A | ◑ | ◑ |
| mongodb | ✅ | ✅ | ◑ | N-A | ✅ | N-A | ✅ | N-A | ◑ | ◑ |
| postgres / mysql | ✅ | ✅ | ◑ | N-A | ✅ pool | N-A | ✅ | N-A | ◑ | ◑ |
| redis | ✅ | ✅ | ◑ | N-A | ✅ | N-A | ✅ | N-A | ◑ | ◑ |
| kafka / rabbitmq / nats | ✅ | ✅ | ◑ | N-A | ✅ connect | N-A | ✅ | N-A | ◑ | ◑ |

## Documentation & security review
- **Documentation:** ✅ all 21 ship `README.md` + `SECURITY.md`.
- **Security review:** ✅ all covered in `security/PLUGIN-SECURITY-AUDIT.md`; marzpay has a dedicated `security/MARZPAY-SECURITY-REVIEW.md`.
- **Code safety:** ✅ 0 `eval`/`Function`/`child_process`/`exec`/`any` across all plugin source.

## Maturity tiers
- **Reference (Enterprise-ready):** marzpay, htmx.
- **Solid:** africastalking, DB/messaging plugins (timeouts present), s3/r2.
- **Needs hardening for enterprise:** the `node:https` HTTP plugins (stripe, paypal,
  twilio, sendgrid, openai, auth0, clerk, firebase, supabase) — add outbound timeouts
  and (where the provider signs) webhook verifiers.

## Top cross-plugin actions (runtime change, tracked separately)
1. Outbound timeout on the 9 HTTP plugins.
2. Webhook verifiers: stripe, twilio, paypal, sendgrid.
3. Per-plugin example apps + raised coverage gates to promote ◑ → ✅.
