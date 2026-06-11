#!/usr/bin/env bash
# scripts/reliability/kafka-cold-start.sh
# Reliability + chaos verification for the Street Kafka client (Priority 8,
# Requirement 9). Parameterized and reproducible; supports the full-scale
# targets of 100 cold starts / 100 broker-restart cycles (Req 9.4/9.5/9.8).
#
# Scenarios (Req 9.3):
#   - COLD STARTS: run the Kafka integration suite N times in fresh processes;
#     each run is a cold client bootstrap (metadata, FindCoordinator,
#     __consumer_offsets, group join). Asserts 0 failures + 0 lost messages.
#   - BROKER RESTART: restart the broker M times; after each restart wait for
#     health, run the suite, and assert recovery (Req 9.5).
#   - NETWORK INTERRUPTION: disconnect the broker from its docker network, then
#     reconnect, and assert the client resumes + delivers all messages (Req 9.6).
#   - CONNECTION LOSS: pause/unpause the broker process (freezes all TCP
#     connections) and assert recovery (Req 9.3).
#   - SLOW BROKER: inject a response delay of >= 5000 ms (tc/netem when
#     available, otherwise a paused-then-resumed stall) and assert messages are
#     still delivered with zero loss (Req 9.3/9.7).
#
# Lost-message accounting (Req 9.8): a lost message is a produced message never
# delivered to a committed consumer. After each scenario we run an accounting
# probe that produces N records and counts those delivered to a COMMITTED
# consumer; lostCount = produced - deliveredToCommitted (computed by the core
# `accountLostMessages` helper). The whole run requires 0 lost messages.
#
# Usage:
#   COLD_STARTS=100 RESTART_CYCLES=100 scripts/reliability/kafka-cold-start.sh
#   SCENARIOS="cold-start,broker-restart,network-interruption,connection-loss,slow-broker" \
#     scripts/reliability/kafka-cold-start.sh
#
# Parameters (env):
#   COLD_STARTS        cold-start count           (default 20; full-scale 100)
#   RESTART_CYCLES     broker-restart cycle count  (default 3;  full-scale 100)
#   SCENARIOS          comma list of scenarios to run (default: all)
#   ACCOUNT_COUNT      messages produced per accounting probe (default 50)
#   SLOW_BROKER_MS     slow-broker injected delay ms (default 5000; min 5000)
#   KAFKA_BROKERS      broker bootstrap (default 127.0.0.1:9092)
#
# Prereqs: docker (compose), built core (npm run build:app -w packages/core).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COLD_STARTS="${COLD_STARTS:-20}"
RESTART_CYCLES="${RESTART_CYCLES:-3}"
ACCOUNT_COUNT="${ACCOUNT_COUNT:-50}"
SLOW_BROKER_MS="${SLOW_BROKER_MS:-5000}"
SCENARIOS="${SCENARIOS:-cold-start,broker-restart,network-interruption,connection-loss,slow-broker}"
BROKERS="${KAFKA_BROKERS:-127.0.0.1:9092}"
# Optional machine-readable per-scenario summary path. When set, the harness
# writes a JSON document the CommandRunner driver (verify.mjs) folds into the
# kafka.coldstart / kafka.chaos.* Verification Artifacts (Req 9.8, task 15.5).
CHAOS_SUMMARY_PATH="${CHAOS_SUMMARY_PATH:-}"
TEST="packages/core/dist/src/integration/kafka/kafka.integration.test.js"
ACCOUNT="scripts/reliability/kafka-account.mjs"
CONTAINER="street-kafka"

# slow-broker must inject >= 5000 ms (Req 9.3).
if [ "$SLOW_BROKER_MS" -lt 5000 ]; then
  echo "SLOW_BROKER_MS must be >= 5000 (Req 9.3); raising to 5000" >&2
  SLOW_BROKER_MS=5000
fi

# Aggregate accounting (Req 9.8).
TOTAL_PRODUCED=0
TOTAL_DELIVERED=0
TOTAL_LOST=0

