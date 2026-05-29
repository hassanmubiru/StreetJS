#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing dependencies..."
npm ci

echo "==> Compiling TypeScript..."
npx tsc

echo "==> Creating uploads directory..."
mkdir -p dist/uploads

echo "==> Build complete."
echo "    Start with: npm start"
echo "    Test with:  npm test"
