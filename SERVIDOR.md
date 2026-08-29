# Despliegue en el servidor propio

Guía del stack de Palabra Pura corriendo en `server-fintek`
(Ubuntu 24.04, usuario `fintek-1`, IP `10.45.178.129`, carpeta `/home/fintek-1/palabra-pura`).

## Contenedores

| Contenedor | Imagen | Para qué | Puerto |
|---|---|---|---|
| `palabra-pura-web` | build local (`web/Dockerfile`) | **Página + cerebro del chat** (`/api/chat`) + dashboard + artículos | `8088 → 80` |
| `palabra-pura-db` | `pgvector/pgvector:pg17` | Contenido: videos, transcripciones, Biblia y embeddings | `5488 → 5432` |
| `palabra-pura-n8n` | `n8nio/n8n` | Workflows de ingesta / embeddings (opcional) | `5688 → 5678` |
| `palabra-pura-tunnel` | `cloudflare/cloudflared` | Demo público HTTPS (opcional) | — |

La página y toda la lógica del chat viven en **un solo contenedor** (`palabra-pura-web`).
La base va aparte a propósito: ahí están los datos y su volumen (`palabra-pura-pgdata`),
así se puede reconstruir la app sin arriesgar el contenido.

## Accesos

- Chat: http://10.45.178.129:8088/
- Dashboard: http://10.45.178.129:8088/dashboard/
- Estado del chat: http://10.45.178.129:8088/api/chat/status

## Los dos modos del chat

El contenedor web decide con `CHAT_MODE` (en `stack/.env`):

| Modo | Qué hace | Requiere |
|---|---|---|
| `proxy` | Reenvía la pregunta a la Edge Function de Supabase | Nada (las claves están en Supabase) |
| `local` | Responde con la base del servidor: embeddings + búsqueda vectorial + LLM | `GEMINI_API_KEY` y `OPENROUTER_API_KEY` |
| `auto` | `local` si hay claves y base; si no, `proxy` | — |

Hoy está en **`auto` → resuelve como `proxy`**, porque el servidor todavía no tiene claves propias.
Ya funciona así de punta a punta.

### Pasar a 100% local (sin depender de Supabase)

1. Pon las claves en `/home/fintek-1/palabra-pura/stack/.env`:

```bash
CHAT_MODE=local
GEMINI_API_KEY=...          # el mismo proyecto que generó los embeddings
OPENROUTER_API_KEY=...
```

2. Recrea el contenedor:

```bash
cd /home/fintek-1/palabra-pura/stack
docker compose up -d web
curl -s localhost:8088/api/chat/status
```

**Importante:** el modelo de embeddings debe seguir siendo `gemini-embedding-001`
con 3072 dimensiones, porque así están vectorizados `fragment` y `bible_chunks`.
Cambiar de modelo obliga a re-vectorizar todo.

## Cómo responde en modo local

Mismo pipeline que la Edge Function, ejecutado en el servidor:

1. Vectoriza la pregunta (Gemini, 3072 dims).
2. `match_fragments` → 5 fragmentos de transcripción más cercanos.
3. El LLM responde **solo** con esos videos; si no le alcanza, devuelve `{found:false}`.
4. Fallback: `match_bible_chunks` + capítulo completo (`bible_parents`).
5. El texto del versículo se lee de `verses` (Reina-Valera Antigua). El modelo nunca lo escribe.

Respuesta: `answer` (IA), `excerpt` (recorte del audio), `passage` (versículo), `video`, `source`.

## Actualizar el servidor con la última versión

Desde el Mac, con el repo en `~/Documents/palabra-pura-migrate`:

```bash
rsync -az --delete \
  --exclude='.git/' --exclude='node_modules/' --exclude='db/data.sql' \
  --exclude='stack/.env' --exclude='stack/runtime/' \
  -e "ssh -i ~/.ssh/id_ed25519_fintek" \
  ./ fintek-1@10.45.178.129:/home/fintek-1/palabra-pura/

ssh -i ~/.ssh/id_ed25519_fintek fintek-1@10.45.178.129 \
  'cd /home/fintek-1/palabra-pura/stack && docker compose build web && docker compose up -d web'
```

`stack/.env` y los volúmenes de datos no se tocan.

## Diagnóstico rápido

```bash
docker ps --filter name=palabra-pura
docker logs --tail 30 palabra-pura-web
curl -s localhost:8088/api/chat/status

# Conteos del contenido
docker exec palabra-pura-db psql -U palabra -d palabra_pura -c \
  "SELECT 'video' t, count(*) FROM video UNION ALL SELECT 'fragment', count(*) FROM fragment
   UNION ALL SELECT 'bible_chunks', count(*) FROM bible_chunks UNION ALL SELECT 'verses', count(*) FROM verses;"
```

Referencia de contenido esperado: 226 videos · 2592 fragmentos · 10364 chunks · 31102 versículos.
