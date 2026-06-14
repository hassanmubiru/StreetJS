# StreetJS — Adoption & Enterprise Readiness Gap-Closure Program

> Execution plan to close the non-engineering gaps (adoption, ecosystem,
> governance, compliance, enterprise trust). Evidence-tagged: **VERIFIED**
> (executed proof), **IMPLEMENTED** (in repo, not re-run here), **PARTIAL**,
> **GAP** (absent). No marketing language; measurable outcomes only.
> Date: 2026-06-14. Core published at v1.0.9; 18 plugins at v1.0.1 (all with provenance).

## Reading guide

Each deliverable lists: current status → concrete actions → **measurable
outcome**. Items marked **[shipped this cycle]** were implemented alongside this
plan; items marked **[needs owner]** require a human/account action code cannot do.

---

## 1. Community Growth Strategy

| Item | Status | Action | Measurable outcome |
|------|--------|--------|--------------------|
| CONTRIBUTING / CoC / templates | IMPLEMENTED | — | n/a |
| `FUNDING.yml` | IMPLEMENTED | enroll GitHub Sponsors | sponsor button live |
| RFC process | **GAP → shipped this cycle** | `rfcs/` + template + lifecycle (see `rfcs/README.md`) | first RFC merged in 30d |
| GitHub Discussions | GAP **[needs owner]** | enable Discussions; seed 5 categories | ≥20 threads/90d |
| Discord | GAP **[needs owner]** | create server (channels/roles below) | ≥100 members/90d |
| good-first-issue program | PARTIAL | label ≥15 issues `good-first-issue` + `help-wanted` | ≥5 external PRs/90d |
| Contributor recognition | GAP | `all-contributors` bot + monthly shout-outs | recognized contributors tracked |

**Discord design:** channels `#announcements #general #help #plugins #contributors
#rfcs #showcase`; roles `Maintainer / Reviewer / Contributor / Community`;
moderation = CoC enforcement ladder (warn → mute → ban) with 2-maintainer review;
support workflow = `#help` triage → escalate confirmed bugs to GitHub issues.

**Contributor ladder (define in GOVERNANCE):**
- **Contributor** — ≥1 merged PR.
- **Reviewer** — ≥10 quality PRs/reviews; may approve (not merge) in an area.
- **Maintainer** — sustained reviewing + merge rights; nominated by 2 maintainers.
- **Core/Steering** — cross-cutting decisions, releases, RFC final-comment calls.

**Outcome targets (90d):** ≥3 external contributors, ≥10 merged community PRs,
Discussions + Discord live.

---

## 2. Enterprise Readiness Program (compliance mappings)

