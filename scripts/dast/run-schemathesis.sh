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

# OpenAPI 3.1 handling differs by schemathesis major version: 3.x requires the
# opt-in `--experimental=openapi-3.1` flag to validate 3.1 specs, while 4.x
# supports 3.1 natively and rejects that (removed) flag. Add it only when the
# installed CLI advertises it, so the script is correct on either version.
COMPAT_ARGS=()
if schemathesis run --help 2>&1 | grep -q -- '--experimental'; then
  COMPAT_ARGS+=(--experimental=openapi-3.1)
fi

# --checks all enables status-code conformance, schema conformance, and
# server-error detection; non-zero exit on any failure (deterministic gate).
schemathesis run "$SPEC" \
  --base-url "$BASE_URL" \
  --checks all \
  --hypothesis-max-examples "${MAX_EXAMPLES:-50}" \
  --junit-xml "$REPORT_DIR/schemathesis.junit.xml" \
  "${COMPAT_ARGS[@]}" \
  "${AUTH_ARGS[@]}"