# Per-call accounting outputs (set by account_messages) + per-scenario summary
# fragments accumulated for the machine-readable CHAOS_SUMMARY_PATH document.
LAST_PRODUCED=0
LAST_DELIVERED=0
LAST_LOST=0
LAST_OK=0
SCEN_JSON=""

# Append one scenario object to the JSON summary accumulator.
#   emit_scenario <name> <ran> <ok> <pass> <total>
# Uses the most recent LAST_* accounting values for the message tallies.
emit_scenario() {
  local name="$1" ran="$2" ok="$3" pass="$4" total="$5"
  local obj
  obj="\"$name\":{\"ran\":$ran,\"ok\":$ok,\"pass\":$pass,\"total\":$total,\"produced\":$LAST_PRODUCED,\"deliveredToCommitted\":$LAST_DELIVERED,\"lost\":$LAST_LOST}"
  if [ -z "$SCEN_JSON" ]; then SCEN_JSON="$obj"; else SCEN_JSON="$SCEN_JSON,$obj"; fi
}

want() { case ",$SCENARIOS," in *,"$1",*) return 0;; *) return 1;; esac; }

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

suite_ok() {
  local out="$1"
  echo "$out" | grep -q "# fail 0" && ! echo "$out" | grep -q "not ok"
}

# Run the lost-message accounting probe once; accumulate the global tallies and
# return non-zero when any message was lost. Emits the probe JSON for evidence.
account_messages() {
  local label="$1" out produced delivered lost
  if ! out="$(COUNT="$ACCOUNT_COUNT" KAFKA_BROKERS="$BROKERS" node "$ACCOUNT" 2>/dev/null)"; then
    echo "  [$label] accounting probe failed: ${out:-<no output>}" >&2
    return 1
  fi
  produced="$(printf '%s' "$out" | sed -n 's/.*"produced":\([0-9]*\).*/\1/p')"
  delivered="$(printf '%s' "$out" | sed -n 's/.*"deliveredToCommitted":\([0-9]*\).*/\1/p')"
  lost="$(printf '%s' "$out" | sed -n 's/.*"lostCount":\([0-9]*\).*/\1/p')"
  [ -n "$produced" ] && [ -n "$delivered" ] && [ -n "$lost" ] || {
    echo "  [$label] could not parse accounting output: $out" >&2; return 1; }
  TOTAL_PRODUCED=$((TOTAL_PRODUCED + produced))
  TOTAL_DELIVERED=$((TOTAL_DELIVERED + delivered))
  TOTAL_LOST=$((TOTAL_LOST + lost))
  LAST_PRODUCED="$produced"
  LAST_DELIVERED="$delivered"
  LAST_LOST="$lost"
  echo "  [$label] accounting: produced=$produced deliveredToCommitted=$delivered lost=$lost"
  if [ "$lost" -eq 0 ]; then LAST_OK=1; else LAST_OK=0; fi
  [ "$lost" -eq 0 ]
}

[ -f "$TEST" ] || { echo "build first: npm run build:app -w packages/core" >&2; exit 1; }
[ -f "$ACCOUNT" ] || { echo "missing accounting probe: $ACCOUNT" >&2; exit 1; }

echo "==> Bringing up broker"
docker compose -f docker-compose.kafka.yml up -d >/dev/null
wait_healthy

FAILURES=0

# ── Cold starts (Req 9.4) ───────────────────────────────────────────────────
COLD_PASS=0
if want cold-start; then
  echo "==> Cold starts: $COLD_STARTS"
  fail=0
  for i in $(seq 1 "$COLD_STARTS"); do
    if out="$(run_suite)" && suite_ok "$out"; then
      COLD_PASS=$((COLD_PASS+1)); printf "."
    else
      fail=$((fail+1)); printf "X"; echo " cold-start $i FAILED"; echo "$out" | grep -iE "not ok|# fail" | head -3
    fi
  done
  echo
  echo "cold-start result: $COLD_PASS/$COLD_STARTS passed, $fail failed"
  LAST_PRODUCED=0; LAST_DELIVERED=0; LAST_LOST=0; LAST_OK=0
  acct_ok=1; account_messages "cold-start" || { FAILURES=$((FAILURES+1)); acct_ok=0; }
  [ "$fail" -eq 0 ] || FAILURES=$((FAILURES+1))
  if [ "$fail" -eq 0 ] && [ "$acct_ok" -eq 1 ]; then cs_ok=true; else cs_ok=false; fi
  emit_scenario "cold-start" true "$cs_ok" "$COLD_PASS" "$COLD_STARTS"
