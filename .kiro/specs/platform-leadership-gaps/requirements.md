# Requirements Document

## Introduction

This document specifies the requirements for the **Platform Leadership Gaps** feature of the Street Framework (StreetJS). Street is a TypeScript-first, zero-runtime-dependency, security-first backend framework built on Node.js core modules. This spec is scoped specifically to the remaining capability gaps that move the framework from its current certification level (~87, "Advanced Production Ready") to 90+ ("Enterprise Ready") and 95+ ("Platform Leadership"), as identified in the latest certification report. It does not re-specify the broader v1.1–v3.0 roadmap, which is covered by the existing `street-framework-roadmap` spec.

The defining constraint of this spec is a **zero-trust evidence standard**. No capability is considered complete on the basis of estimation, intent, or partial scaffolding. Every capability MUST be backed by executable evidence — source code, automated tests, documentation, AND a machine-readable verification artifact produced by an executed command. Each requirement area defines explicitly what counts as VERIFIED, PARTIAL, BLOCKED, or NOT IMPLEMENTED so that completion is provable rather than asserted.

The following cross-cutting constraints apply to every requirement in this document:

- **Zero runtime dependencies for core**: The `@streetjs/core` package SHALL NOT introduce runtime dependencies. Plugins, registry services, and developer tooling MAY use external dependencies where they live outside the core package.
- **Security-first**: Every network-exposed surface introduced by this spec SHALL declare its authentication and authorization model.
- **Real-infrastructure testing**: Verification SHALL execute against real infrastructure (real containers, brokers, databases, deployment targets). Mocks and stubs SHALL NOT be used as the basis for a VERIFIED status.
- **CI/CD integration**: Every verification SHALL be executable from a GitHub Actions workflow and SHALL emit a retained evidence artifact.
- **Documentation delivery**: Documentation produced by this spec SHALL be publishable to the GitHub Pages docs site.

## Glossary

- **Street Framework / Framework**: The TypeScript-first backend framework, consisting of `@streetjs/core`, `@streetjs/cli`, and associated plugin and tooling packages.
- **CLI**: The `@streetjs/cli` command-line interface.
- **Core**: The `@streetjs/core` runtime library, which carries zero runtime dependencies.
- **Verification Artifact**: A machine-readable file (JSON or equivalent) produced by an executed command that records the inputs, outputs, exit status, and timestamp of a verification run.
- **Evidence**: The combination of source code, automated tests, documentation, and a Verification Artifact that together prove a capability is functional.
- **Verification Status**: One of four states assigned to a capability — VERIFIED, PARTIAL, BLOCKED, or NOT IMPLEMENTED — as defined in Requirement 1.
- **Cloud Deployment Verifier**: The subsystem and workflows that deploy the Framework to a cloud target and confirm health.
- **Deployment Target**: A specific runtime destination: Kubernetes, Cloud Run, ECS Fargate, AWS Lambda, Azure Functions, Google Cloud Functions, or Cloudflare Workers.
- **Smoke Test**: An automated test executed against a deployed instance that confirms the instance serves expected responses.
- **Health Endpoint**: An HTTP endpoint (`/health/live`, `/health/ready`) that reports liveness and readiness.
- **DAST**: Dynamic Application Security Testing — security scanning performed against a running application.
- **Schemathesis**: A property-based API testing tool driven by an OpenAPI specification.
- **ZAP**: The OWASP Zed Attack Proxy, used for baseline and API security scans.
- **Severity Gate**: A CI control that fails a build when findings of a configured severity are present.
- **Plugin Registry Service**: The REST service that hosts, indexes, and serves Street plugins.
- **Plugin**: A versioned, signed extension package consumable by the Framework.
- **Plugin Manifest**: A metadata document describing a plugin's identity, version, dependencies, and capabilities.
- **Ed25519 Signature**: A digital signature over a plugin package used to verify authenticity and integrity.
- **Official Plugin**: A plugin authored and verified by the Street Framework project.
- **Enterprise Console API**: The REST surface for tenant, policy, compliance, and administrative operations.
- **Tenant**: A discrete customer or organizational unit with isolated data and configuration.
- **Street Playground**: A browser-based interactive environment for testing routes, middleware, and plugins.
- **Route Explorer**: A browser-based visualization of the application's route tree.
- **Dependency Graph Visualizer**: A browser-based visualization of the application's module dependency graph.
- **API Inspector**: A browser-based request/response exploration tool.
- **Upgrade System**: The `street upgrade` CLI capability that detects versions, analyzes breaking changes, and applies codemods.
- **Codemod**: An automated, idempotent source transformation that migrates code across a breaking change.
- **Coordinator Readiness Gate**: A Kafka client control that waits for `FindCoordinator` success and `__consumer_offsets` topic stability before proceeding.
- **Chaos Framework**: The test harness that injects faults (broker restart, network interruption, connection loss, slow broker) into a running system.
- **Cold Start Verification**: A test that repeatedly starts the application and a broker from a cold state and confirms successful operation.
- **SLO Pack**: A bundle of Service Level Objective definitions covering availability, latency, and error budget.
- **promtool**: The Prometheus rule and unit-test validation utility.
- **Exported Metric**: A metric the application actually emits at runtime via its metrics endpoint.
- **Release Scorecard**: A machine-generated report scoring a release across security, reliability, coverage, and performance dimensions.
- **Platform Leadership**: The 95+ certification classification, attainable only when all exit criteria in Requirement 12 are VERIFIED.

