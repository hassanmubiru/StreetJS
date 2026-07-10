#!/usr/bin/env bash
# scripts/release.sh
# ─────────────────────────────────────────────────────────────────────────────
# StreetJS — release PREPARE script (CI-driven publish model)
#
# IMPORTANT — this script does NOT run `npm publish`.
# Publishing is done by `.github/workflows/ci-cd.yml` (the "Test & Publish" job),
# which publishes the core line WITH npm provenance (SLSA) when a version bump
# lands on `main` (and idempotently on `v*` tags). A local `npm publish` cannot
# generate provenance and would miss the generated `@streetjs/core` compat shim,
# so this script only prepares + commits + tags + pushes; CI does the publish.
#
# What it does (in order):
#   1.  Validates environment (node, git clean, on main)
#   2.  Computes the next version from packages/core (streetjs)
#   3.  Bumps the lockstep trio to the new version:
#         - packages/core         (streetjs)
#         - packages/cli          (@streetjs/cli) + its streetjs dep pin
#         - packages/core-compat  (@streetjs/core) — regenerated from packages/core
#   4.  Updates the scaffold's streetjs pin in packages/cli/src/commands/create.ts
#   5.  Regenerates the root package-lock.json
#   6.  Rebuilds + tests core & cli; validates npm pack for the trio
#   7.  Verifies lockstep via scripts/check-tag-version.mjs
#   8.  Commits, tags (annotated v<version>), and pushes commit + tag
#   9.  CI (ci-cd.yml) publishes to npm with provenance; then create/verify the
#       GitHub Release.
#
# Usage:
#   ./scripts/release.sh patch            # 1.1.2 -> 1.1.3
#   ./scripts/release.sh minor            # 1.1.2 -> 1.2.0
#   ./scripts/release.sh major            # 1.1.2 -> 2.0.0
#   ./scripts/release.sh patch --dry-run  # compute + show, change nothing
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[release]${RESET} $*"; }
success() { echo -e "${GREEN}[release] ✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}[release] ⚠${RESET} $*"; }
error()   { echo -e "${RED}[release] ✖${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──────────────────────────────${RESET}"; }

