#!/usr/bin/env bash
# Run the committed GitHub Action bundle locally, without pushing.
#
# @actions/core is just a convention over environment variables, so the whole
# Action path is reproducible on a laptop: inputs come from INPUT_*, the webhook
# payload from a JSON file, the job summary and outputs from file paths.
#
# Usage, from the repo root (needs ./.env and a built ./packages/action/dist/index.cjs):
#   packages/action/scripts/run-locally.sh <owner> <repo> <pr-number>
#
# MAKES TWO PAID ANTHROPIC CALLS (inference + review), like any real review.
#
# NOTE: comment is hardcoded false. Setting it true posts a real comment to a
# real PR — the only write path in the product. Do not flip it on a repo you
# do not own.
set -euo pipefail

OWNER=${1:?owner}; REPO=${2:?repo}; NUM=${3:?pr number}

# Fail with something readable rather than a bare "Cannot find module" from node.
BUNDLE=packages/action/dist/index.cjs
[ -f "$BUNDLE" ] || { echo "$BUNDLE not found — run: pnpm --filter @rubric/action build" >&2; exit 1; }
[ -f .env ] || { echo ".env not found — run this from the repo root" >&2; exit 1; }

OUT=$(mktemp -d)

echo "{\"pull_request\":{\"number\":$NUM}}" > "$OUT/event.json"
: > "$OUT/step-summary.md"
: > "$OUT/outputs.txt"   # the real runner pre-creates this; @actions/core errors if it is missing

# action.yml `default:` values are applied by the GitHub runner, NOT by the code.
# Running the bundle directly means every getBooleanInput must be set explicitly
# or it throws "Input does not meet YAML 1.2 Core Schema specification".
env "INPUT_ANTHROPIC-API-KEY=$(grep -oP '(?<=^ANTHROPIC_API_KEY=).*' .env | tr -d '"'"'"'"')" \
    "INPUT_GITHUB-TOKEN=$(gh auth token)" \
    "INPUT_INFER=true" \
    "INPUT_COMMENT=false" \
    "INPUT_FAIL-ON-MISALIGNED=false" \
    "GITHUB_REPOSITORY=$OWNER/$REPO" \
    "GITHUB_EVENT_NAME=pull_request" \
    "GITHUB_EVENT_PATH=$OUT/event.json" \
    "GITHUB_STEP_SUMMARY=$OUT/step-summary.md" \
    "GITHUB_OUTPUT=$OUT/outputs.txt" \
    node "$BUNDLE"

echo
echo "--- outputs ---"; cat "$OUT/outputs.txt"
echo "--- job summary: $OUT/step-summary.md ---"
