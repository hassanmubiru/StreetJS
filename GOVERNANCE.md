# StreetJS Framework — Governance

## Roles

- **Maintainers** — review/merge PRs, cut releases, own roadmap. Listed in
  `MAINTAINERS` (to be populated as the project grows).
- **Contributors** — anyone submitting issues/PRs under `CONTRIBUTING.md`.
- **Security responders** — handle private vulnerability reports.

## Decision-making

- Routine changes: maintainer review + green CI (`street certify` gate).
- Substantial changes (new public API, breaking change, new package): require an
  RFC (see below) and consensus of maintainers.

## RFC process

1. Open an RFC issue from the `rfc` template describing motivation, design,
   alternatives, backward-compatibility impact, and test/doc plan.
2. Discussion period (minimum 7 days).
3. Maintainer decision: Accepted / Rejected / Postponed, recorded in the issue
   and, for architectural choices, as an ADR under
   `docs/architecture-decision-records/`.
4. Implementation must satisfy the contribution bar: implementation + tests +
   docs + examples (+ benchmarks where applicable).

## Release process

- Versioning follows SemVer; changes recorded in `CHANGELOG.md`
  (Keep a Changelog format).
- CI (`.github/workflows/ci-cd.yml`) gates every release on build, lint,
  full test suites, certification suites, DB E2E, transport integration, and the
  benchmark regression gate. Tagged `v*.*.*` pushes publish with npm provenance.
- `street certify` produces `RELEASE-CERTIFICATION.md` + `certification-report.json`
  as the release evidence artifact.

## Security policy

- Report vulnerabilities privately (see `SECURITY.md` once published); do not
  open public issues for undisclosed vulnerabilities.
- Fixes ship in a patch release; advisories follow coordinated disclosure.

## Code of conduct

Participation is governed by a standard Contributor Covenant (to be added as
`CODE_OF_CONDUCT.md`).
