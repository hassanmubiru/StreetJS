#!/usr/bin/env bash
# Deployment smoke test: verifies a running StreetJS instance answers its
# liveness and readiness probes. Works against any deploy target (Docker, k8s,
# Cloud Run, ECS, …) by pointing BASE_URL at the instance.
#
#   BASE_URL=http://127.0.0.1:3000 bash scripts/deploy/smoke-test.sh
#
# Exits non-zero if either probe fails, so it can gate a deploy/rollback.
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
RETRIES="${RETRIES:-10}"
SLEEP="${SLEEP:-3}"

probe() {
  local path="$1" expect="$2"
  for i in $(seq 1 "$RETRIES"); do
    code=$(curl -s -o /dev/null -m 5 -w '%{http_code}' "${BASE_URL}${path}" || echo 000)
    if [ "$code" = "$expect" ]; then
      echo "  OK   ${path} -> HTTP ${code}"
      return 0
    fi
    echo "  ...  ${path} -> HTTP ${code} (attempt ${i}/${RETRIES})"
    sleep "$SLEEP"
  done
  echo "  FAIL ${path}: never returned ${expect}"
  return 1
}

echo "Smoke testing StreetJS at ${BASE_URL}"
probe /health/live 200
probe /health/ready 200
echo "Smoke test passed."
