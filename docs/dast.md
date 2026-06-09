---
layout: default
title: "DAST Pipeline (OpenAPI-driven)"
nav_exclude: true
---

# DAST Pipeline (OpenAPI-driven)

Street ships an automated Dynamic Application Security Testing (DAST) pipeline
that uses the framework's generated OpenAPI spec as the source of truth. It
combines **Schemathesis** (property-based, OpenAPI-driven fuzzing) and **OWASP
ZAP** (baseline + API scan), and gates the build on High/Critical findings with
a deterministic exit code.

## Components

| Component | Location | Role | Status |
| --- | --- | --- | --- |
| Gate engine | `streetjs` → `parseZapReport`, `evaluateDastGate`, `summarizeFindings`, `validateOpenApiDocument`, `openApiOperations` | Normalize reports → severity-gated pass/fail | VERIFIED (unit + script) |
| In-process conformance scanner | `streetjs` → `openApiConformanceScan` | Exercise a live app against its OpenAPI spec; 5xx/connection failure → High | VERIFIED (live in-process scan) |
| OpenAPI export | `scripts/dast/export-openapi.mjs` | Reproducible, validated OpenAPI artifact | VERIFIED |
| Gate runner | `scripts/dast/evaluate-gate.mjs` | Grade a ZAP report → exit 0/2 | VERIFIED |
| CI target harness | `dast/start-target.mjs`, `dast/routes.json` | Live OpenAPI-conformant scan target | VERIFIED (serves /health, /users, /users/:id) |
| Schemathesis runner | `scripts/dast/run-schemathesis.sh` | OpenAPI-driven fuzz (auth/unauth) | IMPLEMENTED |
| ZAP runner | `scripts/dast/run-zap-baseline.sh` | ZAP baseline + API scan → gate | IMPLEMENTED |
| CI workflow | `.github/workflows/dast.yml` | Orchestrates the full pipeline | IMPLEMENTED |

"IMPLEMENTED" components require the external tools (`schemathesis`, ZAP docker
image) and network access; they run in CI. The gate engine and OpenAPI export
are fully verifiable offline (see tests).

## Severity gate

`evaluateDastGate(findings, { failOn })` returns `{ passed, exitCode, counts,
offending }`. Findings at or above `failOn` (default `high`) fail the gate with
**exit code 2**; otherwise exit code 0. ZAP `riskcode` maps to severity:
`3→high`, `2→medium`, `1→low`, `0→info`.

```ts
import { parseZapReport, evaluateDastGate } from 'streetjs';
const gate = evaluateDastGate(parseZapReport(zapJson), { failOn: 'high' });
process.exit(gate.exitCode); // 0 pass, 2 fail
```

## Local usage

```bash
# 1. Export a validated OpenAPI artifact from your routes.
node scripts/dast/export-openapi.mjs --routes dast/routes.json --out dast-reports/openapi.json

# 2. Start your app, then run the scanners against it.
SPEC=dast-reports/openapi.json BASE_URL=http://127.0.0.1:8080 scripts/dast/run-schemathesis.sh
SPEC=dast-reports/openapi.json BASE_URL=http://127.0.0.1:8080 FAIL_ON=high scripts/dast/run-zap-baseline.sh

# Or grade an existing ZAP report directly:
node scripts/dast/evaluate-gate.mjs --zap dast-reports/zap-baseline.json --fail-on high
```

Authenticated scans: pass `TOKEN=<bearer>` to `run-schemathesis.sh`.

## In-process conformance scan (no external tools)

`openApiConformanceScan(doc, { baseUrl, methods?, token?, pathParamValue? })`
exercises every enumerated operation against a live target and returns
`DastFinding[]` — a 5xx response or connection failure is a High finding. It is
the offline counterpart to a Schemathesis scan and needs no external tooling:

```ts
import { openApiConformanceScan, evaluateDastGate } from 'streetjs';

const findings = await openApiConformanceScan(app.openApiSpec(), { baseUrl: 'http://127.0.0.1:8080' });
const gate = evaluateDastGate(findings);
process.exit(gate.exitCode); // 0 pass, 2 if any endpoint 5xx'd
```

The CI target harness (`dast/start-target.mjs`, served on `PORT`) provides a
live, OpenAPI-conformant app to scan.

## CI

`.github/workflows/dast.yml` builds, exports the OpenAPI artifact, starts the
target, runs Schemathesis and ZAP, uploads `dast-reports/`, and fails the build
on High/Critical via the gate.

## Verification

`packages/core/src/tests/dast.test.ts` (10 tests) covers OpenAPI validation +
target enumeration over a real `generateOpenApi()` document, ZAP report
normalization (alert/instance expansion, risk→severity), and the gate
(deterministic exit codes, custom thresholds, summaries, end-to-end).

```bash
cd packages/core && npx tsc && node --test dist/src/tests/dast.test.js
# plus runnable script evidence:
node scripts/dast/evaluate-gate.mjs --zap <zap.json>   # exit 2 on High/Critical
```
