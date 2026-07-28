# Palabra Pura — chatbot stack

Docker Compose project for the **Palabra Pura** chatbot: web UI, Postgres (pgvector),
optional n8n workflows, and optional Cloudflare Tunnel for HTTPS demos.

## What's in this repo

| Path | Contents |
|------|----------|
| `web/app/` | Chatbot frontend (answers, embedded YouTube, related articles) |
| `stack/` | `docker-compose.yml` and helpers |
| `db/` | SQL schema (`schema.sql` / `schema.clean.sql`). No large data dump |
| `n8n-workflows/` | Sample / redacted workflow JSON exports |

## Not included

- Database data dump (`db/data.sql`)
- Real secrets (use `stack/.env.example`)
- Deployment targets or private infrastructure details

## Requirements

- Docker + Docker Compose

## Quick start

```bash
cd stack
cp .env.example .env
docker compose up -d --build
```

Default ports (change in `docker-compose.yml` if needed):

- Chat: http://localhost:8088/
- Dashboard: http://localhost:8088/dashboard/
- n8n: http://localhost:5688/
- Postgres: localhost:5488

Each chat question is logged locally (JSON in a Docker volume) and summarized on the dashboard.
Import schema (and your own data file if you have one):

```bash
./import-db.sh
```

Optional public HTTPS demo via Cloudflare quick tunnel:

```bash
docker compose up -d tunnel
docker logs -f palabra-pura-tunnel
```

See `stack/PUBLIC_ACCESS.md`.

## Frontend notes

- Backend URL: `web/app/js/config.js` or the in-page Connect button
- YouTube embed when the API returns `youtube_id`
- Related articles via the public WordPress REST API of [iglesiapalabrapura.com](https://iglesiapalabrapura.com/site/articulos/)

Frontend originally based on [miliverso/palabra-pura-chatbot](https://github.com/miliverso/palabra-pura-chatbot).

## License

MIT
