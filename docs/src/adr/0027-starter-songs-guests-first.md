# ADR 0027 — Starter songs, and guest requests first

**Status:** accepted · **Date:** 2026-11-11

## Context

A one-tap event starts with an empty queue. The organiser wants about ten Salsa and ten Bachata songs ready so music can begin at once, with guests' requests moving ahead of them automatically as they arrive.

## Decision

- **House playlists.** `STARTER_PLAYLISTS` in `packages/config/src/starter.ts` holds one public playlist link per genre (overridable with `STARTER_PLAYLIST_SALSA` / `STARTER_PLAYLIST_BACHATA` on the server). `POST /api/events` with `starter: true` reads them through the ordinary playlist importer, picks `STARTER_PER_GENRE` (10) at random from each, and queues them genre by genre. The lists are cached in memory for six hours and the last good copy is used if a later read fails. If a playlist cannot be read, or no link is set, the event is created with fewer or no starter songs; creation never fails for this reason.
- Starter songs are ordinary pre-loaded requests owned by the existing system participant (`system-seed`), like carry-over songs.
- **Guests first** (`EventDoc.guestsFirst`, on unless switched off). The scheduler's `Candidate` gains an optional `priority`; pre-loaded songs get 1. Within a genre's turn the lowest priority wins, then age. Genre rotation and run caps are untouched, so a starter song still plays when it is the only song that may play. Because the queue is re-projected on every change, a new request moves ahead of the waiting starter songs at once.
- **Takeover.** A guest who asks for a song that is waiting as a starter song is not refused as a duplicate: the song becomes theirs (it counts toward their songs and they can withdraw it). A starter song that is already reserved or playing cannot be taken over.

## Consequences

- The song that is already reserved as next is not displaced by a new request; the request plays right after, subject to the genre rotation.
- With guests first switched off, pre-loaded songs and requests play strictly in order of arrival, as before.
- The house playlists are scraped public pages (see [ADR 0016](/adr/0016-sortable-playlist-import)), so they can break when those sites change.
