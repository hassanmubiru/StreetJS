# Content Drafts — ready to post

> Copy-paste-ready social posts derived from the published articles. **Evidence
> rule:** every number here is verifiable in the repo (2 runtime deps; 20+ official
> plugins; MEASURED ~5,700 req/s and ~30 KB/WebSocket from the budget guide;
> provenance + SBOM + OpenSSF). Do not add unverified metrics. Each post links a
> canonical docs URL for indexed referral traffic.

Canonical links:
- Home: https://hassanmubiru.github.io/StreetJS/
- Why 2 deps: https://hassanmubiru.github.io/StreetJS/blog/why-2-dependencies/
- Native PG driver: https://hassanmubiru.github.io/StreetJS/blog/native-postgres-driver/
- Self-hosting cost: https://hassanmubiru.github.io/StreetJS/blog/self-hosting-cost/
- Marketplace: https://hassanmubiru.github.io/StreetJS/plugins/marketplace/
- Starters: https://hassanmubiru.github.io/StreetJS/starters/

---

## X / Twitter

### Thread A — "2 dependencies" (launch angle)
1/ Most Node backends pull in hundreds of transitive packages before you write
any business logic.

StreetJS ships a full TypeScript backend with **two** runtime dependencies.

Here's how (and why it matters) 🧵

2/ The two deps: `reflect-metadata` (DI metadata) and `ws` (WebSocket framing).

Everything else — HTTP, router, DI container, PostgreSQL driver, auth, jobs,
clustering, OpenAPI — is built on Node's standard library.

3/ Why? Every dependency in a framework's core becomes a dependency your app
inherits, transitively, forever. Fewer packages = smaller attack surface, an SBOM
short enough to read, and no version-range roulette.

4/ Example: instead of `pg`, StreetJS speaks PostgreSQL wire protocol v3 over
`node:net` with SCRAM-SHA-256 — parameterized queries, injection-safe by
construction, no native bindings to compile.

5/ The tradeoff is honest: maintainers own protocol code others delegate. It's
covered by wire-protocol, fuzz, load and chaos suites in CI. A deliberate,
defended design choice.

6/ Read the full write-up 👇
https://hassanmubiru.github.io/StreetJS/blog/why-2-dependencies/

`npx @streetjs/cli create my-app`  · MIT · TypeScript · Node 20+

### Single posts (schedule across the week)
- Native PostgreSQL, no `pg`: wire protocol v3 over `node:net` + SCRAM-SHA-256.
  No native bindings. Parameterized, injection-safe by construction.
  https://hassanmubiru.github.io/StreetJS/blog/native-postgres-driver/

- Auth, realtime, jobs and a DB driver run in-process in StreetJS — so one small
  VPS can replace several managed bills. Measured: ~5,700 req/s, ~30 KB/WebSocket.
  https://hassanmubiru.github.io/StreetJS/blog/self-hosting-cost/

- 20+ official StreetJS plugins — signed, dependency-free: Postgres, MySQL,
  Mongo, Redis, Kafka, S3/R2, Stripe, OpenAI and more. Browse the marketplace:
  https://hassanmubiru.github.io/StreetJS/plugins/marketplace/

- Scaffold a typed SaaS backend in one command:
  `npx @streetjs/cli create my-app --starter saas`
  Auth, RBAC, audit log + a multi-tenant schema migration.
  https://hassanmubiru.github.io/StreetJS/starters/

### Release post (v1.0.22)
StreetJS 1.0.22 is out 🚀
`street create --starter saas|ai|realtime|marketplace` now scaffolds real schema
migrations + architecture docs. Published with provenance + SBOM.
https://hassanmubiru.github.io/StreetJS/starters/

---

## LinkedIn — build-in-public

I've been building **StreetJS**, an integrated TypeScript backend framework, in
the open — and this week I want to share one design decision that shapes
everything: it ships with **two runtime dependencies**.

Most Node backends inherit hundreds of transitive packages. For a framework's
*core*, every dependency becomes one your users inherit forever. So StreetJS
implements the hard parts directly on Node's standard library:

• Native PostgreSQL driver (wire protocol v3 + SCRAM-SHA-256) — no `pg`
• HTTP, router, DI container, WebSockets, jobs, clustering, OpenAPI — built in
• 20+ official plugins, all signed and dependency-free

What it buys teams:
• Smaller attack surface + an SBOM you can actually read
• No native bindings to compile
• Lower total cost of ownership — auth/realtime/jobs run in-process, so one small
  VPS can replace several managed services (measured: ~5,700 req/s, ~30 KB per
  WebSocket connection)

The honest tradeoff: we maintain protocol code other frameworks delegate — backed
by wire-protocol, fuzz, load and chaos tests in CI.

Full write-up: https://hassanmubiru.github.io/StreetJS/blog/why-2-dependencies/
MIT-licensed, released with npm provenance. Feedback welcome 👇

#TypeScript #NodeJS #BackendDevelopment #OpenSource #SaaS

---

## Reddit (r/node, r/typescript) — Show & Tell

**Title:** I built a TypeScript backend framework with 2 runtime dependencies
(native Postgres driver, no Express/pg/Prisma)

**Body:**
StreetJS implements the parts most frameworks delegate — PostgreSQL wire protocol
v3 over `node:net` with SCRAM-SHA-256, an HTTP server/router, a DI container,
WebSockets, a Postgres-backed job queue, and OpenAPI — directly on Node core. The
result is a full backend with two runtime deps (`reflect-metadata`, `ws`).

It's MIT, released with npm provenance + SBOM, and has 20+ signed, dependency-free
official plugins (Stripe, Redis, S3, Kafka, OpenAI, …).

Not claiming it's for everyone — the tradeoff is that we maintain protocol code
others outsource. Curious what this community thinks of the dependency-minimalism
approach. Docs + benchmarks (measured, reproducible): https://hassanmubiru.github.io/StreetJS/

*(Follow subreddit self-promotion rules; lead with the technical discussion, not the pitch.)*

---

## Dev.to / Hashnode / Medium

Cross-post the three published articles. Set the **canonical URL** on each
cross-post to the docs blog URL so the docs page keeps the SEO authority:

| Article | Canonical URL |
|---|---|
| Why StreetJS has two runtime dependencies | …/blog/why-2-dependencies/ |
| Talking to PostgreSQL without the `pg` package | …/blog/native-postgres-driver/ |
| Self-hosting a full backend on one small VPS | …/blog/self-hosting-cost/ |

Tags: `typescript`, `node`, `backend`, `webdev`, `opensource`.
Repurpose order: 1 article → 1 LinkedIn post → 5 X posts → 1 Reddit thread.
