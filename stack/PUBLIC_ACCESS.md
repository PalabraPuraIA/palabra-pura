# Public access — stable links

Quick Cloudflare tunnels (`*.trycloudflare.com`) change hostname on restart.
**Do not bookmark** those temporary hostnames — reload will fail there.

## Permanent links (bookmark / share these)

- **Chat:** https://erickcherry.github.io/palabra-pura-stack/
- **Dashboard:** https://erickcherry.github.io/palabra-pura-stack/dashboard.html

These GitHub Pages never change. They load the current tunnel inside the page,
so when Cloudflare rotates the tunnel hostname the stable link still works after refresh.

Aliases (302 → same pages):

- https://oxlmqzheogkharxpqjwp.supabase.co/functions/v1/enciclopedia
- https://oxlmqzheogkharxpqjwp.supabase.co/functions/v1/enciclopedia/dashboard

## Ops

`stack/scripts/tunnel-watchdog.sh` (cron every 2 minutes on the host):

1. Checks LAN web + public tunnel
2. Restarts tunnel if the public URL is down
3. Publishes `public_base_url` to Supabase `app_settings` for the status API
EOF
