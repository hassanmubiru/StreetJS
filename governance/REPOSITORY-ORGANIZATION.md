# StreetJS Repository Organization

> Canonical repository structure, the rationale, and how it compares to mature
> framework repos. Evidence-based against the current tree.

## Current structure (VERIFIED, post-reorganization)

```
streetJS/
├── packages/            # 49 packages (21 plugin-*, core, cli, frontend, verticals)
├── docs/                # documentation site + reference
├── examples/  demos/    # 13 examples, 4 demos
├── benchmarks/  rfcs/    # perf harness, design proposals
├── scripts/             # build/release/codegen/cloud/observability scripts
├── infra/               # NEW — consolidated infrastructure
│   ├── docker/          #   Dockerfile + compose/ (six docker-compose*.yml)
│   ├── kubernetes/      #   k8s manifests (HPA example, probes)
│   ├── helm/street/     #   Helm chart
│   ├── examples/        #   aws-ecs, cloud-run, cloudflare, vercel
│   └── monitoring/      #   prometheus rules + grafana dashboards
├── security/            # NEW — audits, reviews, threat models, runbooks, classification
├── audits/              # NEW — point-in-time reports
├── governance/          # NEW — CHARTER + this doc
├── plans/               # NEW — internal strategy/roadmap (INTERNAL tier)
├── .github/  .githooks/ # CI, CODEOWNERS, templates, hooks
└── README LICENSE SECURITY GOVERNANCE MAINTAINERS CONTRIBUTING CODE_OF_CONDUCT CHANGELOG CITATION
```

Root tracked `.md` files reduced **45 → 7** (front-door set only).

## Comparison to mature framework repos (item 6)

| Concern | NestJS | Fastify | Next.js | Laravel | Kubernetes | **StreetJS (target)** |
|---|---|---|---|---|---|---|
| Lean root (metadata only) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (achieved: 7 root `.md`) |
| `packages/` workspace | ✅ | partial | ✅ | n/a (`src/`) | n/a | ✅ |
| `docs/` | ✅ | ✅ | ✅ | (separate repo) | ✅ | ✅ |
| `examples/` | ✅ (`sample/`) | ✅ | ✅ | n/a | ✅ | ✅ |
| Dockerfile at root | ✅ | n/a | ✅ | ✅ | n/a | moved to `infra/docker/` (Phase 2) |
| docker-compose at root | common | n/a | n/a | ✅ (`docker-compose.yml`) | n/a | moved to `infra/docker/compose/` (Phase 2) |
| `.github/` CI + CODEOWNERS | ✅ | ✅ | ✅ | ✅ | ✅ (`OWNERS`) | ✅ |
| Dedicated security/ + governance/ | partial (`SECURITY.md`) | `SECURITY.md` | `SECURITY.md` | `SECURITY.md` | ✅ (`SECURITY*.md`, `sig-*`) | ✅ (`security/`, `governance/`) |
| Infra under one dir | varies | n/a | n/a | n/a | ✅ (`cluster/`, `build/`) | ✅ (`infra/`) |
| Internal strategy NOT in public root | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (`plans/`, recommend private repo) |

**Conclusion:** StreetJS now matches the reference-repo convention. The notable
StreetJS-specific addition is the dedicated `security/`, `audits/`, `governance/`
split — heavier than most frameworks because StreetJS ships a signed-plugin trust
model that warrants explicit security governance. In Phase 2, `Dockerfile` +
`docker-compose*.yml` were moved into `infra/docker/` (+ `compose/`) per explicit
request: the compose files now reference repo-root paths via `../../../`
(build `context: ../../..`, `dockerfile: infra/docker/Dockerfile`, init volumes),
validated with `docker compose config`; all script/CI callers and the ~5 named-file
doc references were updated. (Note: this is a deliberate departure from the
Next.js/Laravel root-compose convention, chosen for a single consolidated `infra/`.)

## Item 5 — package-level infra assets

- **VERIFIED:** the only Dockerfile inside `packages/` is
  `packages/registry-server/Dockerfile`. **RECOMMENDATION: KEEP.** `registry-server`
  is a deployable service; its Dockerfile uses `docker build packages/registry-server`
  as its documented build context and is exercised by `scripts/registry/e2e.mjs`.
  Co-locating a service's Dockerfile with the service is standard monorepo practice
  (matches Kubernetes' per-component Dockerfiles). Moving it would break the
  documented build and the E2E harness for no organizational gain.
- **VERIFIED:** no other `Dockerfile`/`docker-compose`/`*.tf`/`k8s`/`helm` assets
  exist inside any package. No plugin ships deployment assets.

## Migration status

| Move | Status |
|---|---|
| strategy/roadmap → `plans/` | ✅ done (18) |
| completed reports → `audits/` | ✅ done (8) |
| security docs → `security/` | ✅ done (12 + this + classification) |
| Charter + org policy → `governance/` | ✅ done |
| `deploy/` → `infra/{kubernetes,helm,examples}` | ✅ done (+ refs updated) |
| `observability/` → `infra/monitoring/` | ✅ done (+ refs updated) |
| feature docs → `docs/`, smoke script → `scripts/` | ✅ done |
| `sbom.json`/`release-inputs.json` untracked | ✅ done |
| SEO files → website repo | ⏳ operator (`git rm` after they exist there) |
| `Dockerfile`/`docker-compose*.yml` | ✅ moved to `infra/docker/` (+ `compose/`); refs updated; `docker compose config` validated |

## Breaking-change analysis

| Change | Breaking? | Mitigation |
|---|---|---|
| `deploy/` → `infra/` | Internal only — no published package path | All script/CI/doc-data refs updated + statically validated; run `deploy-verify` to confirm |
| `observability/` → `infra/monitoring/` | Internal only | `emit-assets.mjs`/`validate.mjs`/workflow filters updated; run `observability` to confirm |
| Root doc relocation | Link-only | Cross-folder links fixed; external deep-links to old root doc paths would 404 — add redirects or accept |
| Untrack `sbom.json`/`release-inputs.json` | Consumers reading them from the repo | Generate in CI + attach to releases |
| **No `packages/**` runtime path changed** | **None** | Framework/plugin imports unaffected (no package moved/renamed) |

No published npm package, import path, or public API changed — all moves are
repo-internal organization. Risk of breakage is limited to CI/docs and is covered
by the updated references + the `repository-policy.yml` gate.
