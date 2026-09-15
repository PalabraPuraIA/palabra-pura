#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "==> Waiting for db..."
for i in $(seq 1 90); do
  if docker compose exec -T db pg_isready -U palabra -d palabra_pura >/dev/null 2>&1; then
    echo "db ready"
    break
  fi
  sleep 2
done
docker compose exec -T db pg_isready -U palabra -d palabra_pura

echo "==> vector extension"
docker compose exec -T db psql -U palabra -d palabra_pura -c 'CREATE EXTENSION IF NOT EXISTS vector;'

echo "==> schema.clean.sql"
docker compose exec -T db psql -U palabra -d palabra_pura -v ON_ERROR_STOP=0 -f /import/schema.clean.sql

echo "==> data.sql (large, please wait)"
docker compose exec -T db psql -U palabra -d palabra_pura -v ON_ERROR_STOP=0 -f /import/data.sql

echo "==> migrations"
./scripts/apply-migrations.sh

echo "==> counts"
docker compose exec -T db psql -U palabra -d palabra_pura -c "\dt public.*"
docker compose exec -T db psql -U palabra -d palabra_pura -c "SELECT 'video' t, count(*)::text c FROM video UNION ALL SELECT 'fragment', count(*)::text FROM fragment UNION ALL SELECT 'verses', count(*)::text FROM verses UNION ALL SELECT 'bible_chunks', count(*)::text FROM bible_chunks;"
echo DONE
