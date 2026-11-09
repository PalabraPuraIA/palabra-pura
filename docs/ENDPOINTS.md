# Endpoints — mapa real (API vs consumo vs directo)

Actualizado: noviembre 2026 (tras cablear `knowledge-hub` y `analytics/rate`).

## Leyenda

| Etiqueta | Significado |
|----------|-------------|
| **API** | Ruta en Express (`web/server`) |
| **Consumido** | El front lo llama en el flujo normal |
| **Directo** | El front llama a Supabase / WordPress / archivo local, no a Express |
| **Ops** | Existe para monitoreo; no es el flujo UI principal |

---

## 1. API Express — chat y salud

| Método | Ruta | Consumido | Notas |
|--------|------|-----------|-------|
| POST | `/api/chat` | Sí (server/Docker) | En Pages suele ir a Edge Supabase |
| GET | `/api/chat/status` | Ops | `curl` / monitoreo |
| GET | `/api/health` | Sí (probe) | `backend.js` |
| GET | `/api/life-areas` | Sí | Catálogo local si falla |
| GET | `/api/articles` | Sí (server) | En Pages → WordPress **directo** |
| GET | `/api/public-url` | Ops / login | También `./public-url.json` |

## 2. API Express — auth panel

| Método | Ruta | Consumido |
|--------|------|-----------|
| POST | `/api/auth/login` | Sí |
| GET | `/api/auth/me` | Sí |
| POST | `/api/auth/logout` | Sí |

Ya **no** hay fallback de contraseñas hardcodeadas en el front: solo responde el API.

## 3. API Express — knowledge / facts / corpus / hub

| Método | Ruta | Consumido | Auth |
|--------|------|-----------|------|
| GET/PATCH/DELETE | `/api/knowledge*` | Admin (parcial) | Sí |
| POST | `/api/knowledge/feedback` | Sí (chat) | No |
| POST | `/api/knowledge-hub` | Sí (dashboard knowledge en server) | Sí |
| CRUD | `/api/facts*` | Admin | Sí |
| GET | `/api/corpus` | Admin | Sí |

En **GitHub Pages**, el hub usa Edge Function `knowledge-hub` (**directo**).

## 4. API Express — ingest

| Método | Ruta | Consumido |
|--------|------|-----------|
| GET | `/api/ingest/jobs` | Sí |
| GET | `/api/ingest/jobs/:id` | Disponible |
| POST | `/api/ingest` | Sí |

## 5. API Express — analytics

| Método | Ruta | Consumido |
|--------|------|-----------|
| POST | `/api/analytics/event` | Sí |
| POST | `/api/analytics/rate` | Sí (ratings útil/no útil) |
| GET | `/api/analytics/summary` | Sí (dashboard) |

## 6. Llamadas **directas** (fuera de Express)

| Destino | Cuándo |
|---------|--------|
| Edge `chatbot-iglesia-palabra-pura` | Pages / fallback / `CHAT_MODE=proxy` |
| Edge `knowledge-hub` | Dashboard en Pages (+ helpers ingest) |
| Supabase REST `chat_interactions` / `chat_ratings` | Fallback analytics |
| WordPress REST | Artículos en Pages |
| `./public-url.json` | Resolver túnel Fintek sin hardcode |

## 7. Sync Pages

```bash
./stack/scripts/sync-pages.sh
```

Copia `web/app` → `docs/` (css, js, dashboard, assets, index, login) sin borrar los `.md` de documentación.
