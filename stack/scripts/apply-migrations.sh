#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

for migration in db/migrations/*.sql; do
  [[ -f "$migration" ]] || continue
  echo "==> $(basename "$migration")"
  docker compose -f stack/docker-compose.yml exec -T db \
    psql -U palabra -d palabra_pura -v ON_ERROR_STOP=1 < "$migration"
done

echo "Migrations applied."
