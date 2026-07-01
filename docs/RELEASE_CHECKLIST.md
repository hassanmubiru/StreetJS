# StreetJS Framework — Release Checklist

Use this checklist for every release of `@streetjs/core` and `@streetjs/cli`.

---

## Pre-release (local)

### Environment
- [ ] Node.js >= 22 installed (`node --version`)
- [ ] npm >= 9 installed (`npm --version`)
- [ ] Logged in to npm (`npm whoami`)
- [ ] Git working tree is clean (`git status`)
- [ ] On the correct branch (`git branch --show-current`)

### Code quality
- [ ] `npm run build -w packages/core` exits 0
- [ ] `npm run build -w packages/cli` exits 0
- [ ] `npm run lint -w packages/core` exits 0 (tsc --noEmit)
- [ ] `npm run test -w packages/cli` exits 0 (86/86 tests pass)
- [ ] No `dist/src/` in core dist (`ls packages/core/dist/` — must not contain `src/`)
- [ ] No `dist/tests/` in CLI dist (`ls packages/cli/dist/` — must not contain `tests/`)

### Version consistency
- [ ] `packages/core/package.json` version matches intended release
- [ ] `packages/cli/package.json` version matches core version
- [ ] `packages/cli/src/index.ts` VERSION constant matches
- [ ] `packages/cli/src/commands/create.ts` scaffolded `@streetjs/core` dep matches
- [ ] CHANGELOG.md has entry for new version

### Pack validation
- [ ] `cd packages/core && npm pack --dry-run` — no `dist/tests/`, no `dist/src/`
- [ ] `cd packages/cli && npm pack --dry-run` — has `bin/street.js`, has `templates/`, no `dist/tests/`

### Automated validation (run this)
```bash
./scripts/validate-publish.sh
# Expected: 44 passed, 0 failed
```

### Smoke test
```bash
# In a temp directory:
npm link -w packages/cli
street create smoke-test
# Verify: smoke-test/ has all required dirs and files
```

---

## Release execution

### Option A — Automated (recommended)
```bash
# Patch release (1.0.4 → 1.0.5)
./scripts/release.sh patch

# Minor release (1.0.4 → 1.1.0)
./scripts/release.sh minor

# Major release (1.0.4 → 2.0.0)
./scripts/release.sh major

# Dry run (no files modified, no publish)
./scripts/release.sh patch --dry-run
```

> ⚠️ **Provenance warning:** Prefer CI publishing (tag push). A **local/manual
> `npm publish` produces NO provenance attestation** — npm provenance requires
> the OIDC token that only GitHub Actions provides. The `test-and-publish` job
> now includes a **provenance gate** that fails the release if any package lands
> on the registry without an attestation, so a manual publish will be flagged.
> Only publish manually as a last resort (e.g. a CI auth outage), and re-publish
> a patch via CI as soon as possible to restore provenance.

### Option B — Manual step-by-step (last resort — loses provenance)

```bash
# 1. Bump versions
NEW=1.0.5

# Core
node -e "
  const fs = require('fs');
  const p = 'packages/core/package.json';
  const pkg = JSON.parse(fs.readFileSync(p,'utf8'));
  pkg.version = '$NEW';
  fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
"

# CLI
node -e "
  const fs = require('fs');
  const p = 'packages/cli/package.json';
  const pkg = JSON.parse(fs.readFileSync(p,'utf8'));
  pkg.version = '$NEW';
  pkg.dependencies['@streetjs/core'] = '^$NEW';
  fs.writeFileSync(p, JSON.stringify(pkg,null,2)+'\n');
"

# Update VERSION constant
sed -i "s/const VERSION = '[^']*'/const VERSION = '$NEW'/" \
  packages/cli/src/index.ts

# 2. Rebuild
npm run clean -w packages/core && npm run build -w packages/core
npm run clean -w packages/cli  && npm run build -w packages/cli

# 3. Validate
./scripts/validate-publish.sh

# 4. Commit and tag
git add packages/core/package.json packages/cli/package.json \
        packages/cli/src/index.ts packages/cli/src/commands/create.ts
git commit -m "chore: release v$NEW"
git tag -a "v$NEW" -m "Release v$NEW"

# 5. Publish
cd packages/core && npm publish --access public && cd ../..
cd packages/cli  && npm publish --access public && cd ../..

# 6. Push
git push origin main
git push origin "v$NEW"
```

---

## Post-release verification

```bash
# Wait ~60s for registry propagation, then:
./scripts/post-publish-verify.sh 1.0.5

# Or manually:
npm install -g @streetjs/cli@1.0.5
street --version                    # → street v1.0.5
mkdir /tmp/verify && cd /tmp/verify
street create production-test
cd production-test
npm install
npx tsc --noEmit                    # must exit 0

npm view @streetjs/core@1.0.5 version
npm view @streetjs/cli@1.0.5 version
```

---

## Rollback strategy

See `docs/ROLLBACK.md` for the complete rollback procedure.

Quick reference:
```bash
# Deprecate broken version
npm deprecate @streetjs/core@1.0.5 "Critical bug — use 1.0.4"
npm deprecate @streetjs/cli@1.0.5  "Critical bug — use 1.0.4"

# Restore previous dist-tag
npm dist-tag add @streetjs/core@1.0.4 latest
npm dist-tag add @streetjs/cli@1.0.4  latest
```

---

## CI/CD (automatic on tag push)

The `test-and-publish` job in `.github/workflows/ci-cd.yml` runs automatically
when a `v*.*.*` tag is pushed. It:

1. Verifies both package versions match the tag
2. Builds both packages from clean
3. Runs CLI test suite (86 tests)
4. Validates pack output (no test files, no dist/src)
5. Runs `street create` smoke test
6. Publishes `streetjs` (core) with npm provenance
7. Publishes `@streetjs/core` (compat shim) + `@streetjs/cli` with npm provenance
8. **Provenance gate** — verifies every published version carries a provenance
   attestation (fails the release if a manual publish bypassed it)
9. Regenerates a per-release CycloneDX **SBOM** and uploads it as a retained artifact

Each publish step is **idempotent** — if the version is already on the registry
(e.g. a re-run, or after a manual publish), that step is skipped instead of
failing with `E409`.

Required GitHub secrets:
- `NPM_TOKEN` — npm **Automation** token (bypasses 2FA OTP; a classic "Publish"
  token will fail in CI with `EOTP`). A Granular Access Token with publish scope
  also works.
- `PG_PASSWORD` — PostgreSQL password for integration tests
- `KEK` — key encryption key for vault tests
- `JWT_SECRET` — JWT secret for auth tests
- `SESSION_KEY` — session key for session tests
