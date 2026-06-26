# StreetJS Repository Metrics

> Reproducible repository metrics. Every figure has a command you can re-run.
> Snapshot basis: current working tree.

## Metrics

| Metric | Value | Reproduce |
|---|---|---|
| Packages | 49 | `ls -1 packages \| wc -l` |
| Official plugins (`plugin-*`) | 21 | `ls -1d packages/plugin-* \| wc -l` |
| Signed plugin manifests | 21 | `ls packages/plugin-*/manifest.signed.json \| wc -l` |
| Examples | 13 | `ls -1 examples \| wc -l` |
| Demos | 4 | `ls -1 demos \| wc -l` |
| RFCs | 4 | `ls -1 rfcs \| wc -l` |
| GitHub workflows | 38 | `ls -1 .github/workflows/*.yml \| wc -l` |
| Documentation pages (`docs/**/*.md`) | 229 | `find docs -name '*.md' \| wc -l` |
| Test files (`*.test.{ts,js,mjs}`) | 355 | `git ls-files \| grep -cE '\.test\.(ts\|js\|mjs)$'` |
| Build/release scripts | 91 | `find scripts -name '*.mjs' -o -name '*.sh' \| wc -l` |
| Frontend integrations | 5 | `react, vue, next, nuxt, edge` (packages) |
| Starters | SaaS + base | `street create --starter saas` |
| Docker images (Dockerfiles) | 7 | `git ls-files \| grep -c 'Dockerfile$'` |

## Coverage
- Branch coverage is enforced per-package in CI (`npm run coverage -w …`);
  `plugin-marzpay` ≈ 97.4% (verified). A repo-wide aggregate is produced by the
  coverage jobs in `ci-cd.yml` (artifacts), not committed.

## Notes
- npm-published packages: those without `"private": true` and not `streetjs.unlisted`
  (the marketplace generator filters by these; see `scripts/gen-plugins-data.mjs`).
- These counts are a point-in-time snapshot; CI can emit them as an artifact by
  running the commands above. They underpin the maturity scoring in
  `audits/SCORING-METHODOLOGY.md`.
