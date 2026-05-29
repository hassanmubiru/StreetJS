#!/usr/bin/env bash
# scripts/release.sh
# ─────────────────────────────────────────────────────────────────────────────
# Street framework — production release script
#
# Usage:
#   ./scripts/release.sh patch          # 1.0.4 → 1.0.5
#   ./scripts/release.sh minor          # 1.0.4 → 1.1.0
#   ./scripts/release.sh major          # 1.0.4 → 2.0.0
#   ./scripts/release.sh patch --dry-run
#   ./scripts/release.sh patch --skip-tests
#
# What it does (in order):
#   1.  Validates environment (node, npm, git clean working tree)
#   2.  Runs full test suite (unless --skip-tests)
#   3.  Bumps @streetjs/core version
#   4.  Bumps @streetjs/cli version to match
#   5.  Updates @streetjs/cli dependency on @streetjs/core
#   6.  Updates VERSION constant in packages/cli/src/index.ts
#   7.  Updates scaffolded @streetjs/core version in create.ts template
#   8.  Rebuilds both packages
#   9.  Validates npm pack output for both packages
#   10. Runs street create smoke test
#   11. Commits version bump
#   12. Creates annotated git tag
#   13. Publishes @streetjs/core then @streetjs/cli
#   14. Prints post-publish verification instructions
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[release]${RESET} $*"; }
success() { echo -e "${GREEN}[release] ✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}[release] ⚠${RESET} $*"; }
error()   { echo -e "${RED}[release] ✖${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──────────────────────────────────────────${RESET}"; }

# ── Argument parsing ─────────────────────────────────────────────────────────
BUMP_TYPE="${1:-}"
DRY_RUN=false
SKIP_TESTS=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=true ;;
    --skip-tests)  SKIP_TESTS=true ;;
  esac
done