## Requirements

---

### Requirement 1: Zero-Trust Verification Framework

**User Story:** As a framework maintainer, I want every platform capability to carry a provable verification status backed by executed-command evidence, so that certification reflects reality rather than estimation.

#### Acceptance Criteria

1. THE Framework SHALL define exactly four Verification Statuses: VERIFIED, PARTIAL, BLOCKED, and NOT IMPLEMENTED.
2. THE Framework SHALL assign each capability exactly one Verification Status per verification run, evaluated in the following precedence order: NOT IMPLEMENTED, then BLOCKED, then VERIFIED, then PARTIAL.
3. WHERE a capability has source code, automated tests that exit with a zero exit code, published documentation, and a Verification Artifact produced by an executed command, THE Framework SHALL classify the capability as VERIFIED.
4. WHERE a capability has at least one but fewer than all four of source code, passing tests, documentation, and a Verification Artifact, THE Framework SHALL classify the capability as PARTIAL and SHALL record, for each of the four evidence components, whether it is present or absent.
5. IF a capability cannot be verified because an external prerequisite outside the Framework's control (a network-reachable service, an access credential, or a hardware or runtime dependency) is unavailable, THEN THE Framework SHALL classify the capability as BLOCKED and SHALL record the identifier of the specific missing prerequisite.
6. WHERE a capability has no source code, THE Framework SHALL classify the capability as NOT IMPLEMENTED.
7. THE Framework SHALL record each Verification Status in a machine-readable Verification Artifact that includes the capability identifier, the status, the executed command, the command exit code, and an ISO-8601 timestamp.
8. THE Verification Artifact SHALL be generated by an executed command and SHALL NOT be authored or edited by hand.
9. WHEN any verification command exits with a non-zero exit code, THE Framework SHALL record the corresponding capability as a status other than VERIFIED.
10. IF a verification command does not complete within 300 seconds, THEN THE Framework SHALL terminate the command, classify the capability as BLOCKED, and record the timeout as the missing prerequisite.
11. IF the Framework cannot write the Verification Artifact to its persistence target, THEN THE Framework SHALL exit with a non-zero exit code, SHALL emit an error indication identifying the affected capability, and SHALL NOT leave a partial or incomplete Verification Artifact in place.

---

### Requirement 2: Cloud Deployment Verification

**User Story:** As a platform engineer, I want every supported cloud adapter to be a deployment-verified target, so that I can deploy Street to my platform with confidence that it boots, serves health, and passes smoke tests.

#### Acceptance Criteria

