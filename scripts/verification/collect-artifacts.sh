#!/usr/bin/env bash
# scripts/verification/collect-artifacts.sh
#
# Gather the latest recorded Verification Artifacts produced by each capability
# area's verification workflow into a single directory so the Platform
# Leadership aggregator (`street verify --aggregate`) can read them.
#
# Each per-area workflow uploads its `*.artifact.json` files as a named build
# artifact (e.g. `dast-verification-artifact`, `cloud-deployment-verification`).
# This script downloads the most recent successful upload of each, for the
# current branch, into `<dest>/<area>/` using the GitHub CLI (`gh`), which is
# preinstalled on GitHub-hosted runners — no third-party action required.
#
# A MISSING artifact is NOT an error. The aggregator treats a required
# capability with no recorded artifact as not VERIFIED and withholds the
# classification (Requirement 12.3). This script therefore never fails the build
# on a missing or undownloadable artifact — only the computed decision (mirrored
# by `street verify --aggregate`'s exit code) gates the job.
#
# Usage:
#   GH_TOKEN=<token> bash scripts/verification/collect-artifacts.sh [dest]
#
# Environment:
#   GH_TOKEN / GITHUB_TOKEN  — token with `actions: read` (set by the workflow)
#   GH_REPO                  — owner/repo (defaults to the current checkout)
#   COLLECT_BRANCH           — branch to pull artifacts from (default: current)
#
# _Design: Testing Strategy → CI integration and evidence retention.
#  Requirements: 12.1, 12.5_

set -uo pipefail

DEST="${1:-verification-artifacts}"
mkdir -p "$DEST"

# Branch whose latest successful runs we pull artifacts from. Falls back to the
# checked-out branch, then `main`.
BRANCH="${COLLECT_BRANCH:-${GITHUB_REF_NAME:-}}"
if [ -z "$BRANCH" ]; then
  BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
fi

# artifact-name : workflow-file : destination-subdir (area)
# The area subdir is cosmetic — the aggregator matches artifacts by the
# capabilityId recorded inside each JSON, not by path — but keeping the layout
# makes the collected evidence easy to inspect.
MAPPINGS=(
  "dast-verification-artifact:dast.yml:dast"
  "cloud-deployment-verification:deploy-verify.yml:cloud"
  "registry-publish-install-verification:registry-verify.yml:registry"
  "plugin-verification-artifacts:vendor-integration.yml:plugins"
  "enterprise-api-verification:enterprise-verify.yml:enterprise"
  "devtools-verification:devtools-verify.yml:devx"
  "kafka-chaos-artifacts:kafka-integration.yml:kafka"
  "observability-validate-verification:observability.yml:observability"
)

if ! command -v gh >/dev/null 2>&1; then
  echo "[collect] gh CLI not found — skipping artifact collection." >&2
  echo "[collect] The aggregator will treat all capabilities as not VERIFIED." >&2
  exit 0
fi

# Return the databaseId of the most recent successful run of a workflow on the
# target branch, or empty when none exists.
latest_success_run() {
  local workflow="$1"
  gh run list \
    --workflow "$workflow" \
    --branch "$BRANCH" \
    --status success \
    --limit 1 \
    --json databaseId \
    --jq '.[0].databaseId // empty' 2>/dev/null || true
}

for entry in "${MAPPINGS[@]}"; do
  IFS=':' read -r artifact_name workflow area <<<"$entry"
  target_dir="$DEST/$area"
  mkdir -p "$target_dir"

  echo "::group::collect ${artifact_name} (${workflow})"
  run_id="$(latest_success_run "$workflow")"

  if [ -z "$run_id" ]; then
    echo "[collect] no successful '${workflow}' run on '${BRANCH}' — capability remains unverified."
    echo "::endgroup::"
    continue
  fi

  echo "[collect] downloading '${artifact_name}' from run ${run_id} into ${target_dir}"
  if gh run download "$run_id" --name "$artifact_name" --dir "$target_dir" 2>/dev/null; then
    echo "[collect] ok: ${artifact_name}"
  else
    echo "[collect] '${artifact_name}' not present in run ${run_id} — capability remains unverified."
  fi
  echo "::endgroup::"
done

# Release scorecard is uploaded with a per-commit suffix from ci-cd-enforcement;
# pull whatever release artifact the latest successful enforcement run produced.
echo "::group::collect release.scorecard (ci-cd-enforcement.yml)"
release_run="$(latest_success_run "ci-cd-enforcement.yml")"
if [ -n "$release_run" ]; then
  mkdir -p "$DEST/release"
  # Match the `release-scorecard-artifact-<sha>` upload by glob pattern.
  if gh run download "$release_run" --pattern "release-scorecard-artifact-*" --dir "$DEST/release" 2>/dev/null; then
    echo "[collect] ok: release scorecard"
  else
    echo "[collect] release scorecard artifact not present — capability remains unverified."
  fi
else
  echo "[collect] no successful 'ci-cd-enforcement.yml' run on '${BRANCH}' — capability remains unverified."
fi
echo "::endgroup::"

echo "[collect] collection complete; artifacts under ${DEST}/"
exit 0
