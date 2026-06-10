#!/usr/bin/env bash
# scripts/reliability/kafka-cold-start.sh
# Reliability verification for the Street Kafka client (Priority 8).
#
#   - COLD STARTS: run the Kafka integration suite N times in fresh processes;
#     each run is a cold client bootstrap (metadata, FindCoordinator,
#     __consumer_offsets, group join). Asserts 0 failures.
#   - BROKER-RESTART CHAOS: restart the broker M times; after each restart wait
#     for health, then run the suite and assert it recovers (0 failures).
#
# Usage:
#   COLD_STARTS=100 RESTART_CYCLES=10 scripts/reliability/kafka-cold-start.sh
#
# Prereqs: docker (compose), built core (npm run build:app -w packages/core).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COLD_STARTS="${COLD_STARTS:-20}"
RESTART_CYCLES="${RESTART_CYCLES:-3}"
BROKERS="${KAFKA_BROKERS:-127.0.0.1:9092}"
TEST="packages/core/dist/src/integration/kafka/kafka.integration.test.js"
CONTAINER="street-kafka"

wait_healthy() {
  for _ in $(seq 1 24); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null)" = "healthy" ] && return 0
    sleep 5
  done
  echo "broker did not become healthy" >&2; return 1
}

run_suite() {
  KAFKA_BROKERS="$BROKERS" node --test --test-timeout=60000 "$TEST" 2>&1
}

[ -f "$TEST" ] || { echo "build first: npm run build:app -w packages/core" >&2; exit 1; }

echo "==> Bringing up broker"
docker compose -f docker-compose.kafka.yml up -d >/dev/null
wait_healthy

echo "==> Cold starts: $COLD_STARTS"
pass=0; fail=0
for i in $(seq 1 "$COLD_STARTS"); do
  if out="$(run_suite)" && echo "$out" | grep -q "# fail 0" && ! echo "$out" | grep -q "not ok"; then
    pass=$((pass+1)); printf "."
  else
    fail=$((fail+1)); printf "X"; echo " cold-start $i FAILED"; echo "$out" | grep -iE "not ok|# fail" | head -3
  fi
done
echo
echo "cold-start result: $pass/$COLD_STARTS passed, $fail failed"

echo "==> Broker-restart chaos: $RESTART_CYCLES cycles"
rec=0
for c in $(seq 1 "$RESTART_CYCLES"); do
  docker restart "$CONTAINER" >/dev/null
  wait_healthy
  if out="$(run_suite)" && echo "$out" | grep -q "# fail 0" && ! echo "$out" | grep -q "not ok"; then
    rec=$((rec+1)); echo "  cycle $c: recovered"
  else
    echo "  cycle $c: FAILED"; echo "$out" | grep -iE "not ok|# fail" | head -3
  fi
done
echo "chaos result: $rec/$RESTART_CYCLES cycles recovered"

[ "$fail" -eq 0 ] && [ "$rec" -eq "$RESTART_CYCLES" ] || { echo "RELIABILITY CHECK FAILED" >&2; exit 1; }
echo "RELIABILITY CHECK PASSED ($pass cold starts, $rec restart cycles, 0 failures)"
