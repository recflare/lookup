#!/usr/bin/env bash
# Deploy with the Hyperdrive id from .env (or the HYPERDRIVE_ID environment
# variable), so the committed wrangler.jsonc stays free of account details.
# Writes wrangler.deploy.jsonc (gitignored) next to wrangler.jsonc so relative
# paths in the config still resolve, then deploys from it.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${HYPERDRIVE_ID:-}" && -f .env ]]; then
  HYPERDRIVE_ID="$(grep -E '^HYPERDRIVE_ID=' .env | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
fi
if [[ ! "${HYPERDRIVE_ID:-}" =~ ^[0-9a-f]{32}$ ]]; then
  echo "HYPERDRIVE_ID is missing or not a 32-char hex id (set it in .env or the environment)" >&2
  exit 2
fi
sed "s/HYPERDRIVE_ID_FROM_ENV/${HYPERDRIVE_ID}/" wrangler.jsonc > wrangler.deploy.jsonc
trap 'rm -f wrangler.deploy.jsonc' EXIT
npx wrangler deploy -c wrangler.deploy.jsonc "$@"
