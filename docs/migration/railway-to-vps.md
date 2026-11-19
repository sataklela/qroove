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
| Ingress | *(Until 2026-11-19 17:39; now Coolify's Traefik, see "Platform: Coolify")* Caddy (system service). `/etc/caddy/Caddyfile` imports `/etc/caddy/sites/<app>.caddy`, which reverse-proxies to `127.0.0.1:<port>` |
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

## Platform: Coolify (since 2026-11-19 17:39 UTC)

Every app on the VPS now runs under **Coolify 4.7.6**: https://coolify.sataklela.com (Coolify login with 2FA, rate-limited by Cloudflare; Zero Trust team `sataklela` exists for later use). This replaces the system Caddy, `sk-deploy` and the host crons, which are kept disabled until the 7-day rollback window ends.

| | How it works now |
|---|---|
| Build | Coolify builds each repo's `Dockerfile` (added 2026-11-19). Build-time variables reach `RUN` steps as BuildKit secrets ("use build secrets"), except vangotthis, whose Dockerfile takes build args. |
| Deploy | `cool-poll.timer` (every 2 min) reads `main` with each repo's read-only deploy key and asks Coolify to deploy when it changes. Coolify builds, waits for the health check, and **keeps the old container if the new one is unhealthy**. Log: `/var/log/cool-poll.log`; pause an app by putting its name in `/etc/cool-poll.paused`. GitHub webhooks can replace the poller later. |
| Rollback | Coolify dashboard → app → Deployments → Rollback, or redeploy an earlier commit. |
| Proxy and TLS | Coolify's Traefik (`coolify-proxy`) on 80/443 with the Cloudflare Origin CA certificates (`/data/coolify/proxy/certs`, `dynamic/origin-certs.yaml`). Let's Encrypt is never needed: every record is proxied, SSL mode Full (strict). |
| Firewall | Docker-published ports bypass ufw, so `/etc/ufw/after.rules` adds a `DOCKER-USER` block: 80/443 only from Cloudflare's ranges; Coolify's 8000/6001/6002 and Traefik's 8080 are never reachable from outside. |
| Crons | Coolify scheduled tasks, run inside the app container: sataklela `ledger` (hourly), `billing` and `retention` (06:00 UTC); UnTXT `ci-frequent` (every 5 min) and `ci-weekly` (Mon 06:30 UTC). History: dashboard → app → Scheduled Tasks. |
| Stateful | rajiniskitchen.com (WordPress + MariaDB) and the OpenClaw bridge run as Coolify Compose services, using the same data folders (`/srv/rajiniskitchen/{html,db}`, `/srv/openclaw/data`). sataklela's Gotenberg is its own Coolify service, reachable as `doc-converter:3000`. |
| Backups | `sk-backup` nightly 02:15 UTC (14 days, local): rajiniskitchen DB + wp-content, OpenClaw state, Coolify's database, all config. Off-site copies: not yet. |
| Billing | Coolify does not meter usage. A separate usage meter will feed sataklela's client billing; until it is live, the three billed Railway projects stay. 2026-11-19 is not billed (decided by Raunak). |

### Switch-over record (2026-11-19, UTC)
- 17:36–17:38 UnTXT first built in Coolify; the old container was stopped at 17:38:52. **www.untxt.uk was down about 16 s** (17:38:52 to ~17:39:08) because public traffic still went through the old Caddy to the stopped container until the proxy handover.
- **17:39:03 system Caddy stopped; 17:39:14 Coolify's proxy healthy.** Every other site answered through Coolify by 17:39:22.
- **rajiniskitchen.com was down about 4 min 13 s** (17:39:03 to 17:43:16): its old stack was reachable only through Caddy, and the first start request for its Coolify service was sent with the wrong HTTP method. Two MariaDB processes must never share a data folder, so the old one was stopped before the new one started.
- **OpenClaw bridge: Slack bots offline about 5 min** (17:43:26 to 17:48:31): the old gateway's lease row (5-minute TTL) was not released on shutdown, so the new gateway retried until it expired. Same behaviour as on the Railway move.
- 17:50:40 host crons retired (moved to `/root/retired-crons-2026-11-19`); Coolify ran `ci-frequent` at 17:55 and 18:00 and `ledger` at 18:00, all successful.
- 18:03 `cool-poll` on, `sk-deploy` off; old containers stopped (not removed).
- Coolify's dashboard ports were reachable from the internet for about 12 minutes after install (16:38–16:50): Docker bypasses ufw. The admin account already existed and registration was closed; no outside requests were logged. Fixed with the `DOCKER-USER` rules.
- Browser check after the switch: 12 URLs, no console errors, no failed requests, no broken images.

## Control plane: working from a browser (since 2026-11-19)

No codespace is needed any more. Everything runs from a browser against the VPS.

| Page | What it is |
|---|---|
| https://control.sataklela.com | **Root terminal** (ttyd, systemd `control-ttyd`). Opens in `/root/sataklela/` with every repo; Node 22, Claude Code, GitHub CLI and the VS Code CLI are installed. Project secrets (`.env`, Central Services keys, `handover/`) are in `/root/sataklela/sataklela/`, root-only and git-ignored. |
| https://desktop.sataklela.com | Web desktop with Chromium (Coolify service `desktop`), for visual checks. |
| https://vscode.dev | VS Code connected to the VPS via Remote Tunnels (root's `code-tunnel` user service; lingering enabled so it survives logout/reboot). |
| https://coolify.sataklela.com | Coolify (own login + 2FA). |

**Two independent locks on control/desktop/auth:**
1. **Cloudflare Access** (Zero Trust team `sataklela`, app "Sataklela control plane"): one-time code emailed to sataklela@gmail.com; nobody else is allowed. 8-hour session.
2. **Authelia** (`https://auth.sataklela.com`, Coolify service `authelia`, config `/srv/control/authelia`): username `raunak` + hand-typed password + TOTP. 3 failed attempts → 1-hour ban.

Only after both does the proxy (Traefik, `/data/coolify/proxy/dynamic/control.yaml`) add a secret credential that the terminal and desktop require, so even a container on the shared Docker network cannot open them. The terminal listens only on the internal Docker address `172.17.0.1:7681`. SSH still refuses root password logins.

**Commands (run on the VPS):**
- `control-set-password`: set the login-page password (typed, never stored in clear).
- `control-2fa-code`: show the one-time code Authelia "sends" when registering or resetting the authenticator app.
- `coolify-set-password`: set the Coolify admin password. **Coolify revokes that account's API tokens on every password change**, so automation uses a separate service account (`automation@coolify.sataklela.local`, token in `~deploy/.config/sk/coolify-token`).

**Railway status (2026-11-19 23:00 UTC):** every project deleted except **Axelrod**, which is stopped and kept as the rollback until the Fri 2026-11-20 15:40 ET rebalance succeeds on the VPS.

## Railway decommissioning (2026-11-19)

Railway projects **deleted** after the site checks passed (a headless Chromium check of all 12 URLs found no console errors, no failed requests and no broken images). Each deletion was checked before and after against the live URL:
purefab 16:04:46, infinity-ashvamedha 16:05:09, qroove 16:05:27, UnTXT OpenClaw bridge 16:06:04 (its volume was already on the VPS and in the nightly backup), CVaaS UnTXT Ecosystem 16:06:33, sataklela 16:07:02 (all UTC). Their final variables are kept, root-only, at `/var/backups/sataklela/railway-final/railway-final-2026-11-19.tgz` on the VPS. Their `_railway-verify` TXT records were removed.

**Still on Railway:** Axelrod (live trading; it moves at a weekend window), and **artedegoa.com, vangotthis and rajiniskitchen.com**. sataklela's client billing (`lib/billing/railwayUsage.ts`) reads those three projects' Railway usage, so they stay until a VPS usage meter replaces that source. They no longer serve traffic.

## Data locations (2026-11-19)

| App | Data | Location |
|---|---|---|
| artedegoa.com | Firestore `mumbai` + bucket `artedegoa-com-mumbai` | asia-south1 (moved 15:10 UTC) |
| vangotthis | Firestore `mumbai` + bucket `vangotthis-mumbai` | asia-south1 (moved 14:55 / 15:13 UTC) |
| rajiniskitchen.com | MariaDB on the VPS | Mumbai |
| qroove | Firestore `(default)` | eur3. **Stays in Europe for now** (a named database needs billing on `qroove-sataklela`) |
| sataklela, UnTXT, CVaaS | Firestore `(default)` | eur3, by decision |

**Rule: Sataklela Pvt Ltd clients keep all data in India** (see the `demo-site-deploy` skill).

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
