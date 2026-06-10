# Implementation Plan: Platform Leadership Gaps

## Overview

This plan converts the design into incremental, code-only steps under the spec's zero-trust evidence standard. The work is sequenced so the **Verification Artifact subsystem** (status engine, schema/validator, CommandRunner, generic runner) is built first because every capability area depends on it to emit machine-readable evidence. Foundational pieces precede dependents: lazy DB initialization precedes cloud verification, exported metrics precede observability dashboards, and the **Platform Leadership Exit-Criteria aggregator + final CI aggregation job** are built last.

Implementation language is **TypeScript** (per the design). `@streetjs/core` stays zero-runtime-dependency: all pure logic (status engine, schema validators, exit aggregator, signing helpers, codemods, pagination, semver/notes, metric-reference guard) lives in core using only Node core modules; anything needing third-party deps lives in separate packages (`registry-server`, `devtools`, `plugin-*`, release renderer).

Every capability area produces its machine-readable Verification Artifact through the `CommandRunner` and wires a GitHub Actions job that uploads it via `actions/upload-artifact`.

Two test layers are kept distinct, mirroring the design's Testing Strategy:
- **Layer A** — offline property/unit tests (fast-check, min 100 runs) that validate the pure decision logic. These never raise a capability to VERIFIED.
- **Layer B** — real-infrastructure integration tests (real containers/brokers/clusters/targets) invoked through `CommandRunner`. These are the only basis for VERIFIED. When infrastructure or credentials are absent, the verifier records an honest **BLOCKED** with the specific missing prerequisite (never a mock, never PARTIAL/VERIFIED) while still running and recording offline-verifiable artifacts.

Each property-based test is tagged with the comment format:
`// Feature: platform-leadership-gaps, Property {number}: {property_text}`

## Tasks

- [ ] 1. Verification Artifact subsystem (foundation — built first)
  - [-] 1.1 Implement the status engine and shared types
    - Create `packages/core/src/verification/status.ts` with `VerificationStatus`, `EvidenceComponents`, `BlockedReason`, `ClassifyInput`, and `classify()` honoring precedence NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL (pure, Node-core only)
    - _Design: Verification Artifact subsystem → Status engine_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.9_

  - [~] 1.2 Write property test for status classification
    - **Property 1: Status classification is deterministic and honors precedence** (fast-check, min 100 runs) — built first)
  - [ ] 1.1 Implement the status engine and shared types
    - Create `packages/core/src/verification/status.ts` with `VerificationStatus`, `EvidenceComponents`, `BlockedReason`, `ClassifyInput`, and `classify()` honoring precedence NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL (pure, Node-core only)
    - _Design: Verification Artifact subsystem → Status engine_
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 1.9_

    - Use a `ClassifyInput` generator spanning `hasSourceCode`, all four evidence flags, `blocked`, `commandExitCode` (zero and non-zero), and `timedOut`
    - **Validates: Requirements 1.2, 1.3, 1.4, 1.6, 1.9, 1.10**

  - [-] 1.3 Implement the artifact schema and validator
    - Create `packages/core/src/verification/artifact.ts` with `VerificationArtifact`, `validateArtifact()` enforcing the JSON Schema (required fields, BLOCKED ⇒ `blockedReason`), and the `generator` field that marks artifacts as command-produced
    - _Design: Verification Artifact subsystem → Artifact schema + validator; Data Models → Verification Artifact_
    - _Requirements: 1.7, 1.8_

  - [~] 1.4 Implement the CommandRunner (spawn + 300s timeout + atomic write)
    - Create `packages/core/src/verification/runner.ts` using only `node:child_process`/`node:fs`/`node:crypto`; enforce the 300s default timeout (SIGKILL on overrun ⇒ `timedOut`), run prerequisite probes, call `classify()`, and write the artifact atomically (`*.tmp-<pid>-<rand>` then `rename()`); on write failure throw, remove the temp file, and propagate a non-zero exit leaving no partial artifact
    - _Design: Verification Artifact subsystem → Command runner; Architecture → Artifact directory layout (atomic writes)_
    - _Requirements: 1.7, 1.9, 1.10, 1.11_

  - [~] 1.5 Write property test for BLOCKED prerequisite preservation
    - **Property 2: BLOCKED preserves the missing prerequisite** (fast-check, min 100 runs)
    - **Validates: Requirements 1.5, 1.10**

  - [~] 1.6 Write property test for artifact completeness and atomic writes
    - **Property 3: Produced artifacts are complete and atomically written** (fast-check, min 100 runs; include induced write-failure points asserting no partial/leftover temp file)
    - **Validates: Requirements 1.7, 1.11**

  - [~] 1.7 Write unit tests for runner process behavior and status enum
    - Assert the four-status enum membership (1.1) and that `CommandRunner` kills a sleeping command at a small injected timeout (1.10 process side)
    - _Requirements: 1.1, 1.10_

  - [~] 1.8 Implement the generic capability runner and `street verify <capabilityId>` CLI
    - Create `scripts/verification/run.mjs` and the `street verify <capabilityId>` CLI command that drive `CommandRunner`, plus the `verification-artifacts/<area>/` output layout
    - _Design: Verification Artifact subsystem (CLI surface); package layout (`scripts/verification/run.mjs`)_
    - _Requirements: 1.7_