[[ "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]] || \
  error "Usage: $0 <patch|minor|major> [--dry-run] [--skip-tests]"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$REPO_ROOT/packages/core"
CLI_DIR="$REPO_ROOT/packages/cli"

# ── Step 1: Environment validation ───────────────────────────────────────────
step "Validating environment"

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
info "Node: $NODE_VER  npm: $NPM_VER"

node -e "const [,, minor] = process.version.replace('v','').split('.').map(Number); if(minor < 20) process.exit(1)" \
  || error "Node.js >= 20 required (got $NODE_VER)"

# Verify npm is authenticated
if ! npm whoami --registry https://registry.npmjs.org 2>/dev/null; then
  error "Not logged in to npm. Run: npm login"
fi
NPM_USER=$(npm whoami --registry https://registry.npmjs.org)
info "Logged in as: $NPM_USER"

# Verify git working tree is clean
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  error "Working tree is not clean. Commit or stash changes before releasing."
fi
CURRENT_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
info "Branch: $CURRENT_BRANCH"
success "Environment OK"

# ── Step 2: Test suite ───────────────────────────────────────────────────────
step "Running test suite"

if [[ "$SKIP_TESTS" == true ]]; then
  warn "Skipping tests (--skip-tests)"
else
  info "Building core..."
  npm run build -w packages/core
  info "Building CLI..."
  npm run build -w packages/cli
  info "Running CLI tests..."
  npm run test -w packages/cli
  success "All tests passed"
fi

# ── Step 3: Compute new version ──────────────────────────────────────────────
step "Computing version bump ($BUMP_TYPE)"

CURRENT_CORE=$(node -p "require('$CORE_DIR/package.json').version")
info "Current @streetjs/core: $CURRENT_CORE"

# Compute new version using semver arithmetic
NEW_VERSION=$(node -e "
  const [major, minor, patch] = '$CURRENT_CORE'.split('.').map(Number);
  const type = '$BUMP_TYPE';
  if (type === 'major') console.log((major+1) + '.0.0');
  else if (type === 'minor') console.log(major + '.' + (minor+1) + '.0');
  else console.log(major + '.' + minor + '.' + (patch+1));
")

info "New version: $NEW_VERSION"

if [[ "$DRY_RUN" == true ]]; then
  warn "DRY RUN — no files will be modified or published"
fi

# ── Step 4: Bump package versions ────────────────────────────────────────────
step "Bumping package versions to $NEW_VERSION"

if [[ "$DRY_RUN" == false ]]; then
  # Bump core version
  node -e "
    const fs = require('fs');
    const path = '$CORE_DIR/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEW_VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  success "@streetjs/core → $NEW_VERSION"

  # Bump CLI version and update its core dependency
  node -e "
    const fs = require('fs');
    const path = '$CLI_DIR/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$NEW_VERSION';
    pkg.dependencies['@streetjs/core'] = '^$NEW_VERSION';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
  success "@streetjs/cli → $NEW_VERSION"

  # Update VERSION constant in CLI source
  sed -i "s/const VERSION = '[^']*'/const VERSION = '$NEW_VERSION'/" \
    "$CLI_DIR/src/index.ts"
  success "Updated VERSION constant in src/index.ts"

  # Update scaffolded @streetjs/core version in create.ts
  sed -i "s/'@streetjs\/core': '\^[^']*'/'@streetjs\/core': '^\^$NEW_VERSION'/" \
    "$CLI_DIR/src/commands/create.ts" 2>/dev/null || true
  # More robust: use node for the create.ts template update
  node -e "
    const fs = require('fs');
    const path = '$CLI_DIR/src/commands/create.ts';
    let src = fs.readFileSync(path, 'utf8');
    src = src.replace(
      /'@streetjs\/core': '\^[0-9]+\.[0-9]+\.[0-9]+'/g,
      \"'@streetjs/core': '^\$NEW_VERSION'\"
    );
    fs.writeFileSync(path, src);
  " NEW_VERSION="$NEW_VERSION"
  success "Updated scaffolded @streetjs/core version in create.ts"
fi

# ── Step 5: Rebuild both packages ────────────────────────────────────────────
step "Rebuilding packages"

if [[ "$DRY_RUN" == false ]]; then
  npm run clean -w packages/core
  npm run build -w packages/core
  success "@streetjs/core built"

  npm run clean -w packages/cli
  npm run build -w packages/cli
  success "@streetjs/cli built"
fi

# ── Step 6: Validate pack output ─────────────────────────────────────────────
step "Validating npm pack output"

validate_pack() {
  local pkg_dir="$1"
  local pkg_name="$2"
  local pack_output
  pack_output=$(npm pack --dry-run 2>&1 "$pkg_dir" || npm pack --dry-run --prefix "$pkg_dir" 2>&1)

  # Run from the package directory
  pack_output=$(cd "$pkg_dir" && npm pack --dry-run 2>&1)

  info "Checking $pkg_name pack..."

  # Must not contain test files
  if echo "$pack_output" | grep -q 'dist/tests/'; then
    error "$pkg_name pack contains dist/tests/ — test files must not be published"
  fi
  if echo "$pack_output" | grep -q 'dist/src/'; then
    error "$pkg_name pack contains dist/src/ — stale build artifact must not be published"
  fi

  # Must contain dist files
  if ! echo "$pack_output" | grep -q 'dist/'; then
    error "$pkg_name pack is missing dist/ files"
  fi

  success "$pkg_name pack is clean"
}

validate_pack "$CORE_DIR" "@streetjs/core"
validate_pack "$CLI_DIR"  "@streetjs/cli"

# CLI-specific: must have bin and templates
CLI_PACK=$(cd "$CLI_DIR" && npm pack --dry-run 2>&1)
echo "$CLI_PACK" | grep -q 'bin/street.js'   || error "CLI pack missing bin/street.js"
echo "$CLI_PACK" | grep -q 'templates/'       || error "CLI pack missing templates/"
success "CLI bin and templates present in pack"

# ── Step 7: Smoke test — street create ───────────────────────────────────────
step "Smoke test: street create"

SMOKE_DIR=$(mktemp -d)
trap 'rm -rf "$SMOKE_DIR"' EXIT

if [[ "$DRY_RUN" == false ]]; then
  # Re-link the updated CLI globally
  (cd "$CLI_DIR" && npm link 2>/dev/null)

  (cd "$SMOKE_DIR" && street create smoke-test 2>&1)

  # Validate generated structure
  REQUIRED_PATHS=(
    "smoke-test/package.json"
    "smoke-test/tsconfig.json"
    "smoke-test/Dockerfile"
    "smoke-test/street.config.ts"
    "smoke-test/README.md"
    "smoke-test/src/main.ts"
    "smoke-test/src/controllers"
    "smoke-test/src/services"
    "smoke-test/src/repositories"
    "smoke-test/src/middleware"
    "smoke-test/src/gateways"
    "smoke-test/migrations"
    "smoke-test/uploads"
    "smoke-test/tests"
  )

  for rel_path in "${REQUIRED_PATHS[@]}"; do
    if [[ ! -e "$SMOKE_DIR/$rel_path" ]]; then
      error "Smoke test: missing $rel_path in generated project"
    fi
  done
  success "street create smoke-test generated all required paths"
fi

# ── Step 8: Commit and tag ────────────────────────────────────────────────────
step "Committing version bump and creating git tag"

if [[ "$DRY_RUN" == false ]]; then
  git -C "$REPO_ROOT" add \
    packages/core/package.json \
    packages/cli/package.json \
    packages/cli/src/index.ts \
    packages/cli/src/commands/create.ts

  git -C "$REPO_ROOT" commit -m "chore: release v$NEW_VERSION

- @streetjs/core@$NEW_VERSION
- @streetjs/cli@$NEW_VERSION"

  git -C "$REPO_ROOT" tag -a "v$NEW_VERSION" -m "Release v$NEW_VERSION"
  success "Created tag v$NEW_VERSION"
fi

# ── Step 9: Publish ───────────────────────────────────────────────────────────
step "Publishing to npm"

if [[ "$DRY_RUN" == false ]]; then
  info "Publishing @streetjs/core@$NEW_VERSION..."
  (cd "$CORE_DIR" && npm publish --access public)
  success "@streetjs/core@$NEW_VERSION published"

  info "Publishing @streetjs/cli@$NEW_VERSION..."
  (cd "$CLI_DIR" && npm publish --access public)
  success "@streetjs/cli@$NEW_VERSION published"

  info "Pushing commit and tag to origin..."
  git -C "$REPO_ROOT" push origin "$CURRENT_BRANCH"
  git -C "$REPO_ROOT" push origin "v$NEW_VERSION"
  success "Pushed v$NEW_VERSION to origin"
else
  warn "DRY RUN — skipping publish and git push"
  info "Would publish: @streetjs/core@$NEW_VERSION"
  info "Would publish: @streetjs/cli@$NEW_VERSION"
fi

# ── Step 10: Post-publish instructions ───────────────────────────────────────
step "Post-publish verification"

echo ""
echo -e "${BOLD}Run these commands to verify the published packages:${RESET}"
echo ""
echo "  # Install the new CLI globally"
echo "  npm install -g @streetjs/cli@$NEW_VERSION"
echo ""
echo "  # Verify version"
echo "  street --version"
echo "  # Expected: street v$NEW_VERSION"
echo ""
echo "  # Create a test project"
echo "  mkdir /tmp/street-verify && cd /tmp/street-verify"
echo "  street create production-test"
echo "  cd production-test"
echo "  npm install"
echo "  npx tsc --noEmit"
echo ""
echo "  # Verify npm registry"
echo "  npm view @streetjs/core@$NEW_VERSION version"
echo "  npm view @streetjs/cli@$NEW_VERSION version"
echo ""
echo -e "${GREEN}Release v$NEW_VERSION complete.${RESET}"
