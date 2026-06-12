#!/usr/bin/env bash
# scripts/post-publish-verify.sh
# ─────────────────────────────────────────────────────────────────────────────
# Post-publish verification — confirms both packages are live on npm and
# validates end-to-end behaviour by installing the CLI globally and running
# street create.
#
# Usage:
#   ./scripts/post-publish-verify.sh                    # auto-detect from package.json
#   ./scripts/post-publish-verify.sh 1.0.4 1.0.1       # explicit core_ver cli_ver
#   ./scripts/post-publish-verify.sh 1.0.4              # core only (cli auto-detected)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[verify]${RESET} $*"; }
success() { echo -e "${GREEN}[verify] ✔${RESET} $*"; }
warn()    { echo -e "${YELLOW}[verify] ⚠${RESET} $*"; }
error()   { echo -e "${RED}[verify] ✖${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──────────────────────────────────────────${RESET}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Auto-detect versions from local package.json if not supplied
CORE_VERSION="${1:-$(node -p "require('$REPO_ROOT/packages/core/package.json').version")}"
CLI_VERSION="${2:-$(node -p "require('$REPO_ROOT/packages/cli/package.json').version")}"

info "Verifying @streetjs/core@$CORE_VERSION"
info "Verifying @streetjs/cli@$CLI_VERSION"

# ── 1. Poll registry for both packages ───────────────────────────────────────
step "Waiting for npm registry propagation"

poll_package() {
  local pkg="$1"
  local ver="$2"
  local max_wait=120
  local interval=10
  local elapsed=0

  info "Polling for ${pkg}@${ver}..."
  while true; do
    local found
    found=$(npm view "${pkg}@${ver}" version 2>/dev/null || true)
    if [[ "$found" == "$ver" ]]; then
      success "${pkg}@${ver} is available on npm"
      return 0
    fi
    if [[ $elapsed -ge $max_wait ]]; then
      error "${pkg}@${ver} not available after ${max_wait}s — registry may be slow. Retry: npm view ${pkg}@${ver} version"
    fi
    info "Not yet available, waiting ${interval}s... (${elapsed}s elapsed)"
    sleep $interval
    elapsed=$((elapsed + interval))
  done
}

poll_package "@streetjs/core" "$CORE_VERSION"
poll_package "@streetjs/cli"  "$CLI_VERSION"

# ── 2. Verify dist-tags ───────────────────────────────────────────────────────
step "Verifying dist-tags"

for entry in "@streetjs/core:$CORE_VERSION" "@streetjs/cli:$CLI_VERSION"; do
  pkg="${entry%%:*}"
  ver="${entry##*:}"
  latest=$(npm view "$pkg" dist-tags.latest 2>/dev/null || true)
  if [[ "$latest" == "$ver" ]]; then
    success "${pkg} dist-tag latest = $ver"
  else
    warn "${pkg} dist-tag latest = $latest (expected $ver)"
    warn "To fix: npm dist-tag add ${pkg}@${ver} latest"
  fi
done

# ── 3. Verify pack contents from registry ────────────────────────────────────
step "Verifying published pack contents"

check_pack_contents() {
  local pkg="$1"
  local ver="$2"
  local pack_info
  pack_info=$(npm pack "${pkg}@${ver}" --dry-run --json 2>/dev/null || true)

  if [[ -z "$pack_info" ]]; then
    warn "Could not fetch pack info for ${pkg}@${ver} (npm pack --json not supported on this npm version)"
    return 0
  fi

  # Check for test file pollution
  if echo "$pack_info" | grep -q 'dist/tests/'; then
    error "${pkg}@${ver} contains dist/tests/ — test files were published"
  fi
  if echo "$pack_info" | grep -q 'dist/src/'; then
    error "${pkg}@${ver} contains dist/src/ — stale build artifact was published"
  fi
  success "${pkg}@${ver} pack contents: clean"
}

check_pack_contents "@streetjs/core" "$CORE_VERSION"
check_pack_contents "@streetjs/cli"  "$CLI_VERSION"

# ── 4. Resolve the published CLI from the registry (pinned, ephemeral) ────────
step "Resolving @streetjs/cli@$CLI_VERSION from the registry"

# Run the EXACT just-published version ephemerally via npx — no global install,
# no PATH mutation, and pinned to the precise version under test. (This also
# avoids an unpinnable `npm install -g` for a dynamically-versioned package.)
export npm_config_registry="https://registry.npmjs.org"
STREET_CLI=(npx --yes "@streetjs/cli@$CLI_VERSION")
success "Using: npx --yes @streetjs/cli@$CLI_VERSION"

# ── 5. Verify CLI version ─────────────────────────────────────────────────────
step "Verifying CLI version"

INSTALLED_VER=$("${STREET_CLI[@]}" --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "")
if [[ "$INSTALLED_VER" == "$CLI_VERSION" ]]; then
  success "street --version = $INSTALLED_VER ✔"
else
  error "street --version = '$INSTALLED_VER' (expected $CLI_VERSION)"
fi

# ── 6. Create production test project ─────────────────────────────────────────
step "Creating production-test project"

VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT

info "Working directory: $VERIFY_DIR"
(cd "$VERIFY_DIR" && "${STREET_CLI[@]}" create production-test 2>&1)
success "street create production-test: OK"

# ── 7. Validate generated structure ───────────────────────────────────────────
step "Validating generated project structure"

PROJ="$VERIFY_DIR/production-test"

REQUIRED=(
  "package.json"
  "tsconfig.json"
  "Dockerfile"
  "street.config.ts"
  "README.md"
  "src/main.ts"
  "src/controllers/example.controller.ts"
  "src/controllers/health.controller.ts"
  "src/services/example.service.ts"
  "src/repositories/example.repository.ts"
  "src/middleware/auth.ts"
  "src/gateways/chat.gateway.ts"
  "migrations/.gitkeep"
  "uploads/.gitkeep"
  "tests/integration.test.ts"
  "docker-compose.yml"
  ".env.example"
  ".gitignore"
)

ALL_OK=true
for rel in "${REQUIRED[@]}"; do
  if [[ -e "$PROJ/$rel" ]]; then
    success "  $rel"
  else
    echo -e "  ${RED}✖ MISSING: $rel${RESET}"
    ALL_OK=false
  fi
done

[[ "$ALL_OK" == true ]] || error "Generated project is missing required files"

# ── 8. Validate generated package.json ────────────────────────────────────────
step "Validating generated package.json"

# Must have @streetjs/core dependency pointing to published version
PROJ_CORE_DEP=$(node -p "require('$PROJ/package.json').dependencies['@streetjs/core']" 2>/dev/null || echo "")
if [[ -n "$PROJ_CORE_DEP" ]]; then
  success "Generated package.json has @streetjs/core: $PROJ_CORE_DEP"
else
  error "Generated package.json missing @streetjs/core dependency"
fi

# Must be ESM
PROJ_TYPE=$(node -p "require('$PROJ/package.json').type" 2>/dev/null || echo "")
if [[ "$PROJ_TYPE" == "module" ]]; then
  success "Generated package.json has type=module"
else
  error "Generated package.json missing type=module (got: $PROJ_TYPE)"
fi

# ── 9. Install dependencies in generated project ──────────────────────────────
step "Installing dependencies in generated project (npm ci, from the scaffold lockfile)"

# `street create` generated a package-lock.json, so install strictly from it
# with `npm ci` (pinned, integrity-verified) — exactly what the scaffolded
# Dockerfile does.
export npm_config_registry="https://registry.npmjs.org"
(cd "$PROJ" && npm ci 2>&1 | tail -5)
success "npm ci completed"

# Verify @streetjs/core installed version matches expected
INSTALLED_CORE=$(node -p "require('$PROJ/node_modules/@streetjs/core/package.json').version" 2>/dev/null || echo "")
if [[ "$INSTALLED_CORE" == "$CORE_VERSION" ]]; then
  success "Installed @streetjs/core = $INSTALLED_CORE ✔"
else
  warn "Installed @streetjs/core = $INSTALLED_CORE (expected $CORE_VERSION — semver range may resolve differently)"
fi

# ── 10. TypeScript compilation check ──────────────────────────────────────────
step "TypeScript compilation check"

if (cd "$PROJ" && npx tsc --noEmit 2>&1); then
  success "Generated project TypeScript: OK"
else
  error "Generated project TypeScript compilation FAILED"
fi

# ── 11. Verify CLI commands work ──────────────────────────────────────────────
step "Verifying CLI commands"

# street generate controller
(cd "$PROJ" && street generate controller users 2>&1)
if [[ -f "$PROJ/src/controllers/users.controller.ts" ]]; then
  success "street generate controller users: OK"
else
  error "street generate controller users: file not created"
fi

# street generate service
(cd "$PROJ" && street generate service users 2>&1)
if [[ -f "$PROJ/src/services/users.service.ts" ]]; then
  success "street generate service users: OK"
else
  error "street generate service users: file not created"
fi

# street generate repository
(cd "$PROJ" && street generate repository users 2>&1)
if [[ -f "$PROJ/src/repositories/users.repository.ts" ]]; then
  success "street generate repository users: OK"
else
  error "street generate repository users: file not created"
fi

# street migrate:create
(cd "$PROJ" && street migrate:create create_users_table 2>&1)
MIGRATION_COUNT=$(find "$PROJ/migrations" -name "*.sql" ! -name ".gitkeep" | wc -l)
if [[ $MIGRATION_COUNT -ge 2 ]]; then
  success "street migrate:create: OK ($MIGRATION_COUNT SQL files created)"
else
  error "street migrate:create: expected 2 SQL files, got $MIGRATION_COUNT"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  Post-publish verification PASSED                    ║${RESET}"
echo -e "${GREEN}${BOLD}╠══════════════════════════════════════════════════════╣${RESET}"
echo -e "${GREEN}${BOLD}║  @streetjs/core@${CORE_VERSION} — live on npm              ║${RESET}"
echo -e "${GREEN}${BOLD}║  @streetjs/cli@${CLI_VERSION}  — live on npm              ║${RESET}"
echo -e "${GREEN}${BOLD}║  street create  — generates correct structure        ║${RESET}"
echo -e "${GREEN}${BOLD}║  TypeScript     — compiles without errors            ║${RESET}"
echo -e "${GREEN}${BOLD}║  CLI commands   — generate, migrate:create OK        ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  npm view @streetjs/core@$CORE_VERSION"
echo "  npm view @streetjs/cli@$CLI_VERSION"
echo "  street --version  # → street v$CLI_VERSION"