1. THE Cloud Deployment Verifier SHALL support seven Deployment Targets: Kubernetes, Cloud Run, ECS Fargate, AWS Lambda, Azure Functions, Google Cloud Functions, and Cloudflare Workers.
2. WHERE the Deployment Target is Kubernetes, THE Cloud Deployment Verifier SHALL provide production manifests, a Helm chart, liveness and readiness health probes, an autoscaling example, and smoke tests.
3. WHERE the Deployment Target is Cloud Run, THE Cloud Deployment Verifier SHALL provide a deployment profile, health validation, and CI verification.
4. WHERE the Deployment Target is ECS Fargate, THE Cloud Deployment Verifier SHALL provide a task definition, a service deployment definition, and smoke tests.
5. WHERE the Deployment Target is AWS Lambda, THE Cloud Deployment Verifier SHALL provide a deployment workflow and cold-start validation.
6. WHERE the Deployment Target is Azure Functions, THE Cloud Deployment Verifier SHALL provide a deployment workflow and validation tests.
7. WHERE the Deployment Target is Google Cloud Functions, THE Cloud Deployment Verifier SHALL provide a deployment workflow and validation tests.
8. WHERE the Deployment Target is Cloudflare Workers, THE Cloud Deployment Verifier SHALL provide a deployment workflow and validation tests.
9. WHEN a Deployment Target is deployed during verification, THE Health Endpoint SHALL return HTTP 200 with a body reporting a healthy status within 5 seconds per request for both `/health/live` and `/health/ready`.
10. WHEN a Deployment Target is deployed during verification, THE smoke tests for that target SHALL complete within 300 seconds with zero failed cases and zero errored cases.
11. WHEN all configured Deployment Targets complete verification, THE Cloud Deployment Verifier SHALL generate a deployment verification report that records, for each target, one of the four Verification Statuses (VERIFIED, PARTIAL, BLOCKED, NOT IMPLEMENTED) and an ISO-8601 run timestamp.
12. WHEN the application bootstraps in a deployment environment that has no provisioned PostgreSQL instance, THE Framework SHALL complete startup within 30 seconds and serve the Health Endpoint without requiring a database connection at bootstrap, by deferring database pool initialization until first database use or by treating the database as a declared provisioned dependency.
13. IF the Health Endpoint or the smoke tests for a target do not complete within their time bounds, THEN THE Cloud Deployment Verifier SHALL record that target as PARTIAL and SHALL retain the failing output in the report.
14. IF a required deployment dependency is unavailable during verification, THEN THE Cloud Deployment Verifier SHALL record the affected target as BLOCKED with the specific missing dependency.

---

### Requirement 3: Complete DAST Verification

**User Story:** As a security engineer, I want real dynamic security scans executed against the running application's sensitive endpoints, so that high and critical vulnerabilities are caught and block the build automatically.

#### Acceptance Criteria

1. THE DAST subsystem SHALL execute real Schemathesis scans, real ZAP Baseline scans, and real ZAP API scans against a running instance of the application whose Health Endpoint responds successfully within 30 seconds of startup.
2. THE DAST subsystem SHALL scan 100% of the OpenAPI-enumerated endpoints, including the authentication endpoints, the RBAC-protected endpoints, the file upload endpoints, and the CRUD endpoints.
3. WHEN a DAST scan completes, THE DAST subsystem SHALL produce scan artifacts, a findings report recording each finding with its severity, and CI evidence consisting of the uploaded scan artifacts and the recorded Severity Gate outcome.
4. IF a DAST scan reports one or more findings of severity High, THEN THE Severity Gate SHALL fail the build and SHALL indicate that High-severity findings caused the failure.
5. IF a DAST scan reports one or more findings of severity Critical, THEN THE Severity Gate SHALL fail the build and SHALL indicate that Critical-severity findings caused the failure.
6. WHEN a DAST scan reports zero High findings and zero Critical findings, THE Severity Gate SHALL pass the build.
7. THE DAST subsystem SHALL record the scan outcome in a Verification Artifact that includes the count of findings at each severity level: Critical, High, Medium, Low, and Informational.
8. IF the target application is unavailable or a scan fails to execute, THEN THE DAST subsystem SHALL fail the build and SHALL record the failure cause in the Verification Artifact.
9. IF a DAST scan does not complete within 30 minutes, THEN THE DAST subsystem SHALL terminate the scan and fail the build, recording the timeout in the Verification Artifact.

