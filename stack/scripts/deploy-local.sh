#!/usr/bin/env bash
# Aplica los cambios de archivos del proyecto en el servidor.
# Uso (dentro del servidor):  ./stack/scripts/deploy-local.sh
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR/stack"

echo "==> Reconstruyendo el contenedor web"
docker compose build web

echo "==> Levantando"
docker compose up -d web

echo "==> Esperando salud"
for _ in $(seq 1 20); do
  if docker exec palabra-pura-web wget -qO- http://127.0.0.1/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "==> Estado"
docker ps --filter name=palabra-pura --format 'table {{.Names}}\t{{.Status}}'
docker exec palabra-pura-web wget -qO- http://127.0.0.1/api/chat/status || true
echo
echo "Listo. Chat: http://$(hostname -I | awk '{print $1}'):8088/"
