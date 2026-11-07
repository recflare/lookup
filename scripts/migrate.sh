#!/usr/bin/env bash
# Apply every SQL file in db/migrations, in name order, with psql.
# Files must be idempotent (IF NOT EXISTS) because there is no migrations table yet.
# Usage: DATABASE_URL=postgres://... scripts/migrate.sh   (falls back to .env)
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
[[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL is not set (env or .env)" >&2; exit 2; }
for f in db/migrations/*.sql; do
  echo "== $f"
  psql "$DATABASE_URL" -w -X -v ON_ERROR_STOP=1 -f "$f"
done
echo "Done."
