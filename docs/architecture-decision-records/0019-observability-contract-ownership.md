# ADR 0019: Keep core and standalone observability contracts distinct

- **Status:** Accepted
- **Date:** 2026-10-20
- **Scope:** `streetjs`, `@streetjs/metrics`, `@streetjs/health`

## Context

The core facade exports `HealthCheckRegistry` and a Prometheus-oriented
`MetricsRegistry`. Separate public packages also export `HealthRegistry` and
`MetricsRegistry`. Similar names do not imply compatible contracts.

Core metrics are created through `counter`/`gauge`/`histogram` methods and
`collect()` returns rendered Prometheus text. Standalone metrics register
`Collectable` objects, return structured snapshots from `collect()`, and render
through `render()`.

Core health uses `up`/`down` checks and `ok`/`degraded` responses with direct
StreetApp route registration. Standalone health uses `pass`/`warn`/`fail`, an
injectable clock, IETF `health+json`, startup checks, and transport-neutral
endpoint responses.

## Decision

Retain both families as separate contracts and owners:

- `streetjs` owns framework-integrated observability.
- `@streetjs/metrics` owns standalone metrics foundations.
- `@streetjs/health` owns standalone health foundations.

Do not mechanically replace core imports with standalone packages. Do not make
standalone packages depend on the core facade. Do not merge the packages.

## Compatibility impact

No public API or runtime behavior changes. Existing consumers continue using the
contract they selected. The distinction is documented so future dependency
audits do not misclassify the duplicate names as a missing narrow import.

## Verification

The core observability suites and standalone metrics/health suites cover their
respective contracts. Builds and tests for all three packages must pass before
this decision is revisited.