- [~] 2. Checkpoint - verification foundation
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 3. Lazy database initialization (foundational for cloud bootstrap)
  - [~] 3.1 Implement `DB_INIT_MODE` and lazy bootstrap
    - Change `packages/core/src/main.ts` `bootstrap()` to support `lazy` (default for cloud), `eager`, and `provisioned`; in `lazy` register `PgPool` without calling `initialize()`, and add an idempotent `pool.ensureInitialized()` guard so first acquire/query warms up on demand
    - _Design: Architecture → Lazy database initialization (Requirement 2.12)_
    - _Requirements: 2.12_

  - [~] 3.2 Distinguish liveness from DB-readiness in health endpoints
    - Update health handlers so `/health/live` never depends on the DB and `/health/ready` treats the DB as a declared provisioned dependency (up when no DB expected, down only when configured-but-unreachable), serving both 200 within 5s and completing startup within 30s with no provisioned PostgreSQL
    - _Design: Architecture → Lazy database initialization_
    - _Requirements: 2.12_

  - [~] 3.3 Write integration test for no-DB bootstrap
    - Start the app with no PostgreSQL provisioned and assert startup < 30s and both health endpoints return 200 within 5s
    - _Requirements: 2.12_

- [ ] 4. Cloud Deployment Verification
  - [~] 4.1 Extend the deployment generator with all seven targets, Helm chart, and HPA
    - Extend `packages/core/src/cloud/deployment.ts` with the `DeploymentTarget` union and `generateTargetAssets()`; extend `generateKubernetes` for production manifests + liveness/readiness probes, add the Helm chart (`deploy/helm/street/`) and the HPA autoscaling example
    - _Design: Components → Cloud Deployment Verifier (per-target deliverables table)_
    - _Requirements: 2.1, 2.2_

  - [~] 4.2 Write property test for generated manifests
    - **Property 4: Generated deployment manifests are structurally valid for every supported target** (fast-check, min 100 runs; kubernetes, cloudrun, ecs)
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [~] 4.3 Implement remaining target assets and adapters
    - Add Cloud Run profile (extend `generateCloudRun`), ECS task + service definitions (extend `generateEcs`), and deploy workflows/adapters for AWS Lambda (handler adapter + cold-start validation), Azure Functions (host config), Google Cloud Functions (entrypoint adapter), and Cloudflare Workers (`wrangler` + Worker adapter)
    - _Design: Components → Cloud Deployment Verifier (per-target deliverables table)_
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [~] 4.4 Implement per-target deploy/smoke/report scripts and the report builder
    - Create `scripts/cloud/*` running health checks (`/health/live` + `/health/ready` ≤ 5s) and smoke tests (≤ 300s, 0 fail/0 error), and `buildDeploymentReport()` producing the cross-target roll-up with per-target status + ISO-8601 timestamp; record PARTIAL with retained failing output when bounds are exceeded
    - _Design: Components → Cloud Deployment Verifier (`buildDeploymentReport`); Sequence → deploy → verify_
    - _Requirements: 2.9, 2.10, 2.11, 2.13_

  - [~] 4.5 Implement prerequisite probes, offline-verifiable artifacts, and BLOCKED recording
    - Add prerequisite probes (kubectl/helm/credentials) and offline artifacts that run without credentials: `validateDeploymentManifest()`, `helm lint`, `helm template`, `wrangler deploy --dry-run`, task-def JSON schema validation, workflow lint; record the target BLOCKED with the specific missing dependency id while still emitting the offline evidence
    - _Design: Components → Cloud Deployment Verifier (offline-verifiable artifacts); Testing Strategy → Honest BLOCKED recording_
    - _Requirements: 2.14, 1.5_

  - [~] 4.6 Write kind-cluster integration verification for Kubernetes (Layer B)
    - Deploy generated manifests + Helm to a local kind cluster, assert pod `1/1 Running`, health 200, smoke 0 fail/0 error; skip (not fail) when kind is unreachable, recording BLOCKED honestly
    - _Requirements: 2.9, 2.10_

  - [~] 4.7 Wire the cloud deploy verification CI job and emit the artifact
    - Extend `.github/workflows/deploy-verify.yml` to run the verifier through `CommandRunner` and upload the per-target artifacts + `deployment-report.json` via `actions/upload-artifact`
    - _Design: Testing Strategy → CI integration and evidence retention_
    - _Requirements: 2.11_

  - [~] 4.8 Write unit tests for the deployment report status mapping
    - Cover VERIFIED/PARTIAL/BLOCKED mapping and retained failing output in the report
    - _Requirements: 2.11, 2.13, 2.14_

