# StreetJS — Readiness Assessment: Is It Ready for Real Developers?

> An honest, evidence-based verdict. No marketing. Claims are tagged **VERIFIED**
> (confirmed with executed evidence), **IMPLEMENTED** (present, not re-run here),
> or **GAP** (missing / unproven). Written against `main` on 2026-06-14.

## Short answer

**Yes — for the right developer, on the right project.** StreetJS is a genuinely
production-grade *engineering* artifact: it builds, its full CI pipeline is green,
it is published to npm, and it ships a deep, signed, dependency-free feature set.

**Not yet — as a default choice for risk-averse teams.** The blockers are not
technical quality; they are *adoption* factors: a near-zero public community, a
single-vendor governance signal, an unconventional data layer, and no verifiable
third-party production usage. These are exactly the things a cautious team checks
before betting a multi-year project on a framework.

So the honest verdict is **conditional readiness**, segmented below.

---

## What is verified (the strong case)

- **It is real and installable.** `streetjs@1.0.7`, `@streetjs/core@1.0.7`
  (compat shim), and `@streetjs/cli@1.0.7` are live on npm with `latest` = 1.0.7. **VERIFIED.**
- **CI is green on main.** The full `street CI/CD` pipeline — core integration
  tests (Node 20 + 22 against live PostgreSQL), CLI + migration tests, memory-leak,
  6 system-test suites, MySQL integration, certification suites, package-integrity
  clean-install smoke — completed **success** on the latest push. **VERIFIED.**
- **Breadth of capability.** Core ships HTTP/router/DI, a native PostgreSQL wire
  driver (no `pg`), MySQL + SQLite drivers, WebSockets/SSE, jobs, auth/RBAC/MFA,
  rate limiting, validation, observability (Prometheus + OTel), multi-tenancy,
  GraphQL, and an AI subsystem. **IMPLEMENTED** (exercised by the green suite).
- **Ecosystem.** **18 official, Ed25519-signed, dependency-free plugins** across
  databases (Postgres, MySQL, MongoDB), messaging (NATS, Kafka, RabbitMQ),
  payments (Stripe, PayPal), identity (Auth0, Clerk, Firebase, Supabase), AI
  (OpenAI), storage (S3, R2), email/SMS (SendGrid, Twilio). Plugin-structure suite
  **217/217, 0 skips. VERIFIED.**
- **Supply-chain security.** Gitleaks + TruffleHog secret scanning,
  dependency-review, SBOM tooling, a provenance gate, and idempotent publish in
  CI. **VERIFIED.**
- **Reference apps.** Five (SaaS, e-commerce, realtime-chat, dating, AI assistant)
  build, smoke-test, and benchmark. **VERIFIED.**
- **Docs.** ~50 guides plus three migration guides (Express/Nest/Fastify), SEO,
  search. **IMPLEMENTED.**

## What is missing or unproven (the honest case)

- **Community is effectively zero. GAP.** No verifiable Discord activity, sparse
  Discussions, no external contributor history. For many teams this is *the*
  deciding factor — when you hit a wall at 2am, who answers?
- **Single-vendor / bus-factor risk. GAP.** Governance docs exist, but there is no
  evidence of multiple active maintainers or an external foundation. A framework
  maintained by effectively one party is a real adoption risk.
- **No third-party production proof. GAP.** The reference apps are first-party.
  There are no independent "running StreetJS in production" case studies.
- **Data-layer ergonomics. GAP vs. competitors.** The query-builder + repository
  is solid but is not a relations/migrations-from-models ORM like Prisma,
  TypeORM, or Eloquent. Teams used to those will feel friction.
- **The 18 plugins are not published to npm yet. GAP.** They are built, signed,
  and unit-tested locally, but `npm install @streetjs/plugin-*` will not work
  until a release. MongoDB's live path also needs a real `mongod` to validate
  end-to-end (its codec/auth are offline-verified against RFC 7677, but the wire
  I/O is not exercised in CI).
- **1.0.7 shipped without provenance. GAP (minor).** It was published manually to
  bypass an npm 2FA token issue; the CI provenance gate now prevents recurrence,
  but the current release lacks the attestation.
- **Compliance is documentation-only. GAP.** No SOC2/HIPAA/ISO/PCI/GDPR
  certification or control-mapping evidence — only aspirational references.
- **Hiring pool is tiny. GAP.** "StreetJS developers" are not a labor market;
  onboarding cost falls entirely on your team.

---

## Ready for whom?

| Profile | Verdict | Why |
|---------|---------|-----|
| Solo devs / side projects / internal tools | **Ready** | Minimal deps, fast scaffolding, strong defaults; small blast radius if you need to pivot |
| Small teams comfortable being early adopters | **Ready, with eyes open** | Excellent engineering; accept that you may be filing (and fixing) issues yourself |
| Teams that value a tiny dependency tree / supply-chain minimalism | **Strong fit** | Two runtime deps; native drivers; signed plugins |
| Mid-size product teams needing a large ecosystem + hiring pool | **Not yet** | Ecosystem breadth exists but third-party depth and labor market do not |
| Risk-averse enterprises / regulated industries | **Not yet** | No compliance evidence, no multi-maintainer guarantee, no production references |

## What would move it to an unqualified "yes"

1. **Publish the 18 plugins** and restore provenance on the next release (CI is ready).
2. **Real community presence** — active Discord/Discussions and ≥2 named maintainers.
3. **Independent production case studies** with reproducible benchmarks.
4. **Compliance control-mapping** docs that point to the existing audit-log,
   RBAC, vault, and retention features.
5. **Data-layer ergonomics** closer to Prisma/Eloquent (relations, model-driven migrations).

These are the items already prioritized in `PLATFORM-LEADERSHIP-ADOPTION-PROGRAM.md`.

---

## Bottom line

StreetJS has crossed the bar of *technical* production-readiness: it is built,
tested, green, published, and feature-complete to a degree most young frameworks
never reach. What it has not yet earned is *social* production-readiness —
community, contributors, and battle-tested third-party usage. If you would enjoy
being an early adopter of a well-engineered framework and can absorb the support
burden yourself, it is ready for you today. If you need the safety of a large
ecosystem, a hiring pool, and proven longevity, wait for the adoption indicators
above to materialize.
