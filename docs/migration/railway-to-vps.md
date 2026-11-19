# Railway → VPS migration

_**Status (2026-11-19 13:30 UTC):** moved: qroove 11:50:36; purefab, infinity-ashvamedha and vangotthis 12:20:59–12:21:01; artedegoa.com 12:51:48; cvaas 12:57:27; UnTXT web 13:01:01 (CI crons 13:05, OpenClaw bridge 13:16:53); sataklela 13:23:38 (crons 13:24:48). All times UTC. Pending: **rajiniskitchen.com** (its DNS is at BigRock, not Cloudflare, so Raunak has to switch it) and **Axelrod** (live trading; weekend window only). The Firestore latency below was accepted by Raunak on 2026-11-19. Each repo's own times, incidents and rollback are under "Cutover record"._

_Started 2026-11-19. Org-wide: every Sataklela production service moves off Railway onto one
dedicated VPS. This file is identical in every repo except the **This repo** section._

> Supersedes the 2026-09-25 Codespace → VPS notes where they say "production stays on Railway".
> Production is now moving too.

## The server

| | |
|---|---|
| Provider | BigRock VPS on Oracle Cloud's network (AS31898), **in Mumbai, India**. TCP connect: AWS Mumbai 6.5 ms, Singapore 76 ms, Europe 130–190 ms, US East 200–275 ms. IP lookup services wrongly report Durham, NC. |
| IP | `64.247.186.195` |
| OS | Ubuntu 22.04 LTS, 4 vCPU, 11 GB RAM, 295 GB disk, UTC |
| Login | `ssh -i ~/.ssh/sataklela_vps deploy@64.247.186.195` (key only; `deploy` has passwordless sudo and Docker) |
| Firewall | ufw: 22, 80, 443 only. fail2ban on. |
| Runtime | Docker Engine + Compose plugin; one Compose project per app under `/srv/<app>/` |
| Ingress | Caddy (system service). `/etc/caddy/Caddyfile` imports `/etc/caddy/sites/<app>.caddy`, which reverse-proxies to `127.0.0.1:<port>` |
| TLS | Cloudflare **Origin CA** certificate (`/etc/caddy/certs/origin.pem`, key on the box only), valid until 2041-11-15, covering the apex and `*.` of sataklela.com, artedegoa.com, cvaas.uk, untxt.uk and vangotthis.com. So **every record pointing at the VPS must be proxied** (orange cloud). rajiniskitchen.com was added to Cloudflare on 2026-11-19 and has its own Origin CA cert (`origin-rk.pem`). |
| Deploys | Pull-based. Private repos are read over SSH with a **read-only deploy key per repo** (`~deploy/.ssh/deploykeys/<app>`, registered on GitHub 2026-11-19 as "VPS deploy (read-only) 64.247.186.195"). Nothing depends on anyone's codespace. `sk-deploy.timer` runs every 2 min and runs `/usr/local/bin/sk-deploy <app>` for each `/srv/*/deploy.conf`: it fetches `main`, builds, restarts, checks health and rolls back if unhealthy. Log: `/var/log/sk-deploy.log`. Private repos need a read-only deploy key (`~deploy/.ssh/deploykeys/<app>`) registered on GitHub. |
| DNS fix | BigRock's image set `search webhostbox.com` (a wildcard domain) in `/etc/resolv.conf`, so unknown names such as `metadata.google.internal` resolved to a parking server. Removed 2026-11-19; original at `/root/resolv.conf.orig-2026-11-19`. **If a reinstall or BigRock support puts it back, Google SDKs will hang again.** |

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

**Measured 2026-11-19, and it matters.** Most services run in Railway **europe-west4** (Netherlands) and
CVaaS and UnTXT in **us-east4**. The VPS is in Mumbai (see above).

- **Accepted 2026-11-19 (option 3): migrate anyway.**
- **Firestore apps are hit hardest.** qroove's database is in `eur3`. From the VPS a single query takes
  0.4–2.2 s, against a few ms from Railway. qroove's startup purge takes 47 s instead of 6 s. End to end, a
  Firestore-backed API call went from about 0.43 s to 0.6–1.0 s (measured from a client outside both). Any app
  that makes several sequential Firestore calls per request multiplies this.
- US-hosted apps (UnTXT, CVaaS) move about 275 ms further from US users.
- Static pages behind Cloudflare are mostly unaffected.

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

**Moved 2026-11-19 11:50:36 UTC** (first app). DNS changed from an unproxied CNAME `jy6odhax.up.railway.app` to a proxied
A record `64.247.186.195`. Incidents and the open Firestore latency issue are in `CHANGELOG.md` under [Unreleased];
operations are in `docs/src/runbook/deploy.md`.