---

### Requirement 4: Network Plugin Registry

**User Story:** As a plugin author, I want a network-accessible registry service with secure publish and install flows, so that I can distribute signed plugins and consumers can install them safely.

#### Acceptance Criteria

1. THE Plugin Registry Service SHALL expose REST APIs to publish a plugin, download a plugin, search plugins, list plugins, and verify a plugin.
2. WHEN a plugin is published, THE Plugin Registry Service SHALL require and validate an Ed25519 Signature over the plugin package before storing the plugin.
3. WHEN a plugin is downloaded, THE Plugin Registry Service SHALL provide the plugin package together with its recorded Ed25519 Signature so the consumer can perform integrity validation.
4. IF a plugin's integrity validation fails, THEN THE Plugin Registry Service SHALL reject the plugin, SHALL NOT serve it for installation, SHALL preserve any previously published valid versions, and SHALL return an error indication.
5. WHEN a plugin is published, THE Plugin Registry Service SHALL validate the Plugin Manifest metadata — including plugin identity, name, version, declared dependencies, and declared capabilities — before accepting the plugin.
6. THE Plugin Registry Service SHALL support pagination with a default page size of 25 and a maximum page size of 100, and SHALL support search, categories, tags, and version history for plugins.
7. THE Plugin Registry Service SHALL provide a publishing guide and an installation guide.
8. WHEN an end-to-end publish-then-install flow is executed against the running Plugin Registry Service, THE flow SHALL complete successfully and SHALL be recorded in a Verification Artifact.
9. WHEN a plugin is published, THE Plugin Registry Service SHALL require an authenticated and authorized publisher identity and SHALL reject the publish request when the publisher is not authenticated or not authorized.
10. IF a published plugin's manifest metadata is missing a required field, duplicates an existing identity-and-version pair, or is malformed, THEN THE Plugin Registry Service SHALL reject the plugin and SHALL return an error indication identifying the offending metadata.

---

### Requirement 5: Official Plugin Ecosystem

**User Story:** As an application developer, I want a set of officially verified plugins for common integrations, so that I can adopt storage, messaging, payments, and identity providers with verified, signed packages.

#### Acceptance Criteria

1. THE Framework SHALL provide Official Plugins for storage covering Redis, AWS S3, and Cloudflare R2.
2. THE Framework SHALL provide Official Plugins for messaging covering Twilio and SendGrid.
3. THE Framework SHALL provide an Official Plugin for payments covering Stripe.
4. THE Framework SHALL provide an Official Plugin for identity covering Auth0.
5. THE Framework SHALL include for each Official Plugin a Plugin Manifest, an Ed25519 Signature, automated tests, documentation, and an example application.
6. WHEN an Official Plugin with a valid signature is installed through the Plugin Registry Service, THE installation SHALL complete within 60 seconds and SHALL register the plugin with the Framework.
7. WHEN an Official Plugin is installed through the Plugin Registry Service, THE Framework SHALL enforce signature verification and, IF the signature does not validate, THEN THE Framework SHALL reject the plugin, SHALL leave the installed plugin set unchanged, SHALL NOT register the plugin, and SHALL return an error indication.
8. IF an Official Plugin's Plugin Manifest is missing or malformed during installation, THEN THE Framework SHALL reject the plugin and SHALL return an error indication identifying the manifest problem.
9. WHEN the integration tests for an Official Plugin are executed against its real backing service, THE tests SHALL complete with zero failed cases and SHALL be recorded in a Verification Artifact that includes the pass result, the plugin identifier, and an ISO-8601 timestamp.

---

### Requirement 6: Enterprise Console APIs

