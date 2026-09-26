#!/usr/bin/env bash
# Aplica migraciones de conocimiento + cola de ingesta + datos puntuales al Postgres local (Docker).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_CONTAINER="${DB_CONTAINER:-palabra-pura-db}"

apply() {
  local file="$1"
  echo "→ $file"
  docker exec -i "$DB_CONTAINER" psql -U palabra -d palabra_pura < "$file"
}

apply "$ROOT/db/migrations/20260926_knowledge_base.sql"
apply "$ROOT/db/migrations/20260926_ingest_jobs.sql"
apply "$ROOT/db/migrations/20260926_knowledge_facts.sql"
echo "OK"
