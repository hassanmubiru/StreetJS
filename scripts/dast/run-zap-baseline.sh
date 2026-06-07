#!/usr/bin/env bash
# scripts/dast/run-zap-baseline.sh
# OWASP ZAP baseline + OpenAPI API scan against a live target, emitting a JSON
# report that is then graded by scripts/dast/evaluate-gate.mjs (fails the build
# on High/Critical with a deterministic exit code).
#
# Requires: docker (pulls ghcr.io/zaproxy/zaproxy:stable) and a running target.
# Usage:
#   BASE_URL=http://127.0.0.1:8080 [SPEC=openapi.json] scripts/dast/run-zap-baseline.sh
set -euo pipefail

BASE_URL="${BASE_URL:?BASE_URL is required}"
SPEC="${SPEC:-openapi.json}"
REPORT_DIR="${REPORT_DIR:-dast-reports}"
FAIL_ON="${FAIL_ON:-high}"
mkdir -p "$REPORT_DIR"

# 1) Passive baseline scan.
docker run --rm --network host -v "$PWD/$REPORT_DIR:/zap/wrk:rw" \
  ghcr.io/zaproxy/zaproxy:stable zap-baseline.py \
  -t "$BASE_URL" -J zap-baseline.json -I || true   # -I: don't fail; we grade via the gate

# 2) OpenAPI-driven active API scan (if a spec is present).
if [[ -f "$SPEC" ]]; then
  cp "$SPEC" "$REPORT_DIR/openapi.json"
  docker run --rm --network host -v "$PWD/$REPORT_DIR:/zap/wrk:rw" \
    ghcr.io/zaproxy/zaproxy:stable zap-api-scan.py \
    -t /zap/wrk/openapi.json -f openapi -J zap-api.json -I || true
fi

# 3) Grade every produced report through the deterministic severity gate.
EXIT=0
for r in "$REPORT_DIR"/zap-baseline.json "$REPORT_DIR"/zap-api.json; do
  if [[ -f "$r" ]]; then
    node scripts/dast/evaluate-gate.mjs --zap "$r" --fail-on "$FAIL_ON" --out "${r%.json}.gate.json" || EXIT=$?
  fi
done
exit "$EXIT"
