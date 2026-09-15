#!/usr/bin/env bash
# Transcribe únicamente audios con cero fragmentos; no reemplaza los existentes.
# Ejecutar EN EL SERVIDOR desde la raíz del proyecto.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "==> Estado antes"
docker compose -f stack/docker-compose.yml exec -T db psql -U palabra -d palabra_pura -c \
  "SELECT count(*) FILTER (WHERE frags=0) sin_transcripcion,
          count(*) FILTER (WHERE frags>0) con_transcripcion
   FROM (SELECT count(f.id) frags FROM video v LEFT JOIN fragment f ON f.video_id=v.id GROUP BY v.id) t;"

echo "==> Construyendo contenedor de transcripcion"
docker compose -f stack/docker-compose.yml --profile transcribe build transcribe

echo "==> Transcribiendo en segundo plano (log: stack/runtime/transcribe.log)"
mkdir -p stack/runtime
nohup docker compose -f stack/docker-compose.yml --profile transcribe run --rm transcribe \
  >> stack/runtime/transcribe.log 2>&1 &
echo $! > stack/runtime/transcribe.pid
echo "PID $(cat stack/runtime/transcribe.pid) — tail -f stack/runtime/transcribe.log"
