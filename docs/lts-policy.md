# Support & LTS Policy

## SemVer commitment

- **MAJOR** — breaking API changes; shipped with migration notes and, where
  feasible, codemods.
- **MINOR** — backward-compatible features.
- **PATCH** — backward-compatible fixes (incl. security).

## Release lines

- **Current** — the latest minor; receives features, fixes, and security patches.
- **LTS** — the most recent designated `x.LTS` line receives **fixes and security
  patches for 12 months** after the next major ships.
- **End-of-life** — lines older than the active LTS receive critical security
  fixes only for a 3-month grace window, then EOL.

## Node.js support

- Supported on active and maintenance Node LTS lines (currently Node 20 and 22,
  exercised in the CI matrix). Dropping a Node line is a MINOR-with-notice or
  MAJOR change depending on impact.

## Deprecation policy

- Public APIs are deprecated for at least one MINOR release (runtime warning +
  docs) before removal in a MAJOR release.
- Deprecations and their replacement are documented in `CHANGELOG.md` and the
  migration guide.

## Security patch SLA

- Critical/High: patched and released within 7 days of confirmed report.
- Medium/Low: bundled into the next scheduled patch/minor.