- [~] 5. Checkpoint - cloud verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. DAST verification
  - [~] 6.1 Extend the DAST verifier with an artifact emitter and expanded route surface
    - Extend `packages/core/src/security/dast.ts` with `buildDastArtifact()` (per-severity counts, endpoints scanned/total, gate outcome, failure cause) and grow `dast/routes.json` to cover auth, RBAC-protected, file upload, and CRUD endpoints
    - _Design: Components → DAST verifier_
    - _Requirements: 3.1, 3.2, 3.7_

  - [~] 6.2 Write property test for the severity gate
    - **Property 5: The DAST severity gate fails iff a finding meets the threshold** (fast-check, min 100 runs; `DastFinding[]` generator across all five severities)
    - **Validates: Requirements 3.4, 3.5, 3.6**

  - [~] 6.3 Write property test for severity counts
    - **Property 6: Severity counts are an exact tally** (fast-check, min 100 runs)
    - **Validates: Requirements 3.7**

  - [~] 6.4 Write property test for scan coverage
    - **Property 7: Scan coverage equals the enumerated operation set** (fast-check, min 100 runs)
    - **Validates: Requirements 3.2**

  - [~] 6.5 Wire the DAST CI workflow with real scans and timeout (Layer B)
    - Extend `.github/workflows/dast.yml` to run real Schemathesis + ZAP Baseline + ZAP API scans against a running instance through `CommandRunner`, enforce a 30-minute `timeout-minutes` + in-script watchdog, record failure cause (`target-unavailable`/`scan-error`/`timeout`), fail the build on High/Critical, and upload the artifact
    - _Design: Components → DAST verifier (behavior); Error Handling 3.8/3.9_
    - _Requirements: 3.1, 3.3, 3.8, 3.9_