**User Story:** As an enterprise administrator, I want REST APIs to manage tenants, policies, compliance, and administrative operations, so that I can govern a multi-tenant deployment programmatically.

#### Acceptance Criteria

1. THE Enterprise Console API SHALL expose Tenant APIs to create a tenant, update a tenant, and suspend a tenant.
2. THE Enterprise Console API SHALL expose Policy APIs covering RBAC, MFA, data retention, and data classification.
3. THE Enterprise Console API SHALL expose Compliance APIs to export audit records, generate compliance reports, and report security posture.
4. THE Enterprise Console API SHALL expose Admin APIs for user management, key rotation, and secret management.
5. THE Enterprise Console API SHALL require successful authentication and authorization before performing any exposed operation.
6. IF a request to an Enterprise Console API operation is not authenticated, THEN THE Enterprise Console API SHALL reject the request without performing the operation and SHALL return an authentication-failure indication.
7. IF an authenticated request to an Enterprise Console API operation is not authorized for that operation, THEN THE Enterprise Console API SHALL reject the request without performing the operation and SHALL return an authorization-failure indication.
8. IF a request to an Enterprise Console API operation contains invalid input, THEN THE Enterprise Console API SHALL reject the request, SHALL leave tenant, policy, compliance, and administrative state unchanged, and SHALL return an error indication identifying the invalid input.
9. THE Enterprise Console API SHALL have published documentation and a generated OpenAPI specification that together cover every exposed operation.
10. WHEN the Enterprise Console API test suite is executed against a running instance, THE tests SHALL complete with zero failing tests and SHALL be recorded in a Verification Artifact that includes the executed command, the command exit code, and the passed and failed test counts.

---

### Requirement 7: Interactive Developer Experience

**User Story:** As a developer, I want browser-based interactive tools to explore and test my application, so that I can understand routes, dependencies, and behavior without writing throwaway scripts.

#### Acceptance Criteria

1. THE Street Playground SHALL provide route testing, middleware testing, plugin testing, and an OpenAPI viewer.
2. THE Route Explorer SHALL render a visual route tree of the application's registered routes.
3. THE Dependency Graph Visualizer SHALL render a visual graph of the application's module dependencies.
4. THE API Inspector SHALL provide a request and response explorer.
5. THE Street Playground, Route Explorer, Dependency Graph Visualizer, and API Inspector SHALL be delivered as a browser-based experience.
6. THE interactive developer experience SHALL be integrated into the published documentation.
7. WHEN the interactive developer experience is built and its test suite is executed, THE build SHALL succeed and THE tests SHALL pass, recorded in a Verification Artifact.

---

### Requirement 8: Upgrade System

**User Story:** As a developer upgrading Street across versions, I want automated version detection, breaking-change analysis, and codemods, so that I can migrate my application across breaking changes with minimal manual work.

#### Acceptance Criteria

1. WHEN `street upgrade` is executed, THE Upgrade System SHALL detect the currently installed Framework version and the target version.
2. WHEN `street upgrade` is executed, THE Upgrade System SHALL analyze and report the breaking changes between the installed version and the target version.
3. WHEN `street upgrade` is executed, THE Upgrade System SHALL produce upgrade recommendations for the detected breaking changes.
4. THE Upgrade System SHALL provide Codemods that perform automated migrations for routing changes, middleware changes, and plugin API changes.
5. WHEN a Codemod is applied twice to the same source, THE second application SHALL produce no further changes.
6. WHEN the Codemod test suite is executed against the migration examples, THE tests SHALL pass and SHALL be recorded in a Verification Artifact.

---

### Requirement 9: Reliability Leadership — Kafka Chaos Verification

**User Story:** As a reliability engineer, I want the Kafka integration to survive coordinator delays, broker restarts, network faults, and repeated cold starts without message loss, so that I can rely on Street's messaging under adverse conditions.

#### Acceptance Criteria

