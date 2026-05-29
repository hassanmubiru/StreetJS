#!/usr/bin/env bash
# scripts/post-publish-verify.sh
# ─────────────────────────────────────────────────────────────────────────────
# Post-publish verification — installs the just-published packages from the
# real npm registry and validates end-to-end behaviour.
#
# Usage:
#   ./scripts/post-publish-verify.sh 1.0.4
#   ./scripts/post-publish-verify.sh          # auto-detects from package.json
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${CYAN}[verify]${RESET} $*"; }
success() { echo -e "${GREEN}[verify] ✔${RESET} $*"; }
error()   { echo -e "${RED}[verify] ✖${RESET} $*" >&2; exit 1; }
step()    { echo -e "\n${BOLD}── $* ──────────────────────────────────────────${RESET}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VERSION="${1:-$(node -p "require('$REPO_ROOT/packages/cli/package.json').version")}"
info "Verifying @streetjs/cli@$VERSION and @streetjs/core@$VERSION"

# ── 1. Wait for registry propagation ─────────────────────────────────────────
step "Waiting for npm registry propagation"

MAX_WAIT=120
INTERVAL=10
ELAPSED=0

for PKG in "@streetjs/core@$VERSION" "@streetjs/cli@$VERSION"; do
  info "Polling for $PKG..."
  while true; do
    if npm view "$PKG" version 2>/dev/null | grep -q "$VERSION"; then
      success "$PKG is available on npm"
      break
    fi
    if [[ $ELAPSED -ge $MAX_WAIT ]]; then
      error "$PKG not available after ${MAX_WAIT}s — registry may be slow, retry manually"
    fi
    info "Not yet available, waiting ${INTERVAL}s... (${ELAPSED}s elapsed)"
    sleep $INTERVAL
    ELAPSED=$((ELAPSED + INTERVAL))
  done
done

# ── 2. Install CLI globally from registry ─────────────────────────────────────
step "Installing @streetjs/cli@$VERSION globally"

npm install -g "@streetjs/cli@$VERSION" --registry https://registry.npmjs.org
success "Installed @streetjs/cli@$VERSION globally"

# ── 3. Verify version ─────────────────────────────────────────────────────────
step "Verifying CLI version"

INSTALLED_VER=$(street --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "")
if [[ "$INSTALLED_VER" == "$VERSION" ]]; then
  success "street --version = $INSTALLED_VER ✔"
else
  error "street --version = '$INSTALLED_VER' (expected $VERSION)"
fi

# ── 4. Create production test project ─────────────────────────────────────────
step "Creating production-test project"

VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT

info "Working directory: $VERIFY_DIR"
(cd "$VERIFY_DIR" && street create production-test 2>&1)
success "street create production-test: OK"

# ── 5. Validate generated structure ───────────────────────────────────────────
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

# ── 6. Validate generated package.json ────────────────────────────────────────
step "Validating generated package.json"

PROJ_PKG=$(node -p "JSON.stringify(require('$PROJ/package.json'), null, 2)" 2>/dev/null)

# Must have @streetjs/core dependency
if echo "$PROJ_PKG" | grep -q '"@streetjs/core"'; then
  success "Generated package.json has @streetjs/core dependency"
else
  error "Generated package.json missing @streetjs/core dependency"
fi

# Must be ESM
if echo "$PROJ_PKG" | grep -q '"module"'; then
  success "Generated package.json has type=module"
else
  error "Generated package.json missing type=module"
fi

# ── 7. Install dependencies in generated project ──────────────────────────────
step "Installing dependencies in generated project"

(cd "$PROJ" && npm install --registry https://registry.npmjs.org 2>&1 | tail -5)
success "npm install completed"

# ── 8. TypeScript compilation check ───────────────────────────────────────────
step "TypeScript compilation check"

if (cd "$PROJ" && npx tsc --noEmit 2>&1); then
  success "Generated project TypeScript: OK"
else
  error "Generated project TypeScript compilation FAILED"
fi

# ── 9. Verify npm registry metadata ───────────────────────────────────────────
step "Verifying npm registry metadata"

for PKG in "@streetjs/core" "@streetjs/cli"; do
  PUBLISHED_VER=$(npm view "${PKG}@${VERSION}" version 2>/dev/null)
  if [[ "$PUBLISHED_VER" == "$VERSION" ]]; then
    success "npm view ${PKG}@${VERSION}: OK"
  else
    error "npm view ${PKG}@${VERSION} returned '$PUBLISHED_VER'"
  fi

  # Verify dist-tag latest points to new version
  LATEST=$(npm view "$PKG" dist-tags.latest 2>/dev/null)
  if [[ "$LATEST" == "$VERSION" ]]; then
    success "${PKG} dist-tag latest = $VERSION"
  else
    echo -e "  ${YELLOW}⚠${RESET} ${PKG} dist-tag latest = $LATEST (expected $VERSION — may need: npm dist-tag add ${PKG}@${VERSION} latest)"
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✔ Post-publish verification passed for v${VERSION}${RESET}"
echo ""
echo "  npm view @streetjs/core@$VERSION"
echo "  npm view @streetjs/cli@$VERSION"
echo "  street --version  # → street v$VERSION"