- [ ] 7. Network Plugin Registry
  - [~] 7.1 Implement core pagination helper and reuse signing primitives
    - Add `normalizePageSize()` (pure, in core) and confirm reuse of `signManifest`/`verifyManifest`/`manifestChecksum`
    - _Design: Components → Network Plugin Registry (`normalizePageSize`)_
    - _Requirements: 4.6_

  - [~] 7.2 Write property test for pagination clamping
    - **Property 12: Pagination is clamped to its bounds** (fast-check, min 100 runs)
    - **Validates: Requirements 4.6**

  - [~] 7.3 Write property test for signature verification soundness
    - **Property 8: Signature verification is sound** (fast-check, min 100 runs; manifest + Ed25519 keypair generator with tamper mutations)
    - **Validates: Requirements 4.2, 5.7**

  - [~] 7.4 Implement the `@streetjs/registry` server package
    - Create `packages/registry-server/` exposing `/api/v1` publish/download/verify/search/list/versions; bearer-token authn + namespace authz; manifest metadata validation (identity/name/version/dependencies/capabilities); `verifyManifest()` Ed25519 + checksum; storage of tarball + signed manifest + publisher key + indexed metadata; reject (preserving prior valid versions) on integrity failure, duplicate `name@version`, or malformed/missing field
    - _Design: Components → Network Plugin Registry; Sequence → publish → install; Error Handling 4.4/4.9/4.10_
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.9, 4.10_

  - [~] 7.5 Write property test for manifest metadata validation
    - **Property 10: Manifest metadata validation accepts iff well-formed and non-duplicate** (fast-check, min 100 runs)
    - **Validates: Requirements 4.5, 4.10**

  - [~] 7.6 Write property test for publish authentication and authorization
    - **Property 13: Publishing requires authentication and authorization** (fast-check, min 100 runs)
    - **Validates: Requirements 4.9**

  - [~] 7.7 Write property test for the download round trip
    - **Property 9: Download is a byte-faithful round trip** (fast-check, min 100 runs)
    - **Validates: Requirements 4.3**

  - [~] 7.8 Write property test for rejected versions and preservation of prior versions
    - **Property 11: A rejected version never becomes installable and prior valid versions are preserved** (fast-check, min 100 runs)
    - **Validates: Requirements 4.4, 5.7, 5.8**

  - [~] 7.9 Implement registry CLI commands and publishing/installation guides
    - Add `street registry publish|install|search|list` driving the server, and author the publishing guide and installation guide as Pages docs
    - _Design: Components → Network Plugin Registry (CLI + guides)_
    - _Requirements: 4.1, 4.7_

  - [~] 7.10 Implement the publish→install E2E harness and CI workflow (Layer B)
    - Run a registry server in a container, execute publish→install end-to-end through `CommandRunner`, emit `registry.publish-install.artifact.json`, and upload it from CI; skip with honest BLOCKED when the container is unavailable
    - _Design: Components → Network Plugin Registry (E2E harness); Testing Strategy → Layer B_
    - _Requirements: 4.8_

- [~] 8. Checkpoint - registry
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Official Plugin Ecosystem
  - [~] 9.1 Implement storage plugin packages (Redis, S3, R2)
    - Create `packages/plugin-redis/`, `packages/plugin-s3/`, `packages/plugin-r2/`, each with `src/index.ts` extending `PluginModule`, `manifest.json`, build-produced `manifest.signed.json`, `README.md`, and `example/`
    - _Design: Components → Official Plugin Ecosystem (uniform package structure)_
    - _Requirements: 5.1, 5.5_

  - [~] 9.2 Implement messaging, payments, and identity plugin packages
    - Create `packages/plugin-twilio/`, `packages/plugin-sendgrid/`, `packages/plugin-stripe/`, `packages/plugin-auth0/` with the same uniform structure
    - _Design: Components → Official Plugin Ecosystem_
    - _Requirements: 5.2, 5.3, 5.4, 5.5_

  - [~] 9.3 Implement install-through-registry with enforced signature verification
    - Wire installation through the registry so `PluginHost` enforces signature verification (bad signature ⇒ `PluginSignatureError`, installed set unchanged, plugin not registered), a valid signed plugin installs in < 60s and registers, and a missing/malformed manifest is rejected with an identifying error
    - _Design: Components → Official Plugin Ecosystem (install path); Error Handling 5.7/5.8_
    - _Requirements: 5.6, 5.7, 5.8_

  - [~] 9.4 Write unit tests for plugin structure and signature enforcement
    - Verify the per-package official-plugin structure (5.5) and signature-enforcement behavior on install
    - _Requirements: 5.5, 5.7, 5.8_

  - [~] 9.5 Write integration tests against real backing services with BLOCKED recording (Layer B)
    - Run each plugin's integration test against its real backing service (Redis/S3/R2 via containers; Twilio/SendGrid/Stripe/Auth0 via sandbox accounts), emit `plugin.<id>.artifact.json` with pass result + plugin id + ISO-8601 timestamp, and record BLOCKED with the missing credential id when a test account is absent
    - _Design: Components → Official Plugin Ecosystem; Testing Strategy → Layer B + Honest BLOCKED_
    - _Requirements: 5.9_

