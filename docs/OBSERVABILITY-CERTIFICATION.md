# Observability Certification

Run: `node --test packages/core/dist/tests/certification/observability-certification.test.js`

Verifies tracing, metrics, logging, and health probes against the real
implementations (no mocks). Wired into `street certify` and CI.

| Area | Verified |
| --- | --- |
| Tracing (OpenTelemetry) | parent/child span trace-id propagation; W3C `traceparent` inject/extract round-trip |
| Metrics (Prometheus) | text exposition 0.0.4 with `# HELP`/`# TYPE`; counter/gauge/histogram; duplicate-registration throws |
| Health | `runLiveness`/`runReadiness` → `ok`; failing/timed-out checks → `degraded`/`down` |
| Logging | structured JSON entries; child-logger binding propagation; correlation IDs; `Error` serialization (name/message/stack) |
| Cloud Run | `K_SERVICE` auto-detection switches to GCP `severity` JSON (verified in `roadmap-partials` suite) |

## Result

All assertions pass. Telemetry shape validated by executable tests.