**Status: GAP → control-mapping docs shipped this cycle** in `docs/compliance/`
(SOC 2, HIPAA, GDPR, PCI-DSS). These map StreetJS features to control families
and **honestly list what the framework does NOT provide** (a framework supports
compliance; it cannot *be* compliant — that is the operator's audit).

Verified features the mappings build on:
- Access control: `authMiddleware`, `requireRoles`, `JwtService`, `SessionManager` — **VERIFIED**
- Audit logging: `AuditWriter`, `auditAuthEvent`, `auditPermissionDenied`, `AUDIT_LOG_MIGRATION_SQL` — **VERIFIED**
- Encryption: vault (`encryptSecret`), field-level (`Keyring`/`FieldCipher`), AES-256-GCM sessions — **VERIFIED**
- Privacy: `PrivacyControls`, `RetentionPolicy`, `ConsentDecision` (deletion/retention/consent/export) — **VERIFIED**
- Secrets: `SecretsProvider` (GitHub/AWS/Azure/GCP) + log `redact` — **VERIFIED**

**Missing controls (GAP, documented in the mappings):** formal change-management
policy, independent audit, data-processing agreements, breach-notification
runbook, key-rotation policy doc, access-review cadence. These are
process/paperwork, not code.

**Outcome:** a procurement reviewer can map each requested control to a feature
or a documented compensating control — unblocks enterprise evaluations.

---

## 3. Data Layer Evolution (first-party ORM)

**Status: relations + eager/lazy loading SHIPPED this cycle** as `@streetjs/orm`
0.1.0 (RFC 0001 → Accepted). Implemented + tested: entity/relation decorators,
a safe parameterized query planner, eager loading (1:1/1:N/N:M, batched +
N+1-safe), relation filtering, and lazy loading — **23 offline unit tests + 4
live-PostgreSQL integration tests** (CI: `orm-integration.yml`, green).
**Model-driven migration generation remains the one open sub-item (GAP)** — the
next milestone, building on the existing `MigrationDiffer` + `schema-inspector`.

**Design (incremental, on top of the existing repository):**

```typescript
// 1. Entity + relation decorators (metadata only; no runtime magic)
@Entity('users')
class User {
  @PrimaryKey() id!: number;
  @Column() email!: string;
  @HasMany(() => Post, 'authorId') posts?: Post[];      // one-to-many
  @HasOne(() => Profile, 'userId') profile?: Profile;   // one-to-one
}
@Entity('posts')
class Post {
  @PrimaryKey() id!: number;
  @Column() authorId!: number;
  @BelongsTo(() => User, 'authorId') author?: User;
  @ManyToMany(() => Tag, 'post_tags') tags?: Tag[];     // many-to-many (join table)
}

// 2. Repository gains relation-aware queries (eager vs lazy)
const repo = orm.getRepository(User);
const u = await repo.findOne({ where: { id: 1 }, with: ['posts', 'profile'] }); // eager
const tags = await u.posts[0].$load('tags');            // lazy, on demand
const filtered = await repo.find({ with: { posts: { where: { published: true } } } }); // relation filter

// 3. Model-driven migrations — diff entity metadata vs schema-inspector output
//    `street db:make-migration` → emits up/down SQL from MigrationDiffer.
```

**Architecture:** decorators write to `reflect-metadata`; an `EntityRegistry`
builds a relation graph; the query planner emits parameterized JOINs (eager) or
deferred batched loads (lazy, N+1-safe via dataloader-style batching);
`MigrationDiffer` (exists) compares entity metadata to `schema-inspector` output
to generate migrations. **Effort: large (multi-week); ship behind a
`@streetjs/orm` package so it doesn't destabilize core.** Property-based tests
for the SQL generator + a live-PG integration suite are required before GA.

**Outcome:** closes the #1 head-to-head feature-eval loss vs Prisma/TypeORM.

---

## 4. Ecosystem Expansion

**Plugin certification levels** (define + enforce):

| Level | Bar | Signature | Listed as |
|-------|-----|-----------|-----------|
| **Official** | maintained by core; in this monorepo; CI-tested | official key (VERIFIED) | `@streetjs/plugin-*` |
| **Verified** | 3rd-party; passes structure + security review; signed | verified-publisher key | "Verified" badge |
| **Community** | 3rd-party; manifest well-formed; unreviewed | self-signed | "Community" |

**Marketplace requirements:** manifest verification (reuse
`assertWellFormedManifest`), signature verification (reuse `verifyManifest` +
trust store), automated structure check (reuse `plugin-structure` test shape),
version-compatibility metadata (`engines`/peer `streetjs` range), and a
`street registry` browse/search (the registry server already exists). **PARTIAL**
(infra exists) → **GAP** (public marketplace UI + 3rd-party onboarding).

**Outcome:** ≥5 community plugins listed/90d; a clear trust gradient.

---

## 5. Production Proof Program

**Status: GAP.** Create `docs/case-studies/` with a standard template and
**verification standard**: every claim (latency, throughput, cost, uptime) must
ship a reproducible command + environment description + raw numbers (mirrors the
existing `scripts/benchmark-reference-apps.mjs` discipline). No unverifiable
testimonials.

Collect: case studies, migration stories (Express/Nest/Fastify → StreetJS, using
the existing migration guides), and performance reports gated by the existing
benchmark regression harness.

**Outcome:** ≥3 reproducible case studies/180d; published benchmark vs a peer
framework with the method open-sourced.

---

## 6. Open Source Sustainability

**Funding [needs owner]:** GitHub Sponsors (file present) + Open Collective for
transparent expenses; enterprise support/consulting as the revenue path. Outcome:
funding page live, first sponsor tier defined.

**Governance (extend `GOVERNANCE.md`):** a **steering committee** (odd number,
≥3), the **RFC process** (shipped — `rfcs/`), and **release governance** (semver
+ the tag/main publish pipeline already enforced with provenance + SBOM).
Decision rule: lazy consensus on RFCs, steering vote on ties. **GAP → partially
shipped** (RFC process in; multi-maintainer model needs ≥2 real maintainers
[needs owner]).

---

## 7. Adoption Scorecard (assessed from evidence)

| Area | Current | Target (12mo) | Gap | Basis |
|------|:------:|:------:|:---:|-------|
| Community | 15 | 75 | 60 | no public activity; RFC process now in place |
| Enterprise | 55 | 90 | 35 | strong security; compliance mappings now drafted |
| Ecosystem | 72 | 90 | 18 | 18 official plugins; no 3rd-party yet |
| Governance | 65 | 90 | 25 | full docs + RFC; needs ≥2 maintainers |
| Documentation | 84 | 92 | 8 | broad; needs API-reference search parity |
| Security | 90 | 95 | 5 | provenance, signing, SBOM, CodeQL all green |
| Compliance | 35 | 80 | 45 | mappings drafted; no certification/audit |
| Production proof | 20 | 80 | 60 | reference apps only; no 3rd-party usage |

**Overall adoption readiness: ~52/100 → target 85.** Binding constraints:
community, production proof, compliance evidence (in that order).

---

## 8. Prioritized Roadmap

**Next 30 days (highest ROI, low effort)**
1. **[shipped]** RFC process (`rfcs/`) + compliance mappings (`docs/compliance/`).
2. **[needs owner]** Enable GitHub Discussions + Discord; link from README.
3. Label ≥15 `good-first-issue`; publish a contributor onboarding walkthrough.
4. **[needs owner]** Enroll GitHub Sponsors / Open Collective.
5. Publish the data-layer ORM RFC (design in §3) to gather feedback before building.

**Next 90 days (adoption acceleration)**
1. Recruit ≥2 maintainers; ratify the steering committee + contributor ladder.
2. Ship `@streetjs/orm` MVP (relations + eager loading + model migrations) behind the RFC.
3. Stand up the community-plugin "Verified" tier + review checklist.
4. First reproducible case study + a published peer-framework benchmark.

**Next 180 days (enterprise trust)**
1. Complete compliance mappings into an auditor-ready evidence pack; add the
   missing process docs (change mgmt, key rotation, breach runbook).
2. MongoDB live integration in CI (Mongo service container) — see Technical gaps.
3. LTS branch + published support window.

**Next 365 days (platform leadership)**
1. ≥10 community/verified plugins; active working groups (security, data, realtime).
2. ≥3 production case studies; foundation-style multi-org governance.
3. SOC 2 Type I readiness (operator-side) using the evidence pack.

---

## Technical gaps (tracked, mostly engineering)

- **MongoDB live integration in CI — GAP.** The driver is offline-verified
  (RFC 7677 SCRAM) and was verified locally against a real `mongod` this program;
  add a `mongo:7` service container to a CI job to make it continuous.
- **ORM relations / model migrations — GAP.** See §3.

---

## Constraints honored
Every line is tagged by evidence state; community/production/compliance scored
low precisely because no public signal is verifiable yet; items requiring
external accounts are marked **[needs owner]** rather than claimed as done.
