# StreetJS Repository Cleanup Plan

> Remaining repository-organization actions. Status reflects work already done in
> the governance/hardening sprints. Moves use `git mv` (history preserved);
> nothing is deleted. Justified per item.

## Done (VERIFIED)
- Root `.md` reduced 45 → 7 (front-door only).
- `plans/` (18), `audits/` (8+), `security/` (reviews/standards/classification), `governance/` (charter, org, this plan) established with READMEs.
- `deploy/` → `infra/{kubernetes,helm,examples}`, `observability/` → `infra/monitoring/`, compose + Dockerfile → `infra/docker/` (refs updated, `docker compose config` validated).
- `sbom.json` / `release-inputs.json` untracked; generated artifacts gitignored.
- Per-plugin `LICENSE` + `SECURITY.md` added; Docker base images digest-pinned; `.gitignore`/`.gitleaks.toml`/`dependabot.yml` hardened; `repository-policy.yml` + `security-baseline.yml` gates added.

## Remaining (operator / explicit decision)

| Item | Action | Justification | Risk |
|---|---|---|---|
| SEO ownership files | `git rm BingSiteAuth.xml googledf528d4f2b039b20.html` after they live in the website repo | They verify the website, not the framework; wrong repo | Low (operator owns website repo) |
| `app-htmx/`, `app-next/`, `app-none/`, `app-react/` scaffold samples | `git mv` → `examples/scaffold-{htmx,next,none,react}/` **or** regenerate in CI as golden fixtures | Generated `street create` output crowding root; belongs in `examples/` per Next.js/Nuxt convention | Med — update `zizmor.yml` scope comment, Dependabot `docker`/`npm` directory paths, and any CI referencing `app-*` |
| `web/` lockfiles | `npm install` in the 4 `web/` apps; commit `package-lock.json` | Dependabot cannot resolve/update them without a lockfile (its own message) | Low |
| Leaked-key history blob | `git filter-repo` purge + coordinated force-push | Removes the (distrusted) historical key; `KEY-ROTATION-RUNBOOK.md` §7 | HIGH (history rewrite — coordinate) |
| On-disk keys (`street-signing.key.pem`, `keys/`) | move to secrets manager | gitignored but in-tree → one `git add -f` from re-exposure | Low |
| CODEOWNERS team handles | fill `@org/*-team` in `.github/CODEOWNERS.proposed`, then `git mv` over `.github/CODEOWNERS` | Single-owner bus-factor | Low |
| Branch/Push protection | enable in GitHub settings | Platform-only; see `security/BRANCH-PROTECTION-REVIEW.md` | Low |

## Note on app-* relocation (if pursued)
Before moving `app-*`, update: `.github/zizmor.yml` (scope comment), `.github/dependabot.yml`
(`docker` directories `/app-htmx`…`/app-react` and `npm` `/app-react/web`,`/app-next/web`),
and any workflow/script referencing `app-*`. Verify on a branch. Because these are
*generated samples*, regenerating them in CI (and not committing) is a defensible
alternative that removes the maintenance burden entirely.
