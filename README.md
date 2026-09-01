# palabra-pura-chatbot
Cuando empezamos a conocer y buscar a Dios, las preguntas nos acompañan a diario. Con esta herramienta podemos acercarnos a las respuestas a esas inquietudes en el momento y lugar que se requieran, incluso si no estás cerca de una sede de la iglesia o de un maestro a quien preguntarle. Esta enciclopedia responde con las enseñanzas del ministerio y el pasaje bíblico correspondiente, para que tú mismo lo busques en tu Biblia y lo compruebes.



# Palabra Pura — chatbot stack

Stack del chatbot de la **Iglesia Palabra Pura**: front web, Postgres (pgvector),
workflows n8n opcionales y tunnel Cloudflare para demos.

> **Cuentas:** GitHub [`PalabraPuraIA`](https://github.com/PalabraPuraIA) · Supabase `roxbekpxdgvqbosepmdd`  
> Conexión y credenciales: [CONEXION.md](./CONEXION.md) · Despliegue propio: [SERVIDOR.md](./SERVIDOR.md)

## Qué hay en este repo

| Path | Contenido |
|------|-----------|
| `web/app/` | Frontend del chat (respuestas, YouTube, artículos) + dashboard |
| `stack/` | `docker-compose.yml` y helpers |
| `db/` | Schema SQL (sin dump grande de datos) |
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

Puertos por defecto:

- Chat: http://localhost:8088/
- Dashboard: http://localhost:8088/dashboard/
- n8n: http://localhost:5688/
- Postgres: localhost:5488

Importar schema (y tu `data.sql` si lo tienes):

```bash
./import-db.sh
```

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

El front llama a `/api/chat` (same-origin) y, si no existe, cae a la Edge Function.
Detalle en [SERVIDOR.md](./SERVIDOR.md).

Artículos vía WordPress público de [iglesiapalabrapura.com](https://iglesiapalabrapura.com/site/articulos/).

Base del UI: [miliverso/palabra-pura-chatbot](https://github.com/miliverso/palabra-pura-chatbot).

## License

MIT