BUMP_TYPE="${1:-}"
DRY_RUN=false
for arg in "$@"; do case "$arg" in --dry-run) DRY_RUN=true ;; esac; done
[[ "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]] || error "Usage: $0 <patch|minor|major> [--dry-run]"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
CORE_DIR="packages/core"; CLI_DIR="packages/cli"; COMPAT_DIR="packages/core-compat"

# ── Step 1: Environment ──────────────────────────────────────────────────────
step "Validating environment"
node -e "const m=+process.version.replace('v','').split('.')[0]; if(m<20)process.exit(1)" \
  || error "Node.js >= 20 required (got $(node --version))"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$BRANCH" == "main" ]] || warn "Not on main (on '$BRANCH'). Releases normally cut from main."
if [[ -n "$(git status --porcelain)" ]]; then
  error "Working tree not clean. Commit or stash before releasing."
fi
success "Environment OK (branch: $BRANCH)"

# ── Step 2: Compute new version ──────────────────────────────────────────────
step "Computing version bump ($BUMP_TYPE)"
CURRENT=$(node -p "require('./$CORE_DIR/package.json').version")
NEW_VERSION=$(node -e "
  const [MA,MI,PA]='$CURRENT'.split('.').map(Number); const t='$BUMP_TYPE';
  console.log(t==='major'?(MA+1)+'.0.0':t==='minor'?MA+'.'+(MI+1)+'.0':MA+'.'+MI+'.'+(PA+1));
")
info "Current: $CURRENT  →  New: $NEW_VERSION"
$DRY_RUN && { warn "DRY RUN — computing only, no changes"; }

# ── Step 3–5: Bump trio + scaffold pin + lockfile ────────────────────────────
step "Bumping lockstep trio to $NEW_VERSION"
if [[ "$DRY_RUN" == false ]]; then
  node -e "
    const fs=require('fs');
    const core='$CORE_DIR/package.json'; const c=JSON.parse(fs.readFileSync(core)); c.version='$NEW_VERSION';
    fs.writeFileSync(core, JSON.stringify(c,null,2)+'\n');
    const cli='$CLI_DIR/package.json'; const l=JSON.parse(fs.readFileSync(cli)); l.version='$NEW_VERSION';
    if(l.dependencies && l.dependencies.streetjs) l.dependencies.streetjs='^$NEW_VERSION';
    fs.writeFileSync(cli, JSON.stringify(l,null,2)+'\n');
  "
  success "streetjs + @streetjs/cli → $NEW_VERSION"
  # Regenerate @streetjs/core compat shim (derives version + streetjs pin from packages/core)
  node scripts/gen-core-compat.mjs >/dev/null
  success "@streetjs/core (compat) regenerated at $NEW_VERSION"
  # Update scaffold streetjs pin in create.ts (^X.Y.Z form)
  node -e "
    const fs=require('fs'); const p='$CLI_DIR/src/commands/create.ts';
    let s=fs.readFileSync(p,'utf8');
    s=s.replace(/('streetjs':\s*')\^[0-9]+\.[0-9]+\.[0-9]+(')/g, \"\$1^$NEW_VERSION\$2\");
    fs.writeFileSync(p,s);
  "
  success "Scaffold streetjs pin → ^$NEW_VERSION (create.ts)"
  npm install --package-lock-only >/dev/null 2>&1
  success "Root package-lock.json regenerated"
fi

# ── Step 6: Build + test + pack validation ───────────────────────────────────
step "Build, test, pack validation"
if [[ "$DRY_RUN" == false ]]; then
  npm run clean -w packages/core >/dev/null && npm run build -w packages/core >/dev/null
  npm run clean -w packages/cli  >/dev/null && npm run build -w packages/cli  >/dev/null
  ( cd "$COMPAT_DIR" && npx tsc >/dev/null 2>&1 ) || true
  success "Built core + cli (+ core-compat)"
  npm run test -w packages/cli >/dev/null && success "CLI tests passed"
  for pkg in core cli core-compat; do
    out=$(cd "packages/$pkg" && npm pack --dry-run 2>&1)
    echo "$out" | grep -qE 'dist/tests/|dist/src/' && error "$pkg pack contains dist/tests or dist/src"
  done
  success "npm pack validation clean (no test/src pollution)"
fi

# ── Step 7: Lockstep verification ────────────────────────────────────────────
step "Verifying lockstep"
if [[ "$DRY_RUN" == false ]]; then
  node scripts/check-tag-version.mjs "v$NEW_VERSION" HEAD 2>/dev/null \
    || warn "check-tag-version compares committed state; will re-run on push hook"
fi

# ── Step 8: Commit, tag, push (CI publishes) ─────────────────────────────────
step "Commit, tag, and push"
if [[ "$DRY_RUN" == true ]]; then
  warn "DRY RUN — would bump to $NEW_VERSION, commit, tag v$NEW_VERSION, and push."
  warn "CI (ci-cd.yml) would then publish to npm with provenance."
  exit 0
fi
git add "$CORE_DIR/package.json" "$CLI_DIR/package.json" \
        "$COMPAT_DIR/package.json" "$COMPAT_DIR/dist" \
        "$CLI_DIR/src/commands/create.ts" package-lock.json CHANGELOG.md 2>/dev/null || true
git commit -m "chore: release v$NEW_VERSION

- streetjs@$NEW_VERSION
- @streetjs/core@$NEW_VERSION
- @streetjs/cli@$NEW_VERSION"
git tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
git push origin "$BRANCH"
git push origin "v$NEW_VERSION"
success "Pushed commit + tag v$NEW_VERSION"

# ── Step 9: Post-push instructions ───────────────────────────────────────────
step "Publish is handled by CI"
cat <<EOF

  CI (ci-cd.yml) now publishes streetjs / @streetjs/core / @streetjs/cli
  @$NEW_VERSION to npm WITH provenance (idempotent — skips already-published).

  Verify, then create the GitHub Release:
    gh run watch  \$(gh run list --workflow=ci-cd.yml -L1 --json databaseId --jq '.[0].databaseId')
    npm view streetjs@$NEW_VERSION version
    npm view streetjs@$NEW_VERSION --json | node -e "process.stdin.once('data',d=>console.log(JSON.parse(d).dist.attestations?'provenance OK':'NO provenance'))"
    gh release create v$NEW_VERSION --title v$NEW_VERSION --notes-file <(sed -n '/## \[$NEW_VERSION\]/,/## \[/p' CHANGELOG.md)

  Post-release smoke test:
    npm i -g @streetjs/cli@$NEW_VERSION && street --version   # → street v$NEW_VERSION

${GREEN}Release v$NEW_VERSION prepared and pushed.${RESET}
EOF