- [ ] 10. Enterprise Console APIs
  - [~] 10.1 Implement the Enterprise Console REST handlers with authn/authz and validation
    - Create `packages/core/src/enterprise/console/` (zero-dep handlers reusing tenancy/enterprise + `http/auth.middleware.ts`/`security/jwt.ts`) exposing Tenant, Policy (RBAC/MFA/retention/classification), Compliance (audit export/report/posture), and Admin (users/key rotation/secrets) APIs; each handler authenticates (401), authorizes (403), validates input (reject identifying invalid input, leave state unchanged), then performs
    - _Design: Components → Enterprise Console APIs; Error Handling 6.6/6.7/6.8_
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [~] 10.2 Write property test for authentication/authorization gating
    - **Property 14: Every enterprise operation requires authn and authz, else state is unchanged** (fast-check, min 100 runs)
    - **Validates: Requirements 6.5, 6.6, 6.7**

  - [~] 10.3 Write property test for invalid-input rejection
    - **Property 15: Invalid input is rejected without state change** (fast-check, min 100 runs)
    - **Validates: Requirements 6.8**

  - [~] 10.4 Generate the OpenAPI specification and documentation for every operation
    - Generate the OpenAPI spec via `openApiSpec()` and author published docs covering every exposed operation
    - _Design: Components → Enterprise Console APIs (OpenAPI + docs)_
    - _Requirements: 6.9_

  - [~] 10.5 Write property test for OpenAPI coverage
    - **Property 16: Generated OpenAPI covers every exposed enterprise operation** (fast-check, min 100 runs)
    - **Validates: Requirements 6.9**

  - [~] 10.6 Run the enterprise suite against a running instance and emit the artifact (Layer B)
    - Execute the suite against a running app + PostgreSQL container through `CommandRunner`, emit `enterprise.api.artifact.json` with executed command, exit code, and pass/fail counts, and upload from CI
    - _Design: Components → Enterprise Console APIs; Testing Strategy → Layer B_
    - _Requirements: 6.10_

- [~] 11. Checkpoint - enterprise APIs
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Interactive Developer Experience
  - [~] 12.1 Implement the DX data builders in core/devtools logic
    - Implement `buildRouteTree()` (method + path from registered routes), `buildDependencyGraph()` (reuse the import-walk from `scripts/check-cycles.mjs`), and the `InspectorResult` model (status/headers/body; on failure error + retained input)
    - _Design: Components → Interactive Developer Experience_
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [~] 12.2 Write property test for the route tree
    - **Property 17: The route tree reflects exactly the registered routes** (fast-check, min 100 runs)
    - **Validates: Requirements 7.2**

  - [~] 12.3 Write property test for the dependency graph
    - **Property 18: The dependency graph is well-formed** (fast-check, min 100 runs)
    - **Validates: Requirements 7.3**

  - [~] 12.4 Write property test for the API Inspector failure path
    - **Property 19: A failed inspector request retains its input** (fast-check, min 100 runs)
    - **Validates: Requirements 7.5**

  - [~] 12.5 Implement the `@streetjs/devtools` browser bundle and embed it in the docs site
    - Create `packages/devtools/` delivering Playground (route/middleware/plugin testing + OpenAPI viewer), Route Explorer, Dependency Graph Visualizer, and API Inspector as a browser experience; declare and enforce a token-gated authn/authz model (read-only against the inspected app); embed into the GitHub Pages docs site
    - _Design: Components → Interactive Developer Experience_
    - _Requirements: 7.1, 7.6, 7.7, 7.8_

  - [~] 12.6 Build the devtools bundle and run its tests, emitting artifacts (Layer B)
    - Build the bundle + run headless-browser tests through `CommandRunner`, emit `devx.playground`/`devx.route-explorer`/`devx.dependency-graph` artifacts, and upload from CI
    - _Design: Testing Strategy → Layer B_
    - _Requirements: 7.9_

