# Optional public HTTPS (Cloudflare quick tunnel)

This Compose service publishes **only** the `web` container through Cloudflare.

```bash
cd stack
docker compose up -d tunnel
docker logs -f palabra-pura-tunnel
```

Look for a `https://*.trycloudflare.com` URL in the logs.

Notes:

- Quick tunnels are for demos; the URL can change after restart.
- For a stable hostname, use a Cloudflare named tunnel and your own domain.
- Point public traffic at the web UI only — not the database or n8n admin UI.
