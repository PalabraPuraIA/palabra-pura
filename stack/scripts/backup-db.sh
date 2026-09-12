#!/usr/bin/env bash
# backup-db.sh — Exporta la base del chat a un .sql.gz
set -euo pipefail
cd "$(dirname "$0")/.."

STAMP="${1:-$(date -u +%Y-%m-%d)}"
OUT="${BACKUP_OUT:-./backups}/palabra-pura-db-${STAMP}.sql.gz"
mkdir -p "$(dirname "$OUT")"

echo "==> Dumping palabra_pura → ${OUT}"
docker compose exec -T db pg_dump -U palabra -d palabra_pura --no-owner --no-acl \
  | gzip -c > "$OUT"

ls -lh "$OUT"
echo "DONE. Súbelo a GitHub Releases del repo PalabraPuraIA/palabra-pura"
