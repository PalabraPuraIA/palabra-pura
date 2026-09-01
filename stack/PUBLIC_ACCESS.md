# Acceso público — enlaces estables

Los tunnels rápidos de Cloudflare (`*.trycloudflare.com`) cambian de hostname al reiniciar.
**No los uses como bookmark.**

## Enlaces permanentes (cuando GitHub Pages esté activo)

- **Chat:** https://palabrapuraia.github.io/palabra-pura/
- **Dashboard:** https://palabrapuraia.github.io/palabra-pura/dashboard.html

Aliases vía Edge Function (302 / JSON de estado):

- https://roxbekpxdgvqbosepmdd.supabase.co/functions/v1/enciclopedia
- https://roxbekpxdgvqbosepmdd.supabase.co/functions/v1/enciclopedia/dashboard

## Ops

`stack/scripts/tunnel-watchdog.sh` (cron cada 2 minutos en el host):

1. Revisa LAN web + tunnel público
2. Reinicia el tunnel si la URL pública cae
3. Publica `public_base_url` en Supabase `app_settings` para el status API
