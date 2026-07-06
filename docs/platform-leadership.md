---
layout:     default
title:      "Platform Leadership"
nav_order:  18
permalink:  /platform-leadership/
description: "StreetJS Framework Platform Leadership exit criteria — the strict, machine-computed gate that grants the 95+ classification only when every platform capability is independently VERIFIED."
sitemap:     false
noindex:     true
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Exit Criteria</span>
<h1>Platform Leadership Exit Criteria</h1>
<p>Platform Leadership is the 95+ certification classification. It is granted only when every required platform capability independently holds the VERIFIED status, and the decision is computed by machine from recorded Verification Artifacts — never authored, set, or edited by hand.</p>
</div>

## What Platform Leadership means

Platform Leadership is a single, strict gate. The framework classifies itself as
Platform Leadership only when **all** of the required capabilities below
simultaneously hold the `VERIFIED` Verification Status. If any capability holds
any other status — or has no recorded artifact at all — the classification is
**withheld**, and the offending capabilities are recorded alongside their
current status.

The decision is **derived solely from recorded Verification Artifacts**
(`verification-artifacts/**/*.artifact.json`). There is no manual override: the
aggregator reads the artifacts, applies the rule, and emits a machine-readable
report. The CI gate then *reflects* that decision in its pass/fail — it does not
set it.

{% include callout.html type="warning" title="The classification cannot be claimed prematurely" body="A missing artifact is treated as not VERIFIED. Until every required capability has a recorded VERIFIED artifact, the decision is WITHHELD." %}

## Required capabilities

Each capability below must hold `VERIFIED`. Some are roll-ups: `cloud.deploy` is
VERIFIED only when every deployment target verified; `plugins.ecosystem` only
when every official plugin verified; `kafka.chaos` only when cold-start and
every chaos scenario verified.

| Capability id | Area | Verifier workflow |
| --- | --- | --- |
| `dast.scan` | Dynamic application security testing | `dast.yml` |
| `cloud.deploy` | Cloud deployment targets | `deploy-verify.yml` |
| `registry.publish-install` | Network plugin registry | `registry-verify.yml` |
| `plugins.ecosystem` | Official plugin ecosystem | `vendor-integration.yml` |
| `enterprise.api` | Enterprise Console APIs | `enterprise-verify.yml` |
| `devx.playground` | StreetJS Playground | `devtools-verify.yml` |
| `devx.route-explorer` | Route Explorer | `devtools-verify.yml` |
| `devx.dependency-graph` | Dependency Graph Visualizer | `devtools-verify.yml` |
| `kafka.chaos` | Kafka chaos suite | `kafka-integration.yml` |
| `observability.validate` | Observability packs | `observability.yml` |
| `release.scorecard` | Release scorecards | `ci-cd-enforcement.yml` |

## Verification Status

Every capability's artifact records one of four statuses, assigned by the
verifier's `CommandRunner` from real evidence — never set by hand:

- **VERIFIED** — the real verification command ran against real infrastructure and passed. This is the only status that counts toward Platform Leadership.
- **PARTIAL** — the capability ran but a declared bound was exceeded; failing output is retained.
- **BLOCKED** — a required prerequisite (credential, container, broker, cluster) was absent. The verifier records the specific missing prerequisite and still emits offline-verifiable evidence. BLOCKED is honest, not a failure.
- **NOT_IMPLEMENTED** — no source code or no recorded artifact. A required capability with no artifact is reported as NOT_IMPLEMENTED.

## How the decision is computed

The aggregator lives in `@streetjs/core`
(`packages/core/src/verification/aggregator.ts`) and is the single place that
computes the classification:

1. Read every recorded `*.artifact.json` under `verification-artifacts/`.
2. For each required capability, take the recorded status, or `NOT_IMPLEMENTED` if no artifact exists.
3. The decision is `GRANTED` if and only if **every** required capability is `VERIFIED`; otherwise it is `WITHHELD`, and each non-VERIFIED or missing capability is listed.
4. Emit a machine-readable report recording each required capability and its status, the overall `GRANTED`/`WITHHELD` decision, an ISO-8601 timestamp, and the artifact paths the decision was computed from.

## Running the aggregation locally

Run each capability's verifier to emit its artifact, then aggregate:

```bash
# Build the core + CLI
npm run build -w packages/core
npm run build -w packages/cli

# Aggregate every recorded artifact into the report.
# The exit code reflects the decision: 0 = GRANTED, non-zero = WITHHELD.
node packages/cli/bin/street.js verify --aggregate
```

This reads `verification-artifacts/**/*.artifact.json`, calls the aggregator,
and writes `verification-artifacts/platform-leadership.report.json`. The report
is **only ever produced by the aggregator** — it is never hand-authored.

### Example report

```json
{
  "decision": "WITHHELD",
  "required": [
    { "capabilityId": "dast.scan", "status": "VERIFIED", "hasArtifact": true },
    { "capabilityId": "cloud.deploy", "status": "BLOCKED", "hasArtifact": true },
    { "capabilityId": "release.scorecard", "status": "NOT_IMPLEMENTED", "hasArtifact": false }
  ],
  "withheld": [
    { "capabilityId": "cloud.deploy", "status": "BLOCKED", "hasArtifact": true },
    { "capabilityId": "release.scorecard", "status": "NOT_IMPLEMENTED", "hasArtifact": false }
  ],
  "timestamp": "2026-06-07T00:00:00.000Z",
  "computedFrom": [
    "verification-artifacts/cloud/cloud.deploy.kubernetes.artifact.json",
    "verification-artifacts/dast/dast.scan.artifact.json"
  ]
}
```

## CI enforcement

The final `platform-leadership` GitHub Actions job (`platform-leadership.yml`)
collects the latest recorded Verification Artifacts from every capability area's
verifier, runs `street verify --aggregate`, and uploads
`platform-leadership.report.json` as a build artifact. The job's pass/fail
**reflects** the computed decision: it passes when the decision is `GRANTED` and
fails when it is `WITHHELD`. The job never sets or overrides the decision — it
only mirrors what the aggregator computed from the evidence.

{% include callout.html type="tip" title="Provenance is preserved" body="The report's computedFrom field records exactly which artifact files the decision was derived from, so any GRANTED/WITHHELD result is fully traceable back to its evidence." %}
