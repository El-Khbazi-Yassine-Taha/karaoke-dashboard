#!/usr/bin/env bash
set -euo pipefail

cd /app

# Railway provides DATABASE_URL; Laravel pgsql reads DB_URL
if [[ -n "${DATABASE_URL:-}" && -z "${DB_URL:-}" ]]; then
  export DB_URL="$DATABASE_URL"
fi

export DB_CONNECTION="${DB_CONNECTION:-pgsql}"
export PORT="${PORT:-8000}"

# First boot: generate key if missing (prefer set APP_KEY in Railway Variables)
if [[ -z "${APP_KEY:-}" ]]; then
  echo "WARNING: APP_KEY is empty — generating a temporary key (set APP_KEY in Railway for stable sessions)"
  export APP_KEY="$(php -r "echo 'base64:'.base64_encode(random_bytes(32));")"
fi

php artisan migrate --force
php artisan db:seed --force --class=RoomSeeder || true
php artisan db:seed --force --class=AdminUserSeeder || true

php artisan config:cache
php artisan route:cache
php artisan view:cache || true

exec php artisan serve --host=0.0.0.0 --port="$PORT"
