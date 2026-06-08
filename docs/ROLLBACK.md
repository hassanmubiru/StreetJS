# Street Framework — Rollback Strategy

This document covers the complete rollback procedure for a bad release of
`@streetjs/core` or `@streetjs/cli`.

---

## Severity classification

| Severity | Description | Action |
|---|---|---|
| **P0** | CLI crashes on install or `street create` produces broken output | Immediate deprecate + dist-tag rollback |
| **P1** | Generated project fails TypeScript compilation or `npm install` | Deprecate within 1 hour |
| **P2** | Specific command broken (e.g. `street generate`) | Deprecate, patch release within 24h |
| **P3** | Documentation or cosmetic issue | Patch release, no deprecation needed |

---

## Step 1 — Deprecate the broken version

Deprecation adds a warning to `npm install` output but does **not** remove the
package. Users who have already installed it are warned on next install.

```bash
# Replace X.Y.Z with the broken version
BROKEN=1.0.5
GOOD=1.0.4

npm deprecate "@streetjs/core@$BROKEN" \
  "Critical bug in v$BROKEN — please upgrade to v$GOOD or later"

npm deprecate "@streetjs/cli@$BROKEN" \
  "Critical bug in v$BROKEN — please upgrade to v$GOOD or later"
```

Verify deprecation:
```bash
npm view "@streetjs/core@$BROKEN" deprecated
npm view "@streetjs/cli@$BROKEN"  deprecated
```

---

## Step 2 — Restore the previous dist-tag

The `latest` dist-tag controls what `npm install @streetjs/cli` (without a
version) installs. Point it back to the last known-good version.

```bash
npm dist-tag add "@streetjs/core@$GOOD" latest
npm dist-tag add "@streetjs/cli@$GOOD"  latest
```

Verify:
```bash
npm view @streetjs/core dist-tags.latest   # → 1.0.4
npm view @streetjs/cli  dist-tags.latest   # → 1.0.4
```

---

## Step 3 — Notify users (if P0/P1)

Post a GitHub issue titled `[HOTFIX] v$BROKEN — known issue, use v$GOOD`:

```markdown
## Issue

v$BROKEN contains a critical bug: [describe the bug].

## Workaround

Downgrade to the last stable version:

```bash
npm install -g @streetjs/cli@$GOOD
```

Or pin in your project:

```bash
npm install @streetjs/core@$GOOD
```

## Fix

A patch release v$PATCH will be published shortly.
```

---

## Step 4 — Prepare and publish a patch fix

```bash
# 1. Fix the bug on main
git checkout main
# ... make the fix ...

# 2. Run validation
./scripts/validate-publish.sh

# 3. Release patch
./scripts/release.sh patch

# Or manually:
NEW=1.0.6
# bump versions, rebuild, publish (see RELEASE_CHECKLIST.md)
```

---

## Step 5 — Un-deprecate (optional)

Once the fix is published and verified, you may optionally un-deprecate the
broken version (though it is usually better to leave the deprecation warning):

```bash
# Only do this if you are certain the version is safe
npm deprecate "@streetjs/core@$BROKEN" ""
npm deprecate "@streetjs/cli@$BROKEN"  ""
```

---

## npm package removal (last resort)

npm only allows package removal within **72 hours** of publish and only if the
package has fewer than 300 downloads. After that, you can only deprecate.

```bash
# Only within 72h of publish, < 300 downloads:
npm unpublish "@streetjs/core@$BROKEN"
npm unpublish "@streetjs/cli@$BROKEN"
```

**Do not unpublish** if the package has been downloaded — it breaks existing
installs. Deprecation is always the correct approach.

---

## Rollback verification

After completing the rollback:

```bash
GOOD=1.0.4

# Verify dist-tags
npm view @streetjs/core dist-tags.latest   # → $GOOD
npm view @streetjs/cli  dist-tags.latest   # → $GOOD

# Verify deprecation on broken version
npm view "@streetjs/core@$BROKEN" deprecated

# Install good version and test
npm install -g "@streetjs/cli@$GOOD"
street --version   # → street v$GOOD

mkdir /tmp/rollback-verify && cd /tmp/rollback-verify
street create rollback-test
cd rollback-test
npm install
npx tsc --noEmit   # must exit 0
```

---

## Preventing future rollbacks

1. Always run `./scripts/validate-publish.sh` before publishing
2. Use `./scripts/release.sh patch --dry-run` to preview changes
3. Let CI publish via tag push — the workflow validates before publishing
4. Never publish directly from a dirty working tree
5. Never skip the smoke test (`street create` validation)