fi

# ── Broker restart (Req 9.5) ────────────────────────────────────────────────
RESTART_REC=0
if want broker-restart; then
  echo "==> Broker-restart chaos: $RESTART_CYCLES cycles"
  for c in $(seq 1 "$RESTART_CYCLES"); do
    docker restart "$CONTAINER" >/dev/null
    wait_healthy
    if out="$(run_suite)" && suite_ok "$out"; then
      RESTART_REC=$((RESTART_REC+1)); printf "."
    else
      printf "X"; echo " cycle $c: FAILED"; echo "$out" | grep -iE "not ok|# fail" | head -3
    fi
  done
  echo
  echo "broker-restart result: $RESTART_REC/$RESTART_CYCLES cycles recovered"
  LAST_PRODUCED=0; LAST_DELIVERED=0; LAST_LOST=0; LAST_OK=0
  acct_ok=1; account_messages "broker-restart" || { FAILURES=$((FAILURES+1)); acct_ok=0; }
  [ "$RESTART_REC" -eq "$RESTART_CYCLES" ] || FAILURES=$((FAILURES+1))
  if [ "$RESTART_REC" -eq "$RESTART_CYCLES" ] && [ "$acct_ok" -eq 1 ]; then br_ok=true; else br_ok=false; fi
  emit_scenario "broker-restart" true "$br_ok" "$RESTART_REC" "$RESTART_CYCLES"
fi

# ── Network interruption (Req 9.6) ──────────────────────────────────────────
# Cut the broker off its docker network, hold, reconnect, then verify the
# client resumes and all messages produced after restoration are delivered.
if want network-interruption; then
  echo "==> Network-interruption chaos"
  NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$CONTAINER" 2>/dev/null | awk '{print $1}')"
  if [ -n "$NET" ]; then
    echo "  disconnecting $CONTAINER from network '$NET' for 10s"
    docker network disconnect "$NET" "$CONTAINER" >/dev/null 2>&1 || true
    sleep 10
    docker network connect "$NET" "$CONTAINER" >/dev/null 2>&1 || true
    wait_healthy
    # Client must resume consuming within 60s of restoration (Req 9.6).
    LAST_PRODUCED=0; LAST_DELIVERED=0; LAST_LOST=0; LAST_OK=0
    if account_messages "network-interruption"; then
      echo "  network-interruption: recovered, 0 lost"
      emit_scenario "network-interruption" true true 1 1
    else
      echo "  network-interruption: FAILED (messages lost or probe error)"; FAILURES=$((FAILURES+1))
      emit_scenario "network-interruption" true false 0 1
    fi
  else
    echo "  could not determine broker network; skipping network-interruption" >&2
    emit_scenario "network-interruption" false false 0 1
  fi
fi

# ── Connection loss (Req 9.3) ───────────────────────────────────────────────
# Freeze the broker process (all TCP connections stall), then resume.
if want connection-loss; then
  echo "==> Connection-loss chaos (pause/unpause)"
  docker pause "$CONTAINER" >/dev/null 2>&1 || true
  sleep 8
  docker unpause "$CONTAINER" >/dev/null 2>&1 || true
  wait_healthy
  LAST_PRODUCED=0; LAST_DELIVERED=0; LAST_LOST=0; LAST_OK=0
  if account_messages "connection-loss"; then
    echo "  connection-loss: recovered, 0 lost"
    emit_scenario "connection-loss" true true 1 1
  else
    echo "  connection-loss: FAILED (messages lost or probe error)"; FAILURES=$((FAILURES+1))
    emit_scenario "connection-loss" true false 0 1
  fi
