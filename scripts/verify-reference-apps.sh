#!/usr/bin/env bash
# Run every StreetJS reference-app smoke test. Exits non-zero if any fails.
# Assumes the workspace packages are built (npm run build + the @streetjs/*
# packages the apps import).
set -uo pipefail
cd "$(dirname "$0")/.."

APPS=(realtime-chat ai-assistant ecommerce saas dating)
fail=0
for app in "${APPS[@]}"; do
  echo "── reference-app: ${app} ─────────────────────────────"
  if node "examples/reference-apps/${app}/smoke-test.mjs"; then
    echo "   PASS ${app}"
  else
    echo "   FAIL ${app}"
    fail=1
  fi
  echo ""
done

if [ "$fail" -eq 0 ]; then
  echo "All reference-app smoke tests passed."
else
  echo "One or more reference-app smoke tests FAILED."
fi
exit "$fail"
