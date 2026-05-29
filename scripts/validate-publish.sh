#!/usr/bin/env bash
# scripts/validate-publish.sh
# ─────────────────────────────────────────────────────────────────────────────
# Pre-publish validation script — runs all checks without publishing.
# Safe to run at any time. Exit code 0 = ready to publish.
#
# Usage:
#   ./scripts/validate-publish.sh
#   ./scripts/validate-publish.sh --verbose
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

PASS=0; FAIL=0; WARN=0
VERBOSE=false
[[ "${1:-}" == "--verbose" ]] && VERBOSE=true

check()  { echo -e "  ${CYAN}▸${RESET} $*"; }
pass()   { echo -e "  ${GREEN}✔${RESET} $*"; PASS=$((PASS + 1)); }
fail()   { echo -e "  ${RED}✖${RESET} $*"; FAIL=$((FAIL + 1)); }
warn()   { echo -e "  ${YELLOW}⚠${RESET} $*"; WARN=$((WARN + 1)); }
section(){ echo -e "\n${BOLD}$*${RESET}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CORE_DIR="$REPO_ROOT/packages/core"
CLI_DIR="$REPO_ROOT/packages/cli"

# ── 1. Build validation ───────────────────────────────────────────────────────
section "1. Build validation"

check "Building @streetjs/core..."
if npm run build -w packages/core --silent 2>/dev/null; then
  pass "@streetjs/core builds successfully"
else
  fail "@streetjs/core build FAILED"
fi

check "Building @streetjs/cli..."
if npm run build -w packages/cli --silent 2>/dev/null; then
  pass "@streetjs/cli builds successfully"
else
  fail "@streetjs/cli build FAILED"
fi

# ── 2. TypeScript strict check ────────────────────────────────────────────────
section "2. TypeScript strict compilation"

check "Running tsc --noEmit on core (lib config)..."
if (cd "$CORE_DIR" && npx tsc -p tsconfig.lib.json --noEmit 2>/dev/null); then
  pass "Core strict TypeScript: OK"
else
  fail "Core strict TypeScript: FAILED"
fi

check "Running tsc --noEmit on CLI..."
if (cd "$CLI_DIR" && npx tsc --noEmit 2>/dev/null); then
  pass "CLI strict TypeScript: OK"
else
  fail "CLI strict TypeScript: FAILED"
fi

# ── 3. ESM / NodeNext import validation ──────────────────────────────────────
section "3. NodeNext ESM import validation"

check "Checking core dist/index.js is valid ESM..."
if node --input-type=module <<< "import { streetApp } from '$CORE_DIR/dist/index.js'; console.log(typeof streetApp);" 2>/dev/null | grep -q 'function'; then
  pass "Core ESM import: OK"
else
  fail "Core ESM import: FAILED"
fi

check "Checking CLI dist/index.js is valid ESM..."
if node --input-type=module <<< "import { runCli } from '$CLI_DIR/dist/index.js'; console.log(typeof runCli);" 2>/dev/null | grep -q 'function'; then
  pass "CLI ESM import: OK"
else
  fail "CLI ESM import: FAILED"
fi

# ── 4. bin/street.js validation ───────────────────────────────────────────────
section "4. bin/street.js validation"

BIN_FILE="$CLI_DIR/bin/street.js"

check "bin/street.js exists..."
if [[ -f "$BIN_FILE" ]]; then
  pass "bin/street.js exists"
else
  fail "bin/street.js MISSING"
fi

check "bin/street.js has shebang..."
if head -1 "$BIN_FILE" | grep -q '#!/usr/bin/env node'; then
  pass "bin/street.js has #!/usr/bin/env node"
else
  fail "bin/street.js missing shebang"
fi

check "bin/street.js is executable..."
if [[ -x "$BIN_FILE" ]]; then
  pass "bin/street.js is executable"
else
  fail "bin/street.js is NOT executable"
fi

check "bin/street.js imports dist/index.js..."
if grep -q 'dist/index.js' "$BIN_FILE"; then
  pass "bin/street.js imports ../dist/index.js"
else
  fail "bin/street.js does not import dist/index.js"
fi

check "bin/street.js runs correctly..."
if node "$BIN_FILE" --version 2>/dev/null | grep -q 'street v'; then
  pass "bin/street.js --version: OK"
else
  fail "bin/street.js --version: FAILED"
fi

# ── 5. package.json field validation ─────────────────────────────────────────
section "5. package.json field validation"

check "CLI bin field..."
BIN_VAL=$(node -p "require('$CLI_DIR/package.json').bin?.street" 2>/dev/null)
if [[ "$BIN_VAL" == "./bin/street.js" ]]; then
  pass "CLI bin.street = ./bin/street.js"
else
  fail "CLI bin.street = '$BIN_VAL' (expected ./bin/street.js)"
fi

check "CLI files includes bin/street.js..."
if node -e "const f=require('$CLI_DIR/package.json').files; process.exit(f.some(x=>x.includes('bin/street.js'))?0:1)" 2>/dev/null; then
  pass "CLI files includes bin/street.js"
else
  fail "CLI files does NOT include bin/street.js"
fi

check "CLI files includes templates..."
if node -e "const f=require('$CLI_DIR/package.json').files; process.exit(f.some(x=>x.includes('templates'))?0:1)" 2>/dev/null; then
  pass "CLI files includes templates/**/*"
else
  fail "CLI files does NOT include templates"
fi

check "Core type=module..."
if node -p "require('$CORE_DIR/package.json').type" 2>/dev/null | grep -q 'module'; then
  pass "Core type=module"
else
  fail "Core type is not module"
fi

check "CLI type=module..."
if node -p "require('$CLI_DIR/package.json').type" 2>/dev/null | grep -q 'module'; then
  pass "CLI type=module"
else
  fail "CLI type is not module"
fi

# ── 6. templates folder validation ───────────────────────────────────────────
section "6. Templates folder validation"

check "templates/generate/ exists..."
if [[ -d "$CLI_DIR/templates/generate" ]]; then
  pass "templates/generate/ exists"
else
  fail "templates/generate/ MISSING"
fi

check "templates/migration/ exists..."
if [[ -d "$CLI_DIR/templates/migration" ]]; then
  pass "templates/migration/ exists"
else
  fail "templates/migration/ MISSING"
fi

for tpl in controller.ts.hbs service.ts.hbs repository.ts.hbs; do
  check "templates/generate/$tpl..."
  if [[ -f "$CLI_DIR/templates/generate/$tpl" ]]; then
    pass "templates/generate/$tpl exists"
  else
    fail "templates/generate/$tpl MISSING"
  fi
done

# ── 7. npm pack validation ────────────────────────────────────────────────────
section "7. npm pack validation"

check "Packing @streetjs/core..."
CORE_PACK=$(cd "$CORE_DIR" && npm pack --dry-run 2>&1)

if echo "$CORE_PACK" | grep -q 'dist/tests/'; then
  fail "Core pack contains dist/tests/ (test files must not be published)"
else
  pass "Core pack: no dist/tests/ files"
fi

if echo "$CORE_PACK" | grep -q 'dist/src/'; then
  fail "Core pack contains dist/src/ (stale build artifact)"
else
  pass "Core pack: no dist/src/ duplication"
fi

if echo "$CORE_PACK" | grep -q 'dist/index.js'; then
  pass "Core pack: dist/index.js present"
else
  fail "Core pack: dist/index.js MISSING"
fi

check "Packing @streetjs/cli..."
CLI_PACK=$(cd "$CLI_DIR" && npm pack --dry-run 2>&1)

if echo "$CLI_PACK" | grep -q 'dist/tests/'; then
  fail "CLI pack contains dist/tests/ (test files must not be published)"
else
  pass "CLI pack: no dist/tests/ files"
fi

if echo "$CLI_PACK" | grep -q 'bin/street.js'; then
  pass "CLI pack: bin/street.js present"
else
  fail "CLI pack: bin/street.js MISSING"
fi

if echo "$CLI_PACK" | grep -q 'templates/'; then
  pass "CLI pack: templates/ present"
else
  fail "CLI pack: templates/ MISSING"
fi

# ── 8. street create smoke test ───────────────────────────────────────────────
section "8. street create smoke test"

SMOKE_DIR=$(mktemp -d)
trap 'rm -rf "$SMOKE_DIR"' EXIT

check "Linking CLI globally..."
(cd "$CLI_DIR" && npm link 2>/dev/null) && pass "npm link OK" || fail "npm link FAILED"

check "Running: street create smoke-test..."
if (cd "$SMOKE_DIR" && street create smoke-test 2>&1 >/dev/null); then
  pass "street create smoke-test: OK"
else
  fail "street create smoke-test: FAILED"
fi

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
  if [[ -e "$SMOKE_DIR/$rel_path" ]]; then
    pass "Generated: $rel_path"
  else
    fail "Missing:   $rel_path"
  fi
done

# ── 9. CLI test suite ─────────────────────────────────────────────────────────
section "9. CLI test suite"

check "Running npm run test -w packages/cli..."
if npm run test -w packages/cli --silent 2>/dev/null; then
  pass "CLI test suite: all tests passed"
else
  fail "CLI test suite: FAILED"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}────────────────────────────────────────────────────────${RESET}"
echo -e "${BOLD}Validation Summary${RESET}"
echo -e "  ${GREEN}Passed:${RESET}  $PASS"
echo -e "  ${YELLOW}Warnings:${RESET} $WARN"
echo -e "  ${RED}Failed:${RESET}  $FAIL"
echo -e "${BOLD}────────────────────────────────────────────────────────${RESET}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "\n${RED}✖ Validation FAILED — fix the issues above before publishing.${RESET}"
  exit 1
else
  echo -e "\n${GREEN}✔ All validations passed — ready to publish.${RESET}"
  exit 0
fi
