#!/usr/bin/env bash
# scripts/dast/run-schemathesis.sh
# Property-based DAST against a live app using its generated OpenAPI spec.
# Fails on schema violations, server errors (5xx), and crashes. Supports an
# optional bearer token for authenticated scans.
#
# Requires: schemathesis (pip install schemathesis) and a running target.
# Usage:
#   SPEC=openapi.json BASE_URL=http://127.0.0.1:8080 [TOKEN=...] scripts/dast/run-schemathesis.sh
set -euo pipefail

SPEC="${SPEC:-openapi.json}"
BASE_URL="${BASE_URL:?BASE_URL is required}"
REPORT_DIR="${REPORT_DIR:-dast-reports}"
mkdir -p "$REPORT_DIR"

AUTH_ARGS=()
if [[ -n "${TOKEN:-}" ]]; then
  AUTH_ARGS+=(--header "Authorization: Bearer ${TOKEN}")
fi

# CLI compatibility across schemathesis major versions:
#   • 3.x : base URL = `--base-url`, example cap = `--hypothesis-max-examples`,
#           JUnit = `--junit-xml PATH`, OpenAPI 3.1 needs `--experimental=openapi-3.1`.
#   • 4.x : base URL = `--url`, example cap = `--max-examples`, JUnit =
#           `--report junit --report-junit-path PATH`, OpenAPI 3.1 is native
#           (the `--experimental` flag was removed).
# dast/requirements.txt pins 4.21.5, but we detect flags from `--help` so the
# script stays correct on either line and never aborts with a CLI usage error
# (which the DAST orchestrator would otherwise mis-grade as a High finding).
HELP="$(schemathesis run --help 2>&1)"

URL_ARGS=()
if grep -q -- '--base-url' <<<"$HELP"; then
  URL_ARGS+=(--base-url "$BASE_URL")          # 3.x
else
  URL_ARGS+=(--url "$BASE_URL")               # 4.x
fi

EXAMPLES_ARGS=()
if grep -q -- '--hypothesis-max-examples' <<<"$HELP"; then
  EXAMPLES_ARGS+=(--hypothesis-max-examples "${MAX_EXAMPLES:-50}")   # 3.x
else
  EXAMPLES_ARGS+=(--max-examples "${MAX_EXAMPLES:-50}")              # 4.x
fi

JUNIT_PATH="$REPORT_DIR/schemathesis.junit.xml"
REPORT_ARGS=()
if grep -q -- '--junit-xml' <<<"$HELP"; then
  REPORT_ARGS+=(--junit-xml "$JUNIT_PATH")                          # 3.x
else
  REPORT_ARGS+=(--report junit --report-junit-path "$JUNIT_PATH")  # 4.x
fi

COMPAT_ARGS=()
if grep -q -- '--experimental' <<<"$HELP"; then
  COMPAT_ARGS+=(--experimental=openapi-3.1)                        # 3.x only
fi

# --checks all enables status-code conformance, schema conformance, and
# server-error detection; non-zero exit on any failure (deterministic gate).
schemathesis run "$SPEC" \
  "${URL_ARGS[@]}" \
  --checks all \
  "${EXAMPLES_ARGS[@]}" \
  "${REPORT_ARGS[@]}" \
  "${COMPAT_ARGS[@]}" \
  "${AUTH_ARGS[@]}"
