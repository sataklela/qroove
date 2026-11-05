# ADR 0023 — Radio fallback when the queue has nothing to play

**Status:** accepted · **Date:** 2026-11-05

## Context

When nobody has asked for a song (the start of an evening, or after the last request), the room is silent. The organiser asked for a live radio station to fill the gaps, starting with Salsa and falling back through Bachata, Other and Cha-cha. The plan is the radio fallback implementation plan the organiser brought to the project, kept in the repository as [`troubleshoot/Qroove_Radio_Fallback_Implementation_Plan.md`](https://github.com/raunak-h/qroove/blob/main/troubleshoot/Qroove_Radio_Fallback_Implementation_Plan.md). The table at the end of this page checks the build against it.

SPEC §0 forbids ripping, ad removal and "unauthorised audio-stream resolution". Radio fallback plays a station's **published listener URL** (the one its own website player uses) in the organiser's browser. Nothing is recorded, relayed, stripped or muted; the server never touches the audio. The organiser has confirmed the society holds the music licence for the session.

## Decision

- **Queue first.** A guest song always has priority. Radio starts only when nothing is playing or reserved, and `recompute` reserves a guest song the moment one is eligible, so the reservation is the handover signal.
- **The browser plays, the server records.** `RadioFallback` (organiser console) plays the stream in its own `<audio>` element and polls the station's public status feed every 10 s. It tells the server what is audible with two lease-checked commands, `POST /player/radio/started` (idempotent on station + track key) and `/radio/ended`. Radio is never reported through `finished(... FAILED)`.
- **State.** Optional `EventDoc.radio` (station, genre, track key, title, lease epoch) and `EventDoc.radioFallback`. No synthetic `RequestDoc` (it would leak into queues, quotas, export and purge) and no station tables. Missing fields on older events read as "no radio" and the configured default. `commit()` clears `radio` whenever the event is not ACTIVE, a song is playing, a break is in progress or another device holds the lease.
- **History.** A radio track counts as real music for genre history but is system-owned: no key, no participant, no quota. It may **change** the last genre (counted as a genre change), but it never **counts toward a run** (`applyRadioPlay` restarts the run at zero). Otherwise an empty queue with one working station would fill a genre's cap (a cap of 1 is the default) and a guest's song in that genre would wait for a genre the radio might never supply. A play of the genre already on does nothing.
- **Genre choice.** `chooseRadioStation`: the highest-priority allowed genre (Salsa, Bachata, Other, Cha-cha) that has a working station; a genre that has just reached its cap is tried last. The server rejects a genre the current part of the evening does not allow. Event rules are not changed and the operational switch is not part of the frozen `RulesSnapshot`.
- **Handover.** The waiting guest song starts when the station's track changes, or after at most 4 minutes (`maxQueueWaitMs`), or when the organiser presses _Play the queued song now_ (labelled as an interruption). The 4-minute limit exists because Bachata Sensual Radio plays hour-long DJ mixes: a pure track-boundary rule could keep a guest waiting an hour. A silent or stale feed only shows a warning; it never invents a track change.
- **Default on (pilot test, 2026-11-05).** `RADIO_DEFAULTS.enabledByDefault` is `true`; it was `false` until the organiser asked for it to be enabled for a full test. The organiser can still switch it off per event. Device checks (iPhone, Android) are still outstanding.
- **No start grace.** `startGraceMs` is 0 (it was 5 minutes): radio starts as soon as the organiser presses Start, unless a queued song is ready, because a ready song always wins. The console offers _Allow sound for the radio_, a tap that plays a silent clip so the browser later lets the radio start by itself. Songs can also be submitted before Start; they are listed but not played until the event starts. Pause stops radio like any playback.
- **Balancing a lopsided queue.** If one genre has songs waiting but is held by its run cap (15 salsa and 5 bachata from one person), nothing is reserved, so radio starts and picks the genre that is not capped. That play changes the last genre, which releases the next waiting song; the song takes over after the station's next track, or after `maxQueueWaitMs` (now 4 minutes, about one song, so a gap-filling slot lasts about as long as the song it stands in for). The cycle repeats until the imbalance is gone. Only genres with a verified station can fill a gap: **Bachata gaps can be filled, Salsa gaps cannot yet**; with only a Bachata station, a queue short of Salsa keeps the Bachata radio on (it does not release the capped Bachata songs).
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

- A DJ mix can run an hour; guests wait at most 4 minutes or press the button.
- If the station's status feed fails, the organiser sees a warning and the radio keeps playing.
- The feature relies on a third party's public stream and feed; both can change.

## Status against the implementation plan (checked 2026-11-05)

**Done as the plan asks**

| Plan requirement                                                             | Where                                                                                        |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A queue song always beats radio (§2.1, DoD)                                  | `recompute` reserves a guest song; radio starts only with nothing playing or reserved        |
| Salsa → Bachata → Other → Cha-cha, limited to genres the event allows (§3.1) | `chooseRadioStation`; the server also rejects a disallowed genre                             |
| Radio starts at the beginning with an empty queue (§2.2, §11.1)              | Start grace removed (now 0); radio begins at Start unless a song is ready                    |
| Radio counts for genre history, not for any participant (§1.2, §3.4)         | `applyRadioPlay`; no request, quota or key; idempotent on station + track key                |
| A guest song waits for the audible radio track to end (§2.4)                 | Hands over at the station's next track, or after 4 minutes, or on _Play the queued song now_ |
| Radio resumes from the latest history, not always Salsa (§2.5)               | The choice reads the last genre and run                                                      |
| Organiser can switch it off; attendees see a compact label (§2.6, §9.2)      | `POST /admin/radio`; _Radio fallback · station_ on _Now playing_                             |
| One controller, no audio relayed, no unverified source on (§6.1, DoD)        | Player lease checks; the browser plays the stream; only Bachata Sensual Radio is `enabled`   |
| Stale or missing metadata never invents a track change (§5.1, §5.2)          | Warning only; a feed with no start time counts as one live play                              |
| Station failures back off (§3.3, §8.4)                                       | One immediate retry, then the station rests for 60 s and the next is tried                   |
| Radio stops at pause, break, end and lease change (§2.1)                     | `commit()` clears it                                                                         |

**Not done (known, and why)**

| Plan item                                                                                         | Status                                                                                                        |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A working Salsa station (§3.2, §4.1)                                                              | None. SalsaViva answers 401 and stays off, so a Salsa gap is filled by Bachata radio. Needs a verified source |
| Stations for Other and Cha-cha (§3.3)                                                             | None. They need a station the organiser approves                                                              |
| ICY, HLS, AzuraCast, Live365 adapters (§4, §5)                                                    | Not built. Only the Radio.co status feed is used, because no verified station needs the others                |
| Warm standby, crossfade, strict aligned-boundary mode (§6)                                        | Not built. Switching joins the new station live, possibly mid-track                                           |
| Metadata-to-audio offset calibration (§5.3)                                                       | Not built                                                                                                     |
| Hand over only at a detected boundary (§2.4)                                                      | Changed on purpose: a 4-minute cap, because the one station plays hour-long mixes                             |
| Participant style-change rule (§1.2)                                                              | Not brought back (ADR 0018)                                                                                   |
| 10-second retry grace for player start-up (§2.3)                                                  | Not built; radio now starts at once and a failing station is retried once                                     |
| Organiser _Skip radio track_, _Switch source_, _Sound check_, _Next style_ row (§2.6, §9.1, §9.4) | Not built. The console shows the station, track and status, _Play the queued song now_ and the on/off switch  |
| Device tests on iPhone, Android and a Bluetooth speaker (§11.3)                                   | Not done. This is the next step before the pilot                                                              |
| Dual-source timing capture of 10 transitions per station (§11.2)                                  | Not done                                                                                                      |