- [ ] 13. Upgrade System and codemods
  - [~] 13.1 Implement version resolution and breaking-change analysis
    - In `packages/core/src/devx/` add `resolveVersions()` (detect installed, resolve target argument defaulting to latest; on unresolvable version halt with no file writes and an error naming the version) and `analyzeBreakingChanges()` producing `BreakingChange[]` with area + recommendation + optional `codemodId`
    - _Design: Components → Upgrade System; Error Handling 8.2_
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [~] 13.2 Write property test for version resolution
    - **Property 20: Version resolution prefers the explicit target, else latest** (fast-check, min 100 runs)
    - **Validates: Requirements 8.1, 8.2**

  - [~] 13.3 Write property test for breaking-change analysis
    - **Property 21: Breaking-change analysis is well-formed** (fast-check, min 100 runs)
    - **Validates: Requirements 8.3, 8.4**

  - [~] 13.4 Implement routing, middleware, and plugin-API codemods
    - Extend `packages/core/src/devx/codemods.ts` with `ROUTING_CODEMODS`, `MIDDLEWARE_CODEMODS`, `PLUGIN_API_CODEMODS` following the pure source→source contract; unparseable/conflicting files are left unchanged and reported with a reason
    - _Design: Components → Upgrade System (codemods); Error Handling 8.7_
    - _Requirements: 8.5, 8.7_

  - [~] 13.5 Write property test for codemod idempotence
    - **Property 22: Codemods are idempotent** (fast-check, min 100 runs; source-string + codemod generator including already-migrated inputs)
    - **Validates: Requirements 8.6**

  - [~] 13.6 Write property test for codemod failure safety
    - **Property 23: Codemods are safe on failure** (fast-check, min 100 runs; include unparseable inputs)
    - **Validates: Requirements 8.7**

  - [~] 13.7 Wire `street upgrade` reporting and the codemod test artifact + CI
    - Wire `street upgrade` to report breaking changes + recommendations and run the codemod test suite through `CommandRunner` against the migration examples, emitting the `upgrade.codemods` artifact uploaded from CI
    - _Design: Components → Upgrade System_
    - _Requirements: 8.8_

