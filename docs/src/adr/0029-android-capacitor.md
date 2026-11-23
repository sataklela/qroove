# ADR 0029 — Android app: Capacitor shell around the live site, gapless playback on a weak network

**Status:** accepted · **Date:** 2026-11-23 · Supersedes [ADR 0028](/adr/0028-android-twa) (never released)

## Context

Organisers want a phone app that keeps the music going on a weak or patchy network (a hall's
Wi-Fi, mobile data in a basement), with the screens simplified for a phone. There is no Google
Play account: the APK is handed out directly. Organisers and guests may use the app and the site
in any mix, and nothing may work differently between the two.

ADR 0028 chose a Trusted Web Activity (the site in Chrome). The owner asked for a native shell
instead, so the app can add native pieces (keeping the screen on in battery-saver, a QR scanner,
links that open the app) while staying one codebase.

## Decision

- **Capacitor 8 with `server.url = https://qroove.sataklela.com`** (`apps/mobile`). The WebView runs
  the live site on its real origin, so `SameSite=Strict` cookies, CSRF, SSE, the service worker and
  YouTube's embed checks all work unchanged, and every web deploy updates the app. The bridge is
  injected as a document-start script (not inline HTML), so the strict CSP stays as it is.
  A bundled `offline.html` covers a first launch with no network.
- **One codebase.** Native features go through `apps/web/src/shared/native.ts`, which does the
  plain web thing when the page is not in the app. Plugins (all published, none hand-written):
  `@capacitor/app` (links into the app), `@capacitor/browser` (Custom Tab sign-in),
  `@capacitor/barcode-scanner` (scan a room QR), `@capacitor-community/keep-awake`.
- **Sign-in through a Custom Tab with a one-time code.** Google refuses OAuth inside a WebView.
  The app opens `/api/google/login?…&app=1` (or Spotify) in a Custom Tab. The callback keeps the
  session cookie(s) under a random code (single use, 60 s, in memory) and redirects to
  `intent://auth?code=…` for `com.sataklela.qroove`; the app posts the code to `/api/app/redeem`
  from its WebView, which sets the same cookies there. No new OAuth redirect URIs.
- **The next song is reserved while the current one plays** (`recompute`), so the player knows it
  minutes ahead. While a song plays, nothing that fails to fit is shown as a waiting reason.
  A request that arrives mid-song therefore competes for the song after next (one song later than
  before); withdrawing the reserved song still re-picks at once.
- **The player never waits for the server between songs.** On `ended` it starts the reserved
  song at once (from a player cued while the last song played) and writes `finished`/`started`
  to an outbox (`player/outbox.ts`, kept in `localStorage`) that is sent in order with the real
  times. If the server cannot be reached, it goes on to the next song of the last forecast it saw,
  **for at most 2 songs**, then waits. Late reports carry `at` (kept between the lease claim and
  now) and, for a song that was not the reservation, `offline: true`: the server starts it anyway
  if it is still waiting, and drops it (`recorded: false`) if it was withdrawn meanwhile. The lease
  needs no change: an expired lease is still valid until another device claims it.
- **No audio is cached from YouTube or Spotify.** Their terms and this project's rules forbid it
  (SPEC "no ripping", ADR 0017, ADR 0023). "Ready" means the provider's own player is loaded and
  the song cued, nothing more; YouTube matches for the next songs are fetched ahead. Only the
  organiser's own audio files (the optional local library, kept on the device when "Remember" is
  ticked) play with no network at all.
- **Icons first.** `lucide-react` icons; explanations sit behind an (i) (`shared/InfoTip.tsx`).
  Google/YouTube is the default sign-in; Spotify (pilot accounts only) is under **More**.
  The same UI is served to the site and the app.

## Consequences

- A streamed song still needs the network to play: the gain is no wait for the server and no
  player load between songs, so short drops at a song change no longer cause a gap. A long outage
  stops after the current song's buffer, the 2 forecast songs (if they can stream), or remembered
  local files.
- YouTube decides its own stream quality; Qroove cannot lower data use for it.
- The app shell only changes with a new APK (icons, plugins, links); everything else ships with
  the site. Bump `apps/web/package.json` (it drives `versionCode`) before each APK.
- Losing the signing key means users must uninstall and reinstall. Back it up twice.
- Android 8 or later (the QR scanner needs API 26).
