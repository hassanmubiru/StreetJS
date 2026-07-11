# StreetJS — Architecture Overview

A single entry point for understanding how StreetJS is organized and which
packages a consumer actually needs. For deeper design rationale see
[`docs/architecture-report.md`](docs/architecture-report.md) and the
[Architecture Decision Records](docs/architecture-decision-records/).

---

## Core principle: a minimal, curated dependency footprint

`streetjs` (the core package) ships with a **minimal, curated dependency set** —
**3 direct runtime dependencies** (`reflect-metadata`, `ws`, `zod`), each with
**zero transitive dependencies** (6 resolved packages total). The heavy lifting —
HTTP, routing, the database wire protocols (PostgreSQL, MySQL, SQLite), transports
(Redis/RESP, Kafka, NATS, RabbitMQ), crypto, and plugin loading — is implemented
against Node's standard library, so the graph stays tiny by design. For comparison,
the footprint benchmark (`scripts/benchmark-footprint.mjs`) measures 6 resolved
packages for `streetjs` vs 17 (Elysia), 21 (NestJS), 49 (Fastify), and 67 (Express).
This small, auditable trust surface is the framework's defining property, paired
with a supply chain that is verifiable end-to-end (npm provenance + cosign
signatures + signed plugin manifests).

> **Note:** earlier docs described the core as "dependency-free." That was
> inaccurate — the core carries the three curated, zero-transitive dependencies
> above. The accurate claim is *minimal, curated dependencies*, not zero.

Integrations that genuinely need a third-party account (Stripe, Twilio, Auth0,
etc.) are shipped as **optional plugins**, never pulled into the core.

---

## The lockstep core line (install this)

| Package | Role |
|---------|------|
| `streetjs` | The framework. This is what applications depend on. |
| `@streetjs/core` | **Deprecated** compat shim that re-exports `streetjs` unchanged (kept for the pre-rename install path; slated for removal in 2.0). |
| `@streetjs/cli` | The `street` command (scaffold, generate, migrate, dev/build, doctor, verify, …). |

These three are released together in lockstep at the same version.

---

## Package map (54 published packages)

**Core line (3)** — `streetjs`, `@streetjs/core`, `@streetjs/cli`.

**Runtime / platform capabilities** — install as needed:
- `@streetjs/gateway` — API gateway (routing, retry, circuit breaking, rate limiting).
- `@streetjs/events` — event bus / pub-sub primitives.
- `@streetjs/queue` — background job queue.
- `@streetjs/workflow` — durable workflow orchestration.
- `@streetjs/realtime` — typed channels + websocket gateways.
- `@streetjs/storage` — object-storage abstraction + drivers.
- `@streetjs/edge` — edge/serverless runtime surface.
- `@streetjs/orm` — relational mapping over the core wire clients.
- `@streetjs/devtools` — developer tooling / diagnostics.
- `@streetjs/registry-server` — the Network Plugin Registry server.

**Vertical domains** — opinionated, ready-made feature packages:
- Commerce/knowledge: `@streetjs/admin`, `@streetjs/ai`, `@streetjs/commerce`, `@streetjs/search`.
- Dating: `@streetjs/dating-auth`, `@streetjs/dating-messaging`, `@streetjs/dating-moderation`, `@streetjs/dating-profiles`.
- Social: `@streetjs/social-comments`, `@streetjs/social-feed`, `@streetjs/social-notifications`, `@streetjs/social-users`.

**UI / framework adapters:**
- `@streetjs/client`, `@streetjs/react`, `@streetjs/vue`, `@streetjs/next`, `@streetjs/nuxt`.
- Domain UIs: `@streetjs/admin-ui`, `@streetjs/ai-ui`, `@streetjs/auth-ui`.

**Official plugins (21, signed manifests)** — connect external services:
- Data/transport: `plugin-postgres`, `plugin-mysql`, `plugin-mongodb`, `plugin-redis`,
  `plugin-kafka`, `plugin-nats`, `plugin-rabbitmq`.
- Storage: `plugin-s3`, `plugin-r2`.
- Identity: `plugin-auth0`, `plugin-clerk`, `plugin-firebase`, `plugin-supabase`.
- Payments/comms: `plugin-stripe`, `plugin-paypal`, `plugin-twilio`, `plugin-sendgrid`,
  `plugin-africastalking`, `plugin-marzpay`.
- AI/UI: `plugin-openai`, `plugin-htmx`.

---

## "Which package do I need?"

- **A typical API/app:** `streetjs` + `@streetjs/cli` (scaffold with `street create`).
- **Add a database/broker:** the matching `plugin-*` (e.g. `plugin-postgres`,
  `plugin-redis`). The core wire clients exist in `streetjs`; plugins package them
  as signed, registry-installable units.
- **Add a hosted integration:** the matching `plugin-*` (Stripe, Auth0, …).
- **Realtime / queues / workflows / gateway:** the corresponding capability package.
- **A whole vertical (dating, social, commerce):** the vertical package + its UI.

Start minimal; add packages only when a feature requires one.

---

## Extension model

Plugins extend the `PluginModule` contract from the core SDK. Each official plugin
ships a **signed manifest** (`manifest.signed.json`) verified against the project's
signing anchor at install/verify time. The Network Plugin Registry
(`@streetjs/registry-server`) provides a publish→install path with the same
verification. Third-party plugins follow the same signed-manifest contract.

---

## Testing & coverage locality (for contributors)

Most packages carry their own `node:test` suites (`npm test -w <pkg>`). A few
notes so coverage locality is not misread:

- The **HTTP plugins** (`plugin-auth0`, `plugin-r2`, `plugin-s3`, `plugin-sendgrid`,
  `plugin-stripe`, `plugin-twilio`) each ship a small offline **contract test**
  (`test/contract.test.mjs`: exports, manifest, config-validation). Their deeper
  request-building logic is additionally exercised centrally by the core hardening
  suite and by `npm run test:plugins-offline`.
- `@streetjs/core` (the compat shim) is generated and intentionally has no test
  script of its own.
- A registry **subpath-import gate** (`scripts/verify-registry-subpaths.mjs`,
  `.github/workflows/registry-subpath-import.yml`) installs every published package
  from npm and imports every `exports` subpath, guarding against packaging/exports
  regressions.

---

## Release & supply chain

The core line publishes with **npm provenance (SLSA)**; release tarballs are
**cosign-signed** (bundle format) and attached to the GitHub Release with an SBOM.
Backend/vertical packages publish via `publish-backend.yml`, also with provenance.
See [`CHANGELOG.md`](CHANGELOG.md) and the audit under `docs/audits/` for the
current certification state.