- [~] 14. Checkpoint - DX and upgrade
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Kafka Coordinator Readiness Gate and Chaos
  - [~] 15.1 Implement the Coordinator Readiness Gate
    - Extend `packages/core/src/transports/kafka/client.ts` with `CoordinatorReadinessGate` that waits up to 30s for a successful `FindCoordinator` and `__consumer_offsets` stability (topic exists, every partition has a live leader); on timeout do not begin consuming and preserve committed offsets
    - _Design: Components → Kafka Reliability; Error Handling 9.2_
    - _Requirements: 9.1, 9.2_

  - [~] 15.2 Write property test for the gate timeout
    - **Property 24: A gate timeout preserves committed offsets and does not consume** (fast-check, min 100 runs)
    - **Validates: Requirements 9.2**

  - [~] 15.3 Implement the chaos framework scenarios and lost-message accounting
    - Extend `scripts/reliability/kafka-cold-start.sh` with broker-restart, network-interruption, connection-loss, and slow-broker (≥ 5000 ms delay) scenarios; accept parameterized `COLD_STARTS`/`RESTART_CYCLES` supporting the full-scale targets; implement lost-message accounting (`produced − deliveredToCommitted`)
    - _Design: Components → Kafka Reliability (chaos framework)_
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [~] 15.4 Write property test for lost-message accounting
    - **Property 25: Lost-message accounting is exact** (fast-check, min 100 runs)
    - **Validates: Requirements 9.8**

  - [~] 15.5 Run the full-scale (100/100) chaos suite and emit artifacts (Layer B)
    - Run 100 cold starts and 100 broker restarts plus the network-interruption and slow-broker scenarios against `apache/kafka:3.7.1` (KRaft) in Docker through `CommandRunner`, emit `kafka.coldstart`/`kafka.chaos.*` artifacts (parameter values, pass count, lost-message count, ISO-8601 timestamp), upload from CI, and record BLOCKED honestly when the broker is unreachable
    - _Design: Testing Strategy → Layer B + Honest BLOCKED_
    - _Requirements: 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 16. Advanced Observability
  - [~] 16.1 Instrument and export the new subsystem metrics (metrics first)
    - Before any dashboard/alert references them, instrument and export the PostgreSQL, Kafka, RabbitMQ, and Plugin Host metrics listed in the design via the metrics endpoint
    - _Design: Components → Advanced Observability (metrics-first table)_
    - _Requirements: 10.1, 10.2_

  - [~] 16.2 Implement the metric-reference anti-fabrication guard
    - Add `exportedMetricNames()`, `referencedMetrics()`, and `validateMetricReferences()` returning the offending `(metric, asset)` pairs when an asset references a non-exported metric
    - _Design: Components → Advanced Observability (anti-fabrication guard); Error Handling 10.7_
    - _Requirements: 10.1, 10.7_

  - [~] 16.3 Write property test for metric references
    - **Property 26: Observability assets reference only exported metrics** (fast-check, min 100 runs)
    - **Validates: Requirements 10.1, 10.7**

  - [~] 16.4 Implement the dashboards, alerts, and SLO pack
    - Add dashboards for PostgreSQL, Kafka, RabbitMQ, HTTP, and Plugin Host; alerts for latency, error rate, queue depth, and memory pressure (each with a numeric threshold + evaluation window); and an SLO pack for availability, latency, and error budget (numeric targets + windows, extending `streetSloBurnRateRules`)
    - _Design: Components → Advanced Observability_
    - _Requirements: 10.3, 10.4, 10.5_

  - [~] 16.5 Write property test for dashboard and rule structural validity
    - **Property 27: Provided dashboards and rules are structurally valid** (fast-check, min 100 runs)
    - **Validates: Requirements 10.3, 10.4, 10.5**

  - [~] 16.6 Implement the validation pipeline with promtool and emit the artifact + CI
    - Wire `validateMetricReferences`, `validatePrometheusRuleGroups`, `validateGrafanaDashboard`, and **promtool** over emitted rule files; author observability docs; run through `CommandRunner` emitting `observability.validate.artifact.json` (command, exit code, ISO-8601 timestamp) uploaded from the `observability.yml` workflow; fail recording the offending metric/asset or validation error
    - _Design: Components → Advanced Observability (validation pipeline); Error Handling 10.7/10.8_
    - _Requirements: 10.6, 10.8, 10.9_

- [~] 17. Checkpoint - reliability and observability
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 18. Release Engineering
  - [~] 18.1 Implement the release scorecard, validation, and health-delta logic in core
    - In core (zero-dep) add `isValidSemver()`, `validateReleaseNotes()`, the bounded `ReleaseScorecard`, `HealthMetrics` deltas (`current − previous`), and `buildReleaseReport()` recording the failed control when a validation fails
    - _Design: Components → Release Engineering; Data Models → Release Scorecard_
    - _Requirements: 11.1, 11.2, 11.4, 11.5_

  - [~] 18.2 Write property test for bounded release scores
    - **Property 28: Release scores are bounded** (fast-check, min 100 runs)
    - **Validates: Requirements 11.1**

  - [~] 18.3 Write property test for semver and release-notes validation
    - **Property 29: Semver and release-notes validation are correct** (fast-check, min 100 runs)
    - **Validates: Requirements 11.2, 11.3**

  - [~] 18.4 Write property test for release health deltas
    - **Property 30: Release health deltas are exact** (fast-check, min 100 runs)
    - **Validates: Requirements 11.4**

  - [~] 18.5 Implement the report renderer and CI enforcement
    - Add the release report renderer (`scripts/release/*`, may use deps) and a CI enforcement workflow (extend `ci-cd-enforcement.yml`) that runs `buildReleaseReport` through `CommandRunner`, emits `release.scorecard.artifact.json`, and fails the release with a non-zero exit (not publishing) when semver/notes validation or an enforced control fails
    - _Design: Components → Release Engineering (CI enforcement); Error Handling 11.3_
    - _Requirements: 11.3, 11.5, 11.6_

