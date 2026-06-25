# StreetJS Security Roadmap

> Prioritized remediation plan from `SECURITY-AUDIT-2026.md`, grouped by effort.
> Goal: reach an enterprise-ready posture **without** adding runtime dependencies
> (stay at 3: `reflect-metadata`, `ws`, `zod`). Every item is non-core-breaking
> where possible; secure-by-default changes that alter behavior are called out.

Severity → finding map is in the audit. Ordering within each tier is by ROI (trust gain ÷ effort).

---

## Quick wins (< 1 day each)

| # | Finding | Action | Notes |
|---|---------|--------|-------|
| 1 | **F-A1** | Make cookie flags **secure-by-default** in `setCookie` (`HttpOnly`, `Secure` in prod, `SameSite=Lax`) unless overridden | Behavior change — gate `Secure` on `NODE_ENV=production`; document. |
| 2 | **F-R2** | Add an `allowedOrigins` option to the WS server; reject mismatched `Origin` at upgrade (default same-origin) | Closes CSWSH; uses `node:url` only. |
| 3 | **F-R1** | Emit a loud startup warning when a WS server is created without `authFn` in production | Nudge to secure default without breaking dev. |
| 4 | **F-P3** | Validate the plugin manifest with a **Zod** schema before `register()` | Reuses existing `zod` dep. |
| 5 | **F-P4** | Deep-freeze/clone the manifest at `register()`; use the frozen copy at `enable()` | Kills the TOCTOU reference mutation. |
| 6 | **F-A2** | `setCookie` appends to `Set-Cookie` (array) instead of overwriting | Bug + security-adjacent. |
| 7 | **F-PAY4** | Ship the `stripe_events(event_id PRIMARY KEY, processed_at)` migration with `--with-billing` | Makes Stripe idempotency real out of the box. |
| 8 | **F-P5 / F-P2 (doc)** | Document the plugin trust model: "signed = trusted, NOT sandboxed; verify before load" | Honest posture; prevents misuse. |

---

## Medium improvements (< 1 week each)

| # | Finding | Action | Notes |
|---|---------|--------|-------|
| 9 | **F-P1** | Default `PluginHost` to `officialPluginPublicKey()`; require explicit opt-out for unsigned/dev hosts; warn when verification is off | Closes the default-open plugin gap. |
| 10 | **F-PAY1 / F-PAY2** | Add `reference`-keyed idempotency + replay guard to the MarzPay overlay (mirror Stripe's `ProcessedEventStore`, inside the insert tx) + migration | Prevents duplicate-credit before settlement is enabled. |
| 11 | **F-R5** | Add an authorization callback to `ChannelHub.join`/`publish`; bind `memberId` to the `authFn` identity rather than client input | Stops channel impersonation. |
| 12 | **F-R1 (full)** | First-class `auth` option that gates **and attaches the authenticated identity** to `StreetSocket` | Makes per-connection authz possible. |
| 13 | **F-R4** | Optional per-event **Zod** schema validation for inbound WS frames (parity with HTTP `@Validate`) | Reuses `zod`. |
| 14 | **F-R3** | Per-IP WS upgrade rate limiting (reuse the core `RateLimiter`) | Bounds connection-flood DoS. |
| 15 | **F-PAY5** | Derive webhook tenant from the **verified** transaction/customer; validate against the mapped org; document webhook route wiring | Removes cross-tenant write risk. |
| 16 | **F-AI1** | Dedicated AI review: tool allowlist + per-tool authz, no secrets in prompts/logs, output/rate bounds, retrieval sanitization | Closes the unverified AI surface. |
| 17 | **F-ORM1** | Property-based SQL-injection sweep across query builder + repository as a CI gate | Regression-proofs parameterization. |

---

## Major initiatives (< 1 month each)

| # | Finding | Action | Notes |
|---|---------|--------|-------|
| 18 | **F-A3** | Optional server-side session store with **revocation** + a `rotate()` helper (call on login/privilege change) | Keeps stateless default; adds enterprise revocation. |
| 19 | **F-P2 (real isolation)** | `worker_threads`/`vm`-based runner for **untrusted** plugins with enforced net/fs/db/secrets boundaries | Turns declarative perms into real confinement. |
| 20 | **F-SC1** | Plugin-signing **key rotation** policy + `manifest.pub` distribution; evaluate **Sigstore keyless** for plugins | Removes single-key blast radius. |
| 21 | **F-CI1** | Onboard a 2nd maintainer; document a 2-person security disclosure/response rota + SLA | Organizational; unblocks incident response. |
| 22 | **Independent review** | Commission an external security review + pen-test of core + auth + multi-tenant isolation; publish the summary | The highest enterprise-trust unlock. |

---

## Sequencing

1. **Week 1 — Quick wins (1–8):** ship secure-by-default cookies, WS origin/auth-warning, manifest Zod+freeze, Stripe migration, trust-model docs. Highest trust-per-hour; mostly non-breaking.
2. **Weeks 2–4 — Medium (9–17):** default-verify plugins, MarzPay idempotency, channel authz + identity propagation, WS validation + rate limiting, webhook tenant binding, AI review, ORM sweep.
3. **Months 2–3 — Major (18–22):** session revocation, real plugin isolation, key rotation/keyless, second maintainer + response rota, external review.

## Guardrails

- **No new runtime dependencies** — reuse `zod`/`node:crypto`/`RateLimiter`.
- **Secure-by-default, escape-hatch-explicit** — defaults tighten; opt-outs are explicit and documented.
- **No claim without evidence** — each shipped fix lands with a test (property test where a security invariant exists) and updates the scorecard.
- **Don't break tenant isolation or the dependency-light promise.**
