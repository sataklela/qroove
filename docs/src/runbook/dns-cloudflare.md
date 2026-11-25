# DNS (Cloudflare)

Zone `sataklela.com` is on Cloudflare. Qroove uses one record (since the move to the VPS on 2026-11-19):

| Type | Name     | Target                     | Proxy            |
| ---- | -------- | -------------------------- | ---------------- |
| A    | `qroove` | `64.247.186.195` (the VPS) | Proxied (orange) |

TLS: SSL/TLS mode **Full (strict)**; the VPS presents a Cloudflare **Origin CA** certificate (valid until
2041, covers `*.sataklela.com`) from Coolify's Traefik proxy. The firewall only accepts 80/443 from
Cloudflare's ranges, so the site is reachable only through Cloudflare.

## Adding or changing the domain

1. Add the domain to the `qroove-web` app in Coolify (Domains), then redeploy.
2. Create or change the record in Cloudflare (dashboard, or the `cloudflare` MCP server): A record to the
   VPS, **proxied**. This is a DNS change that can take the site down: check with the owner first.
3. Check `curl -s https://qroove.sataklela.com/api/health`.

## Proxy notes

Live updates use
Server-Sent Events; the server already sends `Cache-Control: no-cache` and `X-Accel-Buffering: no` on streams,
which Cloudflare honours. Keep **Rocket Loader** off for this hostname and do not add caching rules for
`/api/*`. If streams stall after enabling the proxy, switch back to DNS only; the client falls back to
polling every 10 s regardless.