- [ ] 19. Platform Leadership Exit-Criteria aggregator (built last)
  - [~] 19.1 Implement the exit-criteria aggregator
    - In `packages/core/src/verification/` add `PLATFORM_LEADERSHIP_CAPABILITIES`, `LeadershipReport`, and `computeLeadership()` that computes GRANTED iff every required capability is VERIFIED, else WITHHELD with the offending capabilities; a missing artifact is treated as not VERIFIED; the report records each required capability + status, the decision, ISO-8601 timestamp, and the artifact paths read
    - _Design: Components → Exit-criteria engine; Data Models → Exit-Criteria set + report_
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

  - [~] 19.2 Write property test for the leadership decision
    - **Property 31: The Platform Leadership decision is computed only from artifacts** (fast-check, min 100 runs; artifact-set generator across all status combinations and missing entries)
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5**

  - [~] 19.3 Implement `street verify --aggregate` report generation
    - Wire `street verify --aggregate` to read all artifacts under `verification-artifacts/`, call `computeLeadership`, and write `platform-leadership.report.json` (never hand-set)
    - _Design: Components → Exit-criteria engine (CLI surface)_
    - _Requirements: 12.4, 12.5_

  - [~] 19.4 Write the governance unit test that only the aggregator writes the report
    - Grep/lint assertion confirming `platform-leadership.report.json` is produced solely by `computeLeadership` (no hand-authored writes)
    - _Requirements: 12.4_

  - [~] 19.5 Wire the final platform-leadership CI aggregation job and exit-criteria docs
    - Add the final `platform-leadership` GitHub Actions job that runs `street verify --aggregate`, uploads `platform-leadership.report.json`, and reflects (not sets) the computed decision in its pass/fail; author the exit-criteria docs published to GitHub Pages
    - _Design: Testing Strategy → CI integration and evidence retention_
    - _Requirements: 12.1, 12.5_

- [~] 20. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Layer A property/unit tests (fast-check, min 100 runs) validate pure decision logic and never produce a VERIFIED status. Layer B integration tasks run against real infrastructure and are the only basis for VERIFIED; when infrastructure or credentials are absent they record an honest BLOCKED with the specific missing prerequisite while still emitting offline-verifiable artifacts.
- The Verification Artifact subsystem is built first because every capability area emits its evidence through `CommandRunner`; the Platform Leadership Exit-Criteria aggregator and its CI aggregation job are built last because they read all recorded artifacts.
- `@streetjs/core` stays zero-runtime-dependency; new dependencies live only in `registry-server`, `devtools`, `plugin-*`, and the release renderer packages.
- Each property test is tagged `// Feature: platform-leadership-gaps, Property {number}: {property_text}` and implements exactly one design property.
- Every area's CI job uploads its `*.artifact.json` via `actions/upload-artifact`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "1.4"] },
    { "id": 2, "tasks": ["1.5", "1.6", "1.7", "1.8"] },
    { "id": 3, "tasks": ["3.1", "4.1", "6.1", "7.1", "9.1", "9.2", "10.1", "12.1", "13.1", "13.4", "15.1", "16.1", "18.1"] },
    { "id": 4, "tasks": ["3.2", "4.2", "4.3", "6.2", "6.3", "6.4", "7.2", "7.3", "7.4", "10.2", "10.3", "12.2", "12.3", "12.4", "13.2", "13.3", "13.5", "13.6", "15.2", "15.3", "16.2", "18.2", "18.3", "18.4"] },
    { "id": 5, "tasks": ["3.3", "4.4", "4.5", "7.5", "7.6", "7.7", "7.8", "7.9", "9.3", "10.4", "12.5", "13.7", "15.4", "16.3", "16.4"] },
    { "id": 6, "tasks": ["4.6", "4.7", "4.8", "6.5", "7.10", "9.4", "9.5", "10.5", "10.6", "12.6", "15.5", "16.5", "16.6", "18.5"] },
    { "id": 7, "tasks": ["19.1"] },
    { "id": 8, "tasks": ["19.2", "19.3", "19.4"] },
    { "id": 9, "tasks": ["19.5"] }
  ]
}
```
