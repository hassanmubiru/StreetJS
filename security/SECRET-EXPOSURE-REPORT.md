# StreetJS Secret Exposure Report

> Read-only scan of `infra/`, `verification-artifacts/`, `examples/`, `docs/`, and
> all tracked content for committed secrets, tokens, production endpoints, and
> credentials in docs. Evidence-based (`git ls-files`, `git grep`, content scan).

## Summary

| Check | Result |
|---|---|
| Signing **private** keys committed | ✅ NONE — no `*.pem`/`*.key` tracked |
| Tokens committed (`sk-`, `ghp_`, `AKIA`, `_authToken`) | ✅ NONE in tracked content |
| Production endpoints / IPs in `infra/` | ✅ NONE — assets are templated |
| Credentials in docs | ✅ NONE — only placeholders |
| `.npmrc` auth token | ✅ NONE — contains only `legacy-peer-deps=true` |
| RESTRICTED files tracked | ✅ NONE |

**Overall: PASS.** No live secrets are exposed in tracked content.

## Method
Searched tracked files for: `token`, `apikey`, `api_key`, `secret`, `password`,
`bearer`, `authorization`, `private_key`, plus credential signatures
(`AKIA[A-Z0-9]{16}`, `ghp_…`, `sk-…`, `_authToken=`) and PEM private-key headers.

## Findings

### Matches that are NOT secrets (verified benign)
- `packages/core/src/**` — source symbols (`secret-provider.ts`, `SecretProvider`,
  password-validation logic). Code identifiers, not values.
- `infra/docker/compose/docker-compose.yml` / `docker-compose.test-db.yml` —
  **dev/test default credentials** (`POSTGRES_PASSWORD: street_secret`,
  `MYSQL_ROOT_PASSWORD: testpass`, `JWT_SECRET: change-me-in-production-…`,
  `SESSION_KEY: 0123…`, `KEK: change-me-…`). These are clearly-labelled
  local-only placeholders (see INFRASTRUCTURE-SECURITY-REVIEW.md) — **not**
  production secrets. RISK: LOW (local dev only). RECOMMENDATION: keep the
  `change-me-in-production` naming; never reuse in prod.
- `.gitleaks.toml` allowlist regexes — documented public test fixtures (Azurite
  well-known key, obviously-fake `a-very-secret-…`).
- `examples/**`, `docs/**` — placeholder values (`sk-...`, `your-api-key`).

### Known history item (not current content)
- The leaked signing key remains in **history** blob `d7bbfc40` (now distrusted —
  anchor rotated to `3ae9add0`). Not in any tracked file. Purge tracked in
  `KEY-ROTATION-RUNBOOK.md` §7.

## Endpoint exposure
- `infra/` scan for real URLs/IPs (excluding `localhost`/`127.0.0.1`/`0.0.0.0`/
  example domains): **none**. Provider examples (`cloud-run/service.yaml`,
  `cloudflare/wrangler.toml`, `aws-ecs/task-definition.json`, `vercel/vercel.json`)
  use placeholder names. No internal DNS, cluster names, or cloud account IDs.

## Controls preventing regression
- `.gitignore` blocks RESTRICTED patterns; `.gitleaks.toml` (6 rules) + `secret-scan.yml`.
- `secrets-guard` (rule #1) + `block-private-keys.yml` + `security-baseline.yml`
  forbidden-files job + `repository-policy.yml` no-restricted-tracked job.
- `trufflehog.yml` weekly full-history scan.
