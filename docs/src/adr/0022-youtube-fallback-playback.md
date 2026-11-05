# ADR 0022 — YouTube playback for Spotify songs, with adverts muted

**Status:** accepted · **Date:** 2026-11-05

## Context

Full Spotify playback needs a Premium login on the organiser's device. Without it Spotify offers a 30-second preview. Most songs also exist on YouTube, whose embedded player plays them in full, with adverts.

## Decision

Spotify stays the source of truth for search, metadata and genre. When Spotify cannot play a song in full, the organiser's page plays the matching YouTube video in YouTube's own embedded player.

- **Matching:** the server finds the video with the YouTube Data API v3 (`search.list`, then `videos.list` for lengths) from the Spotify title, artist and length. Candidates must be within 15 s of the song's length and contain its title; live, cover, karaoke, remix and similar versions are rejected unless the song itself is one; "Topic" channels and "official audio" rank higher. The answer is cached per Spotify track (misses for a week). Matching runs only for the song reserved next, so quota (about 99 matches a day by default) is spent only on songs about to play.
- **Order:** Spotify SDK playback if signed in; otherwise, or after a preview or account refusal, the first matching video, then the next one if embedding is refused, then the previous behaviour (Spotify embed and notice, then manual mode).
- **Adverts:** nothing blocks, skips or hides an advert. The page mutes its own output with the player's standard `mute()` and `unMute()`, and unmutes when the player reports the song's expected length. This is a pattern guess from `getDuration()` and `getVideoData()`; there is no ad event in the API. It stops guessing after two minutes and plays. The song starts counting (and the queue clock runs) when the gate first opens, not at the advert.

## Consequences

- Needs `YOUTUBE_API_KEY`; without it behaviour is unchanged.
- Muting depends on adverts reporting a length unlike the song's. A long advert or a player that reports otherwise can leave the first seconds of a song muted or an advert audible. Test on the real device.
- YouTube's terms for public performance and the venue's licences are unchecked, as with Spotify (see ADR 0019).
- Premium YouTube sessions in the same browser usually get no adverts at all.