1. THE Kafka integration SHALL implement a Coordinator Readiness Gate that waits for a successful `FindCoordinator` response and for `__consumer_offsets` topic stability before consuming.
2. THE Chaos Framework SHALL implement broker restart, network interruption, connection loss, and slow broker fault scenarios.
3. WHEN the Cold Start Verification is executed at full target scale of 100 cold starts, THE Kafka integration SHALL achieve a 100% pass rate with no hangs and no message loss.
4. WHEN the Chaos Framework executes 100 broker restarts, THE Kafka integration SHALL achieve a 100% pass rate with no hangs and no message loss.
5. WHEN the network interruption scenario is executed, THE Kafka integration SHALL recover and SHALL preserve all in-flight messages.
6. WHEN the slow broker scenario is executed, THE Kafka integration SHALL continue operating without message loss.
7. THE Kafka verification SHALL be reproducible via a parameterized script that supports the full-scale targets, and the run outcome SHALL be recorded in a Verification Artifact.

---

### Requirement 10: Advanced Observability

**User Story:** As an operator, I want dashboards, alerts, and an SLO pack covering the Framework's subsystems, built only on metrics the application truly exports, so that my observability reflects real signals and never fabricated ones.

#### Acceptance Criteria

1. WHERE a dashboard or alert references a metric, THE Framework SHALL export that metric at runtime from a real metrics source before the dashboard or alert is built.
2. THE Framework SHALL export the PostgreSQL, Kafka, RabbitMQ, and Plugin Host metrics required to support their dashboards before those dashboards are built.
3. THE Framework SHALL provide dashboards for PostgreSQL, Kafka, RabbitMQ, HTTP, and Plugin Host.
4. THE Framework SHALL provide alerts for latency, error rate, queue depth, and memory pressure.
5. THE Framework SHALL provide an SLO Pack covering availability, latency, and error budget.
6. WHEN the observability assets are validated, promtool validation of the alert and SLO rules SHALL pass and the dashboard validation SHALL pass.
7. IF a dashboard or alert references a metric that the application does not export, THEN THE observability validation SHALL fail.
8. THE observability assets SHALL be documented, and the validation outcome SHALL be recorded in a Verification Artifact.

---

### Requirement 11: Release Engineering

**User Story:** As a release manager, I want automated release scorecards, changelog validation, and health metrics enforced in CI, so that every release carries provable quality signals.

#### Acceptance Criteria

1. THE Release Engineering subsystem SHALL produce a Release Scorecard scoring security, reliability, coverage, and performance.
2. WHEN a release is prepared, THE Release Engineering subsystem SHALL validate the changelog for semver compliance and SHALL validate the release notes.
3. IF the changelog violates semver or the release notes fail validation, THEN THE Release Engineering subsystem SHALL fail the release in CI.
4. THE Release Engineering subsystem SHALL report health metrics covering dependency freshness, test trends, and vulnerability trends.
5. WHEN a release is prepared, THE Release Engineering subsystem SHALL generate an automated release report and SHALL record it as a Verification Artifact.
6. THE Release Engineering subsystem SHALL enforce its scorecard and validation controls in CI.

---

### Requirement 12: Platform Leadership Exit Criteria

**User Story:** As a framework maintainer, I want a single, strict gate that grants the Platform Leadership classification only when every platform capability is independently verified, so that the classification is provable and cannot be claimed prematurely.

#### Acceptance Criteria

1. THE Framework SHALL classify itself as Platform Leadership only WHEN all of the following capabilities hold the VERIFIED Verification Status simultaneously: DAST fully executed, cloud deployments verified, network plugin registry verified, official plugin ecosystem verified, enterprise APIs verified, Street Playground verified, Route Explorer verified, Dependency Graph Visualizer verified, Kafka chaos suite verified, observability packs verified, and release scorecards verified.
2. IF any capability listed in acceptance criterion 1 holds a Verification Status other than VERIFIED, THEN THE Framework SHALL withhold the Platform Leadership classification.
3. THE Platform Leadership classification decision SHALL be computed from the recorded Verification Artifacts and SHALL NOT be set by hand.
4. WHEN the Platform Leadership classification is computed, THE Framework SHALL emit a report listing each required capability and its current Verification Status.
