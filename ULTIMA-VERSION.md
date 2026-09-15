# Última versión — Palabra Pura (chat completo)

Documento canónico para **bajar, restaurar y correr** el chat de Palabra Pura
sin depender de que el servidor `10.45.178.129` esté encendido.

Fecha de este snapshot: **2026-09-11** · commit `9ff665e` en `main`

## Dónde está todo

| Pieza | Dónde |
|-------|--------|
| **Código (front + lógica del chat)** | Repo privado: https://github.com/PalabraPuraIA/palabra-pura |
| **Base de datos (videos, fragmentos, versículos, embeddings)** | [Release db-backup-2026-09-11](https://github.com/PalabraPuraIA/palabra-pura/releases/tag/db-backup-2026-09-11) · archivo `palabra-pura-db-2026-09-11.sql.gz` (~176 MB) · también en Supabase |
| **Supabase (nube)** | Proyecto `roxbekpxdgvqbosepmdd` · cuenta `palabrapuraia@gmail.com` |
| **Server actual (demo)** | `server-fintek` · IP `10.45.178.129` · carpeta `/home/fintek-1/palabra-pura` |
| **URL pública (solo si el server está ON)** | Ver `curl -s http://10.45.178.129:8088/api/public-url` |

> Si el server se apaga, el túnel `*.trycloudflare.com` deja de funcionar.
> El **código + dump de BD en GitHub** bastan para levantarlo en otro PC o VPS.

## Qué incluye esta versión (sept 2026)

- Chat Grace con modos `asistida` / `local` / `proxy`
- Versículos solo desde el audio (cuando hay video)
- Selector **TLA / Reina-Valera Antigua** en cada respuesta
- Panel de artículos ampliables
- Scroll de página / sidebar estabilizado
- Video sin autoplay
- Artículos desde WordPress público de la iglesia

## Cómo clonar el código

Necesitas acceso a la org **PalabraPuraIA** en GitHub.

```bash
git clone git@github.com:PalabraPuraIA/palabra-pura.git
cd palabra-pura
git checkout main
git pull
```

## Cómo restaurar la base de datos

1. Descarga el backup más reciente desde Releases del repo  
   (asset tipo `palabra-pura-db-YYYY-MM-DD.sql.gz`).
2. Arranca el stack (paso siguiente) y restaura:

```bash
cd stack
gunzip -c ~/Downloads/palabra-pura-db-YYYY-MM-DD.sql.gz \
  | docker compose exec -T db psql -U palabra -d palabra_pura
```

O usa el script:

```bash
./scripts/restore-db.sh ~/Downloads/palabra-pura-db-YYYY-MM-DD.sql.gz
```

Schema de referencia (sin datos grandes): `db/schema.sql` / `db/schema.clean.sql`.

### Alternativa sin dump local

`CHAT_MODE=proxy` en `stack/.env` y usa la Edge Function de Supabase
(el contenido vive en la nube). No necesitas importar Postgres local.

## Cómo correr todo en otro equipo

Requisitos: Docker Desktop (o Docker Engine + Compose).

```bash
cd stack
cp .env.example .env
# Edita .env:
#   CHAT_MODE=local   (con dump + claves)  ó  proxy (solo Supabase)
#   GEMINI_API_KEY=...          # solo local
#   OPENROUTER_API_KEY=...      # solo local
#   SUPABASE_CHAT_URL=...       # solo proxy
#   SUPABASE_PUBLISHABLE_KEY=...

docker compose up -d --build
./scripts/restore-db.sh /ruta/al/backup.sql.gz   # si usas local
./scripts/apply-migrations.sh                    # también tras actualizar el repo
```

Puertos por defecto:

| Servicio | URL |
|----------|-----|
| Chat | http://localhost:8088/ |
| Dashboard | http://localhost:8088/dashboard/ |
| Postgres | localhost:5488 |
| n8n | http://localhost:5688/ |

Demo HTTPS opcional:

```bash
docker compose up -d tunnel
docker logs -f palabra-pura-tunnel
```

## Mapa del repo

| Path | Qué es |
|------|--------|
| `web/app/` | Front (HTML/CSS/JS) |
| `web/server/` | Lógica `/api/chat`, versículos, guard, LLM |
| `db/` | Schemas y migraciones SQL |
| `stack/` | Docker Compose, backup/restore, auditoría, transcripción y reindexado |
| `supabase/functions/` | Edge Functions (chatbot, enciclopedia…) |
| `CONEXION.md` | Cuentas y backends |
| `SERVIDOR.md` | Server `10.45.178.129` |
| `ACCESO-OTRO-PC.md` | SSH / segundo PC |
| `ULTIMA-VERSION.md` | Este archivo |

## Conversaciones e indexación

- `chat_interactions` guarda pregunta, respuesta, extracto literal, fuente,
  video/minuto, versículos y metadatos de recuperación.
- `/dashboard/` es público y presenta el historial como fichas expandibles.
- `stack/scripts/audit-retrieval.mjs` comprueba faltantes, duplicados,
  tamaños, embeddings cero e índices.
- `transcribe-videos.mjs` procesa solo videos sin ningún fragmento y nunca
  reemplaza transcripciones existentes.
- `reindex-fragment-embeddings.mjs` completa únicamente vectores cero; requiere
  `GEMINI_API_KEY` en `stack/.env` y puede revisarse primero con `--dry-run`.

## Derechos de textos bíblicos

- **Reina-Valera Antigua (~1909):** dominio público (texto en la BD).
- **TLA:** © Sociedades Bíblicas Unidas — citas limitadas para uso personal/no comercial.

## ¿Hay que dejar el server prendido?

Solo si quieres la demo actual (LAN + túnel Cloudflare).  
Para el proyecto en sí: **no** — con GitHub + dump (o Supabase proxy) se puede recrear en otro lado.

## Crear un backup nuevo de la BD (ops)

En el server (o donde corra Docker):

```bash
cd /home/fintek-1/palabra-pura/stack
./scripts/backup-db.sh
# sube el .sql.gz a GitHub Releases del repo
```
