# ADR 0023 — Radio fallback when the queue has nothing to play

**Status:** accepted · **Date:** 2026-11-05

## Context

When nobody has asked for a song (the start of an evening, or after the last request), the room is silent. The organiser asked for a live radio station to fill the gaps, starting with Salsa and falling back through Bachata, Other and Cha-cha. The plan is the radio fallback implementation plan the organiser brought to the project (not kept in the repository).

SPEC §0 forbids ripping, ad removal and "unauthorised audio-stream resolution". Radio fallback plays a station's **published listener URL** (the one its own website player uses) in the organiser's browser. Nothing is recorded, relayed, stripped or muted; the server never touches the audio. The organiser has confirmed the society holds the music licence for the session.

## Decision

- **Queue first.** A guest song always has priority. Radio starts only when nothing is playing or reserved, and `recompute` reserves a guest song the moment one is eligible, so the reservation is the handover signal.
- **The browser plays, the server records.** `RadioFallback` (organiser console) plays the stream in its own `<audio>` element and polls the station's public status feed every 10 s. It tells the server what is audible with two lease-checked commands, `POST /player/radio/started` (idempotent on station + track key) and `/radio/ended`. Radio is never reported through `finished(... FAILED)`.
- **State.** Optional `EventDoc.radio` (station, genre, track key, title, lease epoch) and `EventDoc.radioFallback`. No synthetic `RequestDoc` (it would leak into queues, quotas, export and purge) and no station tables. Missing fields on older events read as "no radio" and the configured default. `commit()` clears `radio` whenever the event is not ACTIVE, a song is playing, a break is in progress or another device holds the lease.
- **History.** A radio track counts as real music for genre history but is system-owned: no key, no participant, no quota. It may **change** the last genre (counted as a genre change), but it never **counts toward a run** (`applyRadioPlay` restarts the run at zero). Otherwise an empty queue with one working station would fill a genre's cap (a cap of 1 is the default) and a guest's song in that genre would wait for a genre the radio might never supply. A play of the genre already on does nothing.
- **Genre choice.** `chooseRadioStation`: the highest-priority allowed genre (Salsa, Bachata, Other, Cha-cha) that has a working station; a genre that has just reached its cap is tried last. The server rejects a genre the current part of the evening does not allow. Event rules are not changed and the operational switch is not part of the frozen `RulesSnapshot`.
- **Handover.** The waiting guest song starts when the station's track changes, or after at most 5 minutes (`maxQueueWaitMs`), or when the organiser presses _Play the queued song now_ (labelled as an interruption). The 5-minute limit exists because Bachata Sensual Radio plays hour-long DJ mixes: a pure track-boundary rule could keep a guest waiting an hour. A silent or stale feed only shows a warning; it never invents a track change.
- **Default off.** `RADIO_DEFAULTS.enabledByDefault` is `false`. The plan's own gate keeps it off until iPhone and Android checks are done, which cannot be done from CI. The organiser switches it on per event; flipping the default is one line in `packages/config/src/radio.ts`.
- **Stations** live in `packages/config/src/radio.ts` (non-secret, with the evidence for each).
- **Not owner-based.** The plan's rule that a participant needs a style change before playing again predates ADR 0018 and is not brought back.

## Verified on 2026-11-05 (from the development sandbox)

| Station               | Result                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bachata Sensual Radio | **Enabled.** Its page's `<audio>` uses `https://s3.radio.co/sb45e5e8de/listen` (HTTP 200, `audio/mpeg`, 96 kbit/s, `Access-Control-Allow-Origin: *`, no redirect). `https://public.radio.co/stations/sb45e5e8de/status` answers without credentials, CORS `*`, with `current_track.title` and `start_time`. So the plan's caution holds in general, but this station is on Radio.co. |
| SalsaViva (Live365)   | **Off.** `https://streaming.live365.com/a37497` redirects to a Live365 edge that answers `401` without credentials, with and without browser headers and a referrer; no public metadata endpoint was found. Not worked around.                                                                                                                                                       |
| Other Salsa stations  | One Radio Browser query (tag salsa, https, last check ok) returned stations on StreamTheWorld, Zeno, Icecast proxies and others; none on Radio.co, AzuraCast or an Icecast `status-json.xsl` with a public metadata feed, so none was added.                                                                                                                                         |

With Salsa unavailable, the start-up choice falls through to Bachata. Cha-cha and Other have no station and stay empty.

## Not done / unverified

- iPhone Safari and Android Chrome playback, background and screen lock; Bluetooth.
- Whether the browser CSP (`media-src` and `connect-src` for `radio.co`) allows the stream in a real browser (unit tests cannot show it).
- AzuraCast and ICY adapters, warm standby and crossfade, strict aligned-boundary mode, metadata-to-audio offset calibration: nothing verified needs them.
- Station-to-station switching at a track boundary is implemented (the player re-picks at each track change) but only one station exists, so it has never run.
- The incoming station joins live, possibly part-way through a track.

## Consequences

- A DJ mix can run an hour; guests wait at most 5 minutes or press the button.
- If the station's status feed fails, the organiser sees a warning and the radio keeps playing.
- The feature relies on a third party's public stream and feed; both can change.
