#!/usr/bin/env bash
# Reset the LOCAL development database: drop schema, re-apply migrations, seed.
# Usage: pnpm db:reset   (or: bash scripts/db-reset.sh)
# Refuses to run when NODE_ENV=production.
set -euo pipefail

if [ "${NODE_ENV:-development}" = "production" ]; then
  echo "Refusing to reset a production database" >&2
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-postgresql://flowhub:flowhub_dev_password@localhost:5432/flowhub}"
export DATABASE_URL

echo "Resetting database at ${DATABASE_URL%%@*}@…"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;"

echo "Applying migrations…"
pnpm --filter @flowhub/database db:migrate

echo "Seeding…"
pnpm --filter @flowhub/database db:seed

echo "Done."
