#!/usr/bin/env bash
# restore-db.sh — Restaura un .sql o .sql.gz en el contenedor db
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Uso: $0 /ruta/palabra-pura-db-YYYY-MM-DD.sql.gz"
  exit 1
fi

echo "==> Waiting for db..."
for i in $(seq 1 90); do
  if docker compose exec -T db pg_isready -U palabra -d palabra_pura >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose exec -T db pg_isready -U palabra -d palabra_pura

echo "==> Restoring ${FILE}"
if [[ "$FILE" == *.gz ]]; then
  gunzip -c "$FILE" | docker compose exec -T db psql -U palabra -d palabra_pura -v ON_ERROR_STOP=0
else
  docker compose exec -T db psql -U palabra -d palabra_pura -v ON_ERROR_STOP=0 < "$FILE"
fi

echo "==> counts"
docker compose exec -T db psql -U palabra -d palabra_pura -c \
  "SELECT 'video' t, count(*)::text c FROM video UNION ALL SELECT 'fragment', count(*)::text FROM fragment UNION ALL SELECT 'verses', count(*)::text FROM verses UNION ALL SELECT 'bible_chunks', count(*)::text FROM bible_chunks;"
echo DONE
