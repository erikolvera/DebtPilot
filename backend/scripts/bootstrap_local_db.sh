#!/usr/bin/env bash
# Grant the application role a login and a password.
#
# Deliberately NOT part of the migration: that file is applied to the hosted
# project by `supabase db push`, and a password committed there would publish a
# credential for a role that can impersonate any user. Production sets this in
# the Supabase dashboard; this script covers local development and CI.
#
# Idempotent -- safe to re-run after `supabase db reset`.
set -euo pipefail

ADMIN_URL="${ADMIN_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
APP_PASSWORD="${APP_DB_PASSWORD:-app_user}"

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c \
  "alter role app_user with login password '${APP_PASSWORD}';"

echo "app_user can now log in (local/CI only)."
