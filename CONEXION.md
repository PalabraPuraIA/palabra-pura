# Conexión Palabra Pura — cuentas y backends

Este repositorio es **solo** del proyecto Iglesia Palabra Pura.
No usa cuentas personales de Fintek ni otros GitHub.

## Cuentas oficiales

| Servicio | Cuenta |
|----------|--------|
| GitHub | [PalabraPuraIA](https://github.com/PalabraPuraIA) |
| Email / Supabase | `palabrapuraia@gmail.com` |
| Supabase project | `roxbekpxdgvqbosepmdd` |

## Qué aporta cada parte

| Origen | Qué trae |
|--------|----------|
| **Compañero (contenido / backend)** | Proyecto Supabase con videos, fragmentos, bible chunks, embeddings y Edge Function `chatbot-iglesia-palabra-pura` |
| **Este repo (front + extras)** | UI del chat, dashboard de analytics, panel de artículos WordPress, stack Docker/n8n, función `enciclopedia` |

## Supabase (producción)

- **URL:** `https://roxbekpxdgvqbosepmdd.supabase.co`
- **Chat:** `…/functions/v1/chatbot-iglesia-palabra-pura`
- **Publishable key (frontend):** en `web/app/js/config.js` → `publishableKey`
- **Secret key:** solo en dashboard / `.env` local — **nunca en git**

### Tablas principales (contenido del compañero)

| Tabla | ~filas |
|-------|--------|
| video | 226 |
| fragment | 2592 |
| bible_chunks | 10364 |
| bible_parents | 1190 |
| verses | 31102 |
| books | 66 |

### Edge Functions

- `chatbot-iglesia-palabra-pura` — chatbot (videos → bible chunks)
- `create-fragment` — alta de fragmentos
- `enciclopedia` — entry / status JSON (código en este repo)

## Frontend local

Config central: `web/app/js/config.js`

- `endpoint` → Edge Function del proyecto `roxbekpxdgvqbosepmdd`
- `publishableKey` → header `apikey` (requerido por el gateway nuevo de Supabase)
- Artículos: proxy `/api/articles` → iglesiapalabrapura.com

## Arranque local

```bash
cd stack
cp .env.example .env   # si no existe
docker compose up -d --build
```

- Chat: http://localhost:8088/
- Dashboard: http://localhost:8088/dashboard/

## Desplegar funciones a Supabase

```bash
supabase login
supabase link --project-ref roxbekpxdgvqbosepmdd
supabase functions deploy chatbot-iglesia-palabra-pura
supabase functions deploy create-fragment
supabase functions deploy enciclopedia
```

## Nota histórica

Antes hubo un proyecto Supabase `oxlmqzheogkharxpqjwp` y un repo en cuenta personal.
La fuente de verdad de **contenido** es `roxbekpxdgvqbosepmdd`.
Este repo ya apunta solo a esa cuenta / proyecto.
