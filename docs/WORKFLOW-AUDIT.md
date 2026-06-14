# GitHub Actions Workflow Audit — "Test & Publish" Skip

> Zero-trust audit determined entirely from the workflow files in
> `.github/workflows/`. Date: 2026-06-14.

## 1. Root cause (determined, not assumed)

The `test-and-publish` job in `.github/workflows/ci-cd.yml` is gated by a
**job-level conditional**:

```yaml
test-and-publish:
  name: Test & Publish
  needs: [build-and-test, migration-integration]
  if: startsWith(github.ref, 'refs/tags/v')   # ← the gate
```

On a **branch push**, `github.ref` is `refs/heads/<branch>` (e.g.
`refs/heads/main`). `startsWith('refs/heads/main', 'refs/tags/v')` is **false**,
so GitHub marks the job **skipped**.

**This is correct, intended behaviour — not a defect.** Publishing to npm is
deliberately restricted to semver tag pushes (`v*.*.*`). It is *not* caused by:
- branch filters (the workflow's `push.branches` includes `main`/`develop`),
- path filters (the `push` trigger for ci-cd.yml has none),
- environment protection rules (**none** are configured on the job),
- missing secrets (`NPM_TOKEN` is present and worked — `1.0.8` just published),
- `needs:` dependencies (those jobs succeed on branch pushes).

It is solely the `if: startsWith(github.ref, 'refs/tags/v')` gate. Proof: the
v1.0.8 **tag** push ran `test-and-publish` to completion and published with
provenance; branch pushes correctly skip it.

## 2. Current behavior — all 23 workflows

"Branch push" = a non-main feature/fix branch push; "Main" = push to `main`;
"Tag" = a matching tag push.

| Workflow | Triggers | Branch push | Main | Tag |
|----------|----------|:----------:|:----:|:---:|
| ci-cd.yml | push(main,develop,feature/**,fix/**,chore/**, tags v*.*.*), PR(main), dispatch | ✅ tests | ✅ | ✅ **publish (tag only)** |
| ci-cd-enforcement.yml | push(main,develop, tags v*), PR(main), release, dispatch | ❌ | ✅ | ✅ |
| codeql.yml | push(main), PR(main), schedule | ❌ | ✅ | ❌ |
| scorecard.yml | push(main), branch_protection_rule, schedule | ❌ | ✅ | ❌ |
| secret-scan.yml | push(main), PR, dispatch | ❌ | ✅ | ❌ |
| pages.yml | push(main, paths docs/**), dispatch | ❌ | ✅ (docs) | ❌ |
| docs-seo.yml | push(paths docs/**), PR(docs), dispatch | ✅ (docs paths) | ✅ (docs) | ❌ |
| browser-compat.yml | push(paths), PR, dispatch | ✅ (paths) | ✅ (paths) | ❌ |
| kafka-integration.yml | push(paths), PR, dispatch, schedule | ✅ (paths) | ✅ (paths) | ❌ |
| rabbitmq-integration.yml | push(paths), PR, dispatch | ✅ (paths) | ✅ (paths) | ❌ |
| provider-integration.yml | push(paths), PR, dispatch | ✅ (paths) | ✅ (paths) | ❌ |
| reference-apps.yml | push(paths), PR, dispatch | ✅ (paths) | ✅ (paths) | ❌ |
| publish-plugins.yml | push(tags plugins-v*), dispatch | ❌ | ❌ | ✅ **plugins (plugins-v* tag)** |
| dependency-review.yml | PR | ❌ | ❌ | ❌ |
| dast.yml | PR(paths), schedule, dispatch | ❌ | ❌ | ❌ |
| deploy-verify.yml | PR(paths), dispatch | ❌ | ❌ | ❌ |
| devtools-verify.yml | PR(paths), dispatch | ❌ | ❌ | ❌ |
| enterprise-verify.yml | PR(paths), dispatch | ❌ | ❌ | ❌ |
| observability.yml | PR(paths), dispatch | ❌ | ❌ | ❌ |
| platform-leadership.yml | PR(paths), schedule, dispatch | ❌ | ❌ | ❌ |
| registry-verify.yml | PR(paths), dispatch | ❌ | ❌ | ❌ |
| vendor-contract-tests.yml | schedule, dispatch | ❌ | ❌ | ❌ |
| vendor-integration.yml | schedule, dispatch | ❌ | ❌ | ❌ |

Reason column summary: most specialized suites run on **PRs with path filters**
(so feature branches are validated through their PR), plus weekly schedules.
`ci-cd.yml` is the primary gate.

## 3. Fixes applied (non-regressive)

The prompt's framing assumes the skip is a bug to "fix" so publishing happens
from `main`. **That would be a regression** — it would publish on every commit
to main, breaking semantic tag-based releases and risking accidental publishes.
The current tag-gated model already satisfies the success criteria. So instead of
breaking it, two genuine, prompt-aligned improvements were made to
`.github/workflows/ci-cd.yml`:

### Fix A — feature branches now run CI on push

```diff
   push:
-    branches: [main, develop]
+    branches: [main, develop, 'feature/**', 'fix/**', 'chore/**']
     tags: ['v*.*.*']
```

Direct pushes to `feature/**`, `fix/**`, `chore/**` now run the full
lint/typecheck/test/build/security matrix. **Publishing stays tag-gated**, so
feature branches can never publish. (Note: PRs targeting `main` already ran the
suite; this adds coverage for direct branch pushes, at the cost of extra runner
minutes — revert if that matters.)

### Fix B — Debug Context diagnostics

Added to the always-running `build-and-test` job (and to `test-and-publish`):

```yaml
- name: Debug Context
  env:
    EVENT: ${{ github.event_name }}
    REF: ${{ github.ref }}
    REF_NAME: ${{ github.ref_name }}
  run: |
    echo "Event:  $EVENT"
    echo "Ref:    $REF"
    echo "Branch/Tag: $REF_NAME"
    if [ "${REF#refs/tags/v}" != "$REF" ]; then
      echo "→ tag push: test-and-publish WILL run (publishes to npm)."
    else
      echo "→ not a vN tag: test-and-publish is correctly SKIPPED (no publish)."
    fi
```

Now any future "why was publish skipped?" is answered in the first job's log.
(Values are passed via `env:` rather than inlined into the script, to satisfy the
zizmor template-injection lint.)

### Not changed (deliberately)
- The `if: startsWith(github.ref, 'refs/tags/v')` gate stays — it is the correct
  release boundary.
- No `environment:` protection was forced (see §5 recommendation).

## 4. Publish pipeline verification (from files + registry)

| Check | Status | Evidence |
|-------|--------|----------|
| `NPM_TOKEN` present + valid | ✅ | `1.0.8` published; must be an **Automation** token (bypasses 2FA) |
| OIDC permissions for provenance | ✅ | job declares `permissions: id-token: write` |
| Provenance flag | ✅ | `npm publish --provenance --access public` |
| Provenance enforced | ✅ | "Verify published provenance attestations" gate fails if absent |
| Version ↔ tag match | ✅ | "Verify version matches tag" step + pre-push `check-tag-version.mjs` guard |
| Idempotent publish | ✅ | each publish step skips an already-published version (no `E409`) |
| Per-release SBOM | ✅ | CycloneDX SBOM generated + uploaded |
| Accidental publish from branches | ✅ prevented | tag-only `if:` gate; feature branches never reach the job |

**Publishing cannot be skipped accidentally for a real release:** a `v*.*.*` tag
push runs the job, and the version-match + provenance gates make it *fail loudly*
rather than silently skip if anything is wrong. The only "skip" is the intended
one (non-tag refs).

## 5. Security considerations

- Keep publish **tag-gated**; never publish from `main` pushes.
- `NODE_AUTH_TOKEN` is scoped to publish steps; token is an npm Automation token.
- Actions are pinned to commit SHAs; least-privilege `permissions` per job.
- **Recommended (optional, needs repo settings):** add an `environment:`
  (e.g. `npm-production`) to `test-and-publish` with required reviewers, so a
  human approves before any npm publish. Not added here because it requires
  configuring the environment + reviewers in GitHub settings, which code cannot do.

## 6. Verification steps

1. `node scripts/ci/validate-yaml.mjs` — workflow parses. ✅
2. `zizmor .github/workflows/ci-cd.yml` — no findings. ✅
3. Push to a `feature/**` branch → `build-and-test` runs, `test-and-publish`
   shows skipped with the Debug Context explaining why.
4. Push a `v*.*.*` tag → `test-and-publish` runs and publishes with provenance
   (verified end-to-end on the `v1.0.8` release).

## 7. Bottom line

The skip was **the release gate working as designed**, not a misconfiguration.
The actionable improvements are feature-branch CI coverage and self-documenting
diagnostics — both applied — while preserving the safe, deterministic,
tag-based publish model.
