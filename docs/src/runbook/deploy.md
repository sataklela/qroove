# Deploy

Qroove runs as one Railway service (one instance, Dockerfile build) behind `qroove.sataklela.com`.

| Item            | Value                                                                    |
| --------------- | ------------------------------------------------------------------------ |
| Railway project | `qroove`, environment `production`, service `web`                        |
| Health check    | `/api/health` (configured in `railway.json`)                             |
| Database        | Firestore project `qroove-sataklela` (see [Firebase](/runbook/firebase)) |
| DNS             | [Cloudflare](/runbook/dns-cloudflare)                                    |

## Variables (Railway → service → Variables)

`NODE_ENV=production`, `PUBLIC_BASE_URL=https://qroove.sataklela.com`, `REPO_DRIVER=firestore`,
`FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_B64`, `COOKIE_SECRET`, `CRON_SECRET`,
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and optionally `YOUTUBE_API_KEY` (a Google Cloud key restricted to the YouTube Data API v3; it allows about 99 new song matches a day). `PUBLIC_BASE_URL` must match the address people use: admin
cookies are `Secure` and the same-origin check compares against it.

## Deploying

- First deploy: `railway up --ci --service web` from the repo root (builds the Dockerfile).
- Afterwards: connect the GitHub repository to the service in the Railway dashboard (Settings → Source) so
  pushes to `main` deploy automatically. This needs the owner to authorise the Railway GitHub app once; until
  then deploy with `railway up`.
- Roll back from the Railway deployments list (Redeploy an earlier deployment).
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
8. Check `railway logs` for errors and that no secrets or tokens appear.

Results of this checklist are not recorded in the repository; note them in the pilot log.
