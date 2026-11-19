# Deploy

Qroove runs on the **Sataklela VPS** (`64.247.186.195`) as one Docker Compose service behind Caddy and
Cloudflare, at `qroove.sataklela.com`. It moved from Railway on **2026-11-19 at 11:50:36 UTC**. Railway still
runs the same build as a rollback target until it is decommissioned (see "Rollback to Railway" below).

| Item            | Value                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| Host            | VPS `deploy@64.247.186.195`, app dir `/srv/qroove`, port `127.0.0.1:8110` |
| Health check    | `/api/health` (Compose healthcheck and `sk-deploy` gate)                 |
| Railway (old)   | `qroove`, environment `production`, service `web`: rollback only        |
| Database        | Firestore project `qroove-sataklela` (see [Firebase](/runbook/firebase)) |
| DNS             | [Cloudflare](/runbook/dns-cloudflare)                                    |

## Variables (`/srv/qroove/.env` on the VPS, mode 600; Railway keeps a copy)

`NODE_ENV=production`, `PUBLIC_BASE_URL=https://qroove.sataklela.com`, `REPO_DRIVER=firestore`,
`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_B64`, `COOKIE_SECRET`, `CRON_SECRET`,
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and optionally `YOUTUBE_API_KEY` (a Google Cloud key restricted to the YouTube Data API v3; it allows about 99 new song matches a day). `PUBLIC_BASE_URL` must match the address people use: admin
cookies are `Secure` and the same-origin check compares against it.

## Deploying

- Push to `main`. A systemd timer on the VPS (`sk-deploy.timer`, every 2 minutes) fetches `main`, builds the
  image, restarts the service and waits for `/api/health`. If the new build is unhealthy, it puts the previous
  image back. The log is `/var/log/sk-deploy.log`.
- Deploy now, or redeploy: `ssh deploy@64.247.186.195 sk-deploy qroove --force`.
- Logs: `cd /srv/qroove && docker compose logs -f`. Caddy access log: `/var/log/caddy/access.log`.
- Change a variable: edit `/srv/qroove/.env`, then `docker compose up -d` in `/srv/qroove`. Make the same change
  on Railway while it is still the rollback target.
- Railway also still deploys `main` on every push, which keeps the rollback target current.

## Rollback to Railway

In Cloudflare, change `qroove.sataklela.com` back to `CNAME jy6odhax.up.railway.app` with the proxy **off**.
This is the record as it was before 2026-11-19.
- The server logs a `retention purge` line at start-up; its presence confirms Firestore access works.

## Verify a deploy

```sh
curl -s https://qroove.sataklela.com/api/health      # {"ok":true,...}
curl -sI https://qroove.sataklela.com/docs/changelog  # 200
```

## Smoke test on two real phones

1. Phone A: open the site, **Create an event** (it opens the organiser page directly), **Start**.
2. Phone B (not on the same Wi-Fi if possible): join with the code or QR, add a song by pasting a Spotify
   link, and one by title.
3. Phone A: the request appears; open the player on the speaker device, do the **sound check** through the
   real speakers and Bluetooth, choose a file or use manual mode, and play a song.
4. Phone B: now playing and the countdown update without reloading; put the phone in aeroplane mode and back
   to see the connection badge recover.
5. Phone A: hand over to Phone B (handover link), confirm Phone A is then refused.
6. End the event; confirm carry-over lists the unplayed songs.
7. Install the PWA to the home screen on each phone and reopen it.
8. Check `docker compose logs` on the VPS for errors and that no secrets or tokens appear.

Results of this checklist are not recorded in the repository; note them in the pilot log.
