#!/usr/bin/env bash
# Sincroniza el frontend de producción (web/app) hacia docs/ (GitHub Pages).
# No borra markdown de documentación en docs/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/web/app"
DST="$ROOT/docs"

if [[ ! -d "$SRC" ]]; then
  echo "No existe $SRC" >&2
  exit 1
fi

mkdir -p "$DST"

echo "→ Sync CSS"
rsync -a --delete "$SRC/css/" "$DST/css/"

echo "→ Sync JS"
rsync -a --delete "$SRC/js/" "$DST/js/"

echo "→ Sync dashboard"
rsync -a --delete "$SRC/dashboard/" "$DST/dashboard/"

if [[ -d "$SRC/assets" ]]; then
  echo "→ Sync assets"
  rsync -a "$SRC/assets/" "$DST/assets/"
fi

echo "→ Sync HTML raíz"
cp -f "$SRC/index.html" "$DST/index.html"
cp -f "$SRC/login.html" "$DST/login.html"

# Cache-bust hint en login (ya versionado en el propio HTML)
echo "OK: docs/ actualizado desde web/app (Pages)."
echo "Recuerda commit + push a main para publicar en github.io."
