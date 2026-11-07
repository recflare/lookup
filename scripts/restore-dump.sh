#!/usr/bin/env bash
# Restore a pg_dump custom-format archive into the Supabase database.
#
# Usage:
#   DATABASE_URL=postgres://... scripts/restore-dump.sh path/to/file.dump [extra pg_restore flags]
#   npm run db:restore -- path/to/file.dump
#
# DATABASE_URL is read from the environment, falling back to .env.
#
# Notes:
# - The dump was taken from a database owned by a role that does not exist on
#   Supabase, so ownership and grants are dropped (--no-owner --no-privileges)
#   and objects are created as the connecting role.
# - Pass --clean --if-exists as extra flags to drop and recreate objects that
#   already exist. Without them, pg_restore errors on existing objects and
#   continues (exit code 1 with a count of ignored errors).
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <dump-file> [pg_restore flags...]" >&2
  exit 2
fi
DUMP="$1"; shift

if [[ -z "${DATABASE_URL:-}" && -f .env ]]; then
  DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
fi
if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set (env or .env)" >&2
  exit 2
fi
if [[ ! -f "$DUMP" ]]; then
  echo "dump file not found: $DUMP" >&2
  exit 2
fi

echo "Dump contents:"
pg_restore -l "$DUMP" | grep -E '^[0-9]+; .* (TABLE|SEQUENCE|INDEX|CONSTRAINT|FK CONSTRAINT) ' | awk '{print "  " $4, $5, $6, $7}' | sed 's/ *$//'
echo

echo "Target: $(echo "$DATABASE_URL" | sed -E 's#://([^:]+):[^@]*@#://\1:***@#')"
echo "Restoring..."
pg_restore \
  --dbname="$DATABASE_URL" \
  --no-owner \
  --no-privileges \
  --exit-on-error \
  --verbose \
  "$@" \
  "$DUMP"
echo "Done."
