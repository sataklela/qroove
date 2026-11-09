# ADR 0024 — Google sign-in for guests' own YouTube playlists

**Status:** accepted · **Date:** 2026-11-09

## Context

Guests can look up their own Spotify playlists after logging in (ADR 0020). YouTube had only pasted links and a keyed lookup of a channel's public playlists, so private playlists and _Liked music_ were out of reach.

## Decision

- A Google OAuth 2.0 web client (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) with the single scope `youtube.readonly`. Redirect URI: `<PUBLIC_BASE_URL>/api/google/callback`.
- The same shape as the Spotify guest login: `GET /api/google/login?return=/e/<slug>` → Google consent → `GET /api/google/callback`. The refresh token is sealed (AES-256-GCM, key from `COOKIE_SECRET`) in an HttpOnly, path-scoped cookie `qg_session` on the guest's device; nothing is stored server-side and the page never receives a Google token. The return path is restricted to event pages and a state cookie guards the callback.
- `GET /api/google/me/playlists` lists the person's playlists plus _Liked music_ (`LL`); `GET /api/google/me/playlists/:id` returns up to 50 songs (titles cleaned like scraped YouTube titles; lengths from `videos.list`). `available: false` hides the login link when no client is configured.
- Without a login the keyed public-channel lookup (`GET /api/youtube/playlists`) stays as a fallback.

## Consequences

- Google keeps an app in **Testing** mode until it is verified: only listed test users (up to 100) can log in, and refresh tokens expire after 7 days. `youtube.readonly` is a sensitive scope, so a public launch needs Google's OAuth verification (privacy policy URL, homepage, scope justification, usually a demo video). See `docs/src/runbook/google-oauth.md`.
- Quota: each list call costs 1 unit of the project's 10,000 a day; the same project also serves the playback matcher (ADR 0022).
- Only the first 50 songs of a playlist are read (same truncation as other imports).
