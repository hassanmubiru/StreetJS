#!/usr/bin/env bash
set -euo pipefail

# Start Postgres via docker-compose and run the test suite
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "Starting Postgres test DB with docker-compose..."
echo "Starting Postgres test DB with docker compose..."

# Helper to run either docker-compose or docker compose depending on host
run_compose() {
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose -f infra/docker/compose/docker-compose.yml "$@"
  else
    docker compose -f infra/docker/compose/docker-compose.yml "$@"
  fi
}

run_compose up -d postgres

echo "Waiting for Postgres health..."
# Wait until container reports healthy
until docker exec street_db pg_isready -U street >/dev/null 2>&1; do
  sleep 1
done

echo "Postgres ready. Running tests..."
# Run tests pointing to local compose DB
cd "$ROOT_DIR/packages/core" && PG_HOST=127.0.0.1 PG_PORT=5432 PG_USER=street PG_PASSWORD=street_secret PG_DATABASE=street_test npm run test:run

EXIT_CODE=$?

echo "Tests finished with exit code $EXIT_CODE"

echo "Tearing down Postgres container..."
run_compose down

exit $EXIT_CODE
