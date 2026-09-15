# Palabra Pura — chatbot stack

Stack del chatbot de la **Iglesia Palabra Pura**: front web, Postgres (pgvector),
workflows n8n opcionales y tunnel Cloudflare para demos.

> **Cuentas:** GitHub [`PalabraPuraIA`](https://github.com/PalabraPuraIA) · Supabase `roxbekpxdgvqbosepmdd`  
> **Última versión + cómo restaurar sin el server:** [ULTIMA-VERSION.md](./ULTIMA-VERSION.md)  
> Conexión: [CONEXION.md](./CONEXION.md) · Server actual: [SERVIDOR.md](./SERVIDOR.md) · Otro PC: [ACCESO-OTRO-PC.md](./ACCESO-OTRO-PC.md)

## Acceso externo (mientras el server esté ON)

- LAN: http://10.45.178.129:8088/
- Público: `curl -s http://10.45.178.129:8088/api/public-url` (túnel Cloudflare)
- Código: https://github.com/PalabraPuraIA/palabra-pura (privado)
- Dump BD: GitHub → Releases → `db-backup`

Si el server se apaga, clona el repo + restaura el dump (ver ULTIMA-VERSION.md).

## Qué hay en este repo

| Path | Contenido |
|------|-----------|
| `web/app/` | Frontend del chat (respuestas, YouTube, artículos, TLA/RVA) + dashboard |
| `web/server/` | API `/api/chat` (búsqueda, LLM, versículos, guard) |
| `stack/` | `docker-compose.yml`, scripts de backup/restore |
| `db/` | Schema SQL (sin dump grande; ese va en Releases) |
| `supabase/functions/` | Edge Functions (chatbot, create-fragment, enciclopedia) |
| `n8n-workflows/` | Exports de ejemplo (redactados) |

## Origen del contenido

- **Backend / datos:** proyecto Supabase del compañero (`roxbekpxdgvqbosepmdd`) — videos, fragmentos, bible chunks, embeddings.
- **Frontend / extras:** este repo — UI, dashboard, artículos WordPress, Docker, `enciclopedia`.

## Requisitos

- Docker + Docker Compose

## Arranque rápido

```bash
cd stack
cp .env.example .env
docker compose up -d --build
```

Si tienes un backup de BD:

```bash
./scripts/restore-db.sh ~/Downloads/palabra-pura-db-YYYY-MM-DD.sql.gz
```

O el import clásico con `data.sql` local:

```bash
./import-db.sh
```

Puertos por defecto:

- Chat: http://localhost:8088/
- Dashboard: http://localhost:8088/dashboard/
- n8n: http://localhost:5688/
- Postgres: localhost:5488

Demo HTTPS opcional:

```bash
docker compose up -d tunnel
docker logs -f palabra-pura-tunnel
```

Ver `stack/PUBLIC_ACCESS.md`.

## Cómo responde el chat

El contenedor `web` sirve la página **y** el cerebro del chat en `/api/chat`:

- `CHAT_MODE=local` → responde con la base propia (pgvector + Gemini + OpenRouter)
- `CHAT_MODE=proxy` → reenvía a la Edge Function de Supabase
- `CHAT_MODE=auto` → local si hay claves; si no, proxy
- `CHAT_MODE=asistida` → búsqueda + LLM sobre transcripciones (modo del server demo)

El front llama a `/api/chat` (same-origin) y, si no existe, cae a la Edge Function.
Detalle en [SERVIDOR.md](./SERVIDOR.md).

Cada respuesta local se registra en Postgres junto con su pregunta y el fragmento
literal utilizado. El dashboard público muestra esos intercambios como fichas
expandibles; no publiques información privada en las preguntas.

La recuperación combina el índice textual GIN con pgvector. Herramientas:

```bash
./stack/scripts/apply-migrations.sh
docker compose -f stack/docker-compose.yml --profile transcribe run --rm \
  --entrypoint node transcribe audit-retrieval.mjs
docker compose -f stack/docker-compose.yml --profile transcribe run --rm \
  --entrypoint node transcribe reindex-fragment-embeddings.mjs --dry-run
```

En las respuestas con versículos puedes cambiar entre **TLA** y **Reina-Valera Antigua**.

Artículos vía WordPress público de [iglesiapalabrapura.com](https://iglesiapalabrapura.com/site/articulos/).

## License

MIT
