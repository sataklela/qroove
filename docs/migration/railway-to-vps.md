# Railway → VPS migration

_Started 2026-11-19. Org-wide: every Sataklela production service moves off Railway onto one
dedicated VPS. This file is identical in every repo except the **This repo** section._

> Supersedes the 2026-09-25 Codespace → VPS notes where they say "production stays on Railway".
> Production is now moving too.

## The server

| | |
|---|---|
| Provider | BigRock VPS (hosted on Oracle Cloud, Durham NC, US) |
| IP | `64.247.186.195` |
| OS | Ubuntu 22.04 LTS, 4 vCPU, 11 GB RAM, 295 GB disk, UTC |
| Login | `ssh -i ~/.ssh/sataklela_vps deploy@64.247.186.195` (key only; `deploy` has passwordless sudo and Docker) |
| Firewall | ufw: 22, 80, 443 only. fail2ban on. |
| Runtime | Docker Engine + Compose plugin; one Compose project per app under `/srv/<app>/` |
| Ingress | Caddy (system service), `/etc/caddy/Caddyfile`, one site block per domain, reverse-proxy to `127.0.0.1:<port>` |

Credentials (VPS password, SSH key) are **not** in any repo. Ask Raunak.

## Target layout per app

```
/srv/<app>/
  compose.yaml      # services, ports bound to 127.0.0.1 only
  .env              # rebuilt from `railway variables`; chmod 600, never committed
  data/             # bind mounts replacing Railway volumes
```

Ports: each app gets a fixed loopback port (see table below). Containers never publish on
0.0.0.0; only Caddy faces the internet.

## Port and domain map (all apps)

| App (repo) | Railway project / service | Domains | VPS port | Volume |
|---|---|---|---|---|
| sataklela | sataklela / sataklela (+5 helpers) | sataklela.com, www.sataklela.com | 8101 | none |
| sataklela gotenberg | sataklela / doc-converter | internal only | 8102 | none |
| UnTXT | CVaaS UnTXT Ecosystem / UnTXT | www.untxt.uk | 8103 | none |
| UnTXT openclaw-bridge | UnTXT OpenClaw bridge | none (outbound) | n/a | `/data` 5 GB |
| cvaas | CVaaS UnTXT Ecosystem / CVaaS | app.cvaas.uk | 8104 | none |
| Axelrod | Axelrod / Axelrod | axelrod.sataklela.com | 8105 | `/data` 5 GB |
| artedegoa.com | artedegoa.com / arte-web | artedegoa.com, www | 8106 | none (Firestore) |
| rajiniskitchen.com | rajiniskitchen.com / Primary + mariadb | rajiniskitchen.com, www | 8107 | `/var/www/html`, `/var/lib/mysql` |
| vangotthis | vangotthis / vangotthis | www.vangotthis.com | 8108 | none |
| infinity-ashvamedh | infinity-ashvamedha / web | infinity-ashvamedha.sataklela.com | 8109 | none |
| qroove | qroove / web | qroove.sataklela.com | 8110 | none |
| purefab | purefab / purefab | purefab.sataklela.com | 8111 | none |

## Cutover procedure (per app)

1. **Build** on the VPS: `git clone` into `/srv/<app>/src`, `docker compose build`.
2. **Env**: `railway variables --kv > /srv/<app>/.env` (run from a linked checkout), `chmod 600`.
   Replace Railway-only values: `RAILWAY_*`, `PORT`, internal hostnames (`*.railway.internal`).
3. **Data**: for apps with a volume, stop writes on Railway (scale to 0 or maintenance mode),
   copy the volume (`railway ssh` + `tar`), restore into `/srv/<app>/data/`.
4. **Smoke test** before DNS: `curl -H 'Host: <domain>' http://127.0.0.1:<port>/` on the box,
   then `curl --resolve <domain>:443:64.247.186.195 https://<domain>/` from outside.
5. **DNS** (Cloudflare): point the record at `64.247.186.195` (A record, proxied). Keep TTL auto.
   Railway keeps running untouched as the rollback target.
6. **Watch** 24 h: logs (`docker compose logs -f`), Caddy access log, payment webhooks.
7. **Decommission**: only after a clean 7 days, remove the custom domain from Railway, then
   delete the service. Never delete a Railway volume before the VPS copy is verified.

**Rollback**: point DNS back at the Railway target (the old CNAME, recorded in the per-repo
section below). Railway is untouched until step 7, so rollback is a single DNS edit.

## Order

Low risk first: qroove, purefab, infinity-ashvamedh, vangotthis → artedegoa.com →
rajiniskitchen.com (WordPress + MariaDB, data copy) → cvaas, UnTXT (+ crons, bridge) →
sataklela (payments, billing crons) → Axelrod last (live trading; cut over on a weekend,
outside market hours).

## Latency

Most services run in Railway **europe-west4** (Netherlands) today. The VPS is in North Carolina,
so EU visitors gain roughly 80–100 ms per uncached round trip. Cloudflare proxying hides most
of it for static assets. UnTXT and CVaaS already run in us-east4, so they barely change.

## Crons

Railway cron services become host cron entries or a Compose service running `supercronic`,
in **UTC**. Railway cron schedules are UTC too, so times carry over unchanged.

## Things that do not move

Firebase/Firestore, Cloudflare (DNS, R2, Workers), Google Apps Script projects, Zoho mail,
Razorpay/Wise/Stripe accounts. Only the compute moves; webhook URLs keep their hostnames, so
no provider dashboard changes are needed if the domain stays the same.

## This repo: qroove

**Railway**: project `qroove` (`0b641c46-8212-47d0-855e-2c9d5c0c64bb`), service `web`.
`railway.json`: Dockerfile builder, healthcheck `/api/health`, restart on failure (5 retries).
Node ≥24, pnpm workspace.

**Domains**: `qroove.sataklela.com`. VPS port 8110. No volumes.

Carry the healthcheck over as a Compose `healthcheck` against `/api/health`, with
`restart: on-failure:5`. Update `docs/src/runbook/deploy.md` at cutover.

Suggested as the **first** app to move: one stateless service with an existing healthcheck.
