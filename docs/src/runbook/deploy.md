# Deploy

Qroove runs on the **Sataklela VPS** (`64.247.186.195`) under **Coolify** (since 2026-11-19 17:39 UTC),
behind Coolify's Traefik proxy and Cloudflare, at `qroove.sataklela.com`. It moved off Railway on
2026-11-19 (DNS switch 11:50:36 UTC); the Railway project has since been deleted. History:
`docs/migration/railway-to-vps.md`.

| Item         | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Coolify app  | `qroove-web` (uuid `9glh9rlvrpifjpcphotmzlad`), https://coolify.sataklela.com    |
| Build        | Coolify builds the repo `Dockerfile`                                             |
| Health check | `/api/health` (Coolify keeps the old container if the new one fails it)          |
| Database     | Firestore project `qroove-sataklela`, `eur3` (see [Firebase](/runbook/firebase)) |
| DNS          | [Cloudflare](/runbook/dns-cloudflare)                                            |

## Variables (Coolify app → Environment variables)

`NODE_ENV=production`, `PUBLIC_BASE_URL=https://qroove.sataklela.com`, `REPO_DRIVER=firestore`,
`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_B64`, `COOKIE_SECRET`, `CRON_SECRET`,
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
`ANDROID_CERT_SHA256` (comma-separated: our release key, plus Play's app-signing key once the app is on
Play), and optionally `YOUTUBE_API_KEY` (a Google Cloud key restricted to the YouTube Data API v3; about 99
new song matches a day). `PUBLIC_BASE_URL` must match the address people use: admin cookies are `Secure`
and the same-origin check compares against it.

- Change a variable: in the Coolify dashboard, or on the VPS in bulk with
  `cool-env 9glh9rlvrpifjpcphotmzlad <dotenv-file>`, then redeploy.
- Values are never written to the repo or chat; secrets that are files live in `/srv/qroove/secrets/`.

## Deploying

- Push (merge) to `main`. `cool-poll.timer` on the VPS (every 2 minutes) sees the new commit and asks
  Coolify to deploy; Coolify builds, waits for `/api/health` and only then swaps containers. Log:
  `/var/log/cool-poll.log`; build logs in the Coolify dashboard. Pause automatic deploys with
  `touch /etc/cool-poll.paused`.
- Deploy now: `cool-deploy 9glh9rlvrpifjpcphotmzlad` (add `--force` to rebuild without cache).
- Logs: Coolify dashboard → `qroove-web` → Logs, or `docker logs` on the app container.
- The Android app loads the live site, so a web deploy updates the app too; only native changes need a
  new APK/AAB (see [Android app](/runbook/android)).

## Rollback

Coolify dashboard → `qroove-web` → Deployments → **Rollback** to an earlier image, or revert the commit on
`main` and let it deploy. The server logs a `retention purge` line at start-up; its presence confirms
Firestore access works.

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
8. Check the Coolify logs for errors and that no secrets or tokens appear.

Results of this checklist are not recorded in the repository; note them in the pilot log.