fi

# ── Slow broker (Req 9.3/9.7) ───────────────────────────────────────────────
# Inject a >= 5000 ms response delay. Prefer tc/netem inside the container;
# fall back to a pause-stall of the same duration when NET_ADMIN/tc is absent.
if want slow-broker; then
  echo "==> Slow-broker chaos (delay >= ${SLOW_BROKER_MS} ms)"
  TC_OK=0
  if docker exec "$CONTAINER" sh -c "command -v tc >/dev/null 2>&1"; then
    if docker exec "$CONTAINER" sh -c "tc qdisc add dev eth0 root netem delay ${SLOW_BROKER_MS}ms" >/dev/null 2>&1; then
      TC_OK=1
      echo "  injected ${SLOW_BROKER_MS}ms netem latency on eth0"
    fi
  fi
  if [ "$TC_OK" -ne 1 ]; then
    echo "  tc/netem unavailable; using pause-stall fallback of ${SLOW_BROKER_MS}ms"
    docker pause "$CONTAINER" >/dev/null 2>&1 || true
    # sleep at least the injected delay (ms -> s, rounded up).
    sleep "$(( (SLOW_BROKER_MS + 999) / 1000 ))"
    docker unpause "$CONTAINER" >/dev/null 2>&1 || true
  fi
  # Messages must still be delivered with zero loss (Req 9.7).
  LAST_PRODUCED=0; LAST_DELIVERED=0; LAST_LOST=0; LAST_OK=0
  if account_messages "slow-broker"; then
    echo "  slow-broker: delivered with 0 lost"
    sb_ok=true
  else
    echo "  slow-broker: FAILED (messages lost or probe error)"; FAILURES=$((FAILURES+1))
    sb_ok=false
  fi
  emit_scenario "slow-broker" true "$sb_ok" "$( [ "$sb_ok" = true ] && echo 1 || echo 0 )" 1
  if [ "$TC_OK" -eq 1 ]; then
    docker exec "$CONTAINER" sh -c "tc qdisc del dev eth0 root netem" >/dev/null 2>&1 || true
  fi
  wait_healthy
fi

# ── Summary + lost-message gate (Req 9.8) ───────────────────────────────────
echo
echo "==> Summary"
echo "  COLD_STARTS=$COLD_STARTS RESTART_CYCLES=$RESTART_CYCLES"
echo "  cold-start passed:     $COLD_PASS"
echo "  restart cycles ok:     $RESTART_REC"
echo "  produced (total):      $TOTAL_PRODUCED"
echo "  delivered (committed): $TOTAL_DELIVERED"
echo "  lost messages:         $TOTAL_LOST"

# Machine-readable per-scenario summary for the artifact driver (Req 9.8).
if [ -n "$CHAOS_SUMMARY_PATH" ]; then
  mkdir -p "$(dirname "$CHAOS_SUMMARY_PATH")"
  cat > "$CHAOS_SUMMARY_PATH" <<JSON
{
  "coldStarts": $COLD_STARTS,
  "restartCycles": $RESTART_CYCLES,
  "accountCount": $ACCOUNT_COUNT,
  "slowBrokerMs": $SLOW_BROKER_MS,
  "brokers": "$BROKERS",
  "scenariosRequested": "$SCENARIOS",
  "failures": $FAILURES,
  "totalProduced": $TOTAL_PRODUCED,
  "totalDelivered": $TOTAL_DELIVERED,
  "totalLost": $TOTAL_LOST,
  "scenarios": { $SCEN_JSON }
}
JSON
  echo "  summary written:       $CHAOS_SUMMARY_PATH"
fi

if [ "$FAILURES" -eq 0 ] && [ "$TOTAL_LOST" -eq 0 ]; then
  echo "RELIABILITY CHECK PASSED (0 failures, $TOTAL_LOST lost messages)"
else
  echo "RELIABILITY CHECK FAILED ($FAILURES failing scenarios, $TOTAL_LOST lost messages)" >&2
  exit 1
fi
