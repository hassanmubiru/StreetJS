#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo ":: Validating GitHub Actions workflow files ..."

# The repository already vendors js-yaml through the Node workspace. Prefer the
# Node validator so a clean checkout does not require a globally installed
# PyYAML module; retain the Python path for environments that already provide it.
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  exec node scripts/ci/validate-yaml.mjs
fi

ERRORS=0
FILES=0
for file in .github/workflows/*.yml; do
  if [ ! -f "$file" ]; then
    continue
  fi
  FILES=$((FILES + 1))
  if python3 -c "
import yaml, sys
try:
    yaml.safe_load(open('$file'))
    sys.stdout.write('    ✓ $file\n')
except yaml.YAMLError as e:
    sys.stdout.write('    ✗ $file\n')
    sys.stdout.write(f'      {e}\n')
    sys.exit(1)
"; then
    :
  else
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
if [ "$FILES" -eq 0 ]; then
  echo "  No workflow files found."
  exit 0
fi

if [ "$ERRORS" -eq 0 ]; then
  echo "  All $FILES workflow file(s) are valid. ✓"
else
  echo "  $ERRORS / $FILES workflow file(s) are invalid." >&2
  exit 1
fi
