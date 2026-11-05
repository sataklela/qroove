# Qroove — Automatic Radio Fallback Playback

**Implementation plan and autonomous coding handoff**  
**Prepared:** 5 November 2026  
**Product:** Qroove (`qroove.sataklela.com`)  
**Context:** LSU Salsa Society socials and other configured dance events  
**Status:** Implementation specification; source/provider feasibility must be verified in the repository and at runtime before production enablement.

---

## 0. Executive decision

Implement an **automatic radio fallback playback source** inside Qroove's existing playback system. It is a failsafe for periods when the event queue has no eligible user-submitted song to play, including the beginning of an event when nobody has submitted anything. It is not a replacement for the collaborative queue, the existing fixed-playlist player, the event scheduler, or the organiser's controls.

The normal playback priority is:

1. **An eligible Qroove queue item** (including an existing, organiser-configured fixed-playlist item where the current product already treats it as a scheduled item).
2. **An eligible fallback radio stream** when there is no eligible queue item.
3. **An explicit waiting/manual state** only when no eligible queue item or working radio source exists, or the organiser has disabled radio fallback.

The first fallback genre is **Salsa** when an event has no playback history. The default fallback genre priority is:

`Salsa → Bachata → Other → Cha-cha`

This is a *priority order*, not an instruction to violate existing genre run caps or other event rules. Reuse the active event's frozen rules and last-played history. A configured radio source must match an enabled event style. If a source for the highest-priority eligible style is unavailable, skip it and try the next eligible configured style. Do not invent a Cha-cha or Other station; those are supported extension points until a verified source is configured.

Initial station candidates:

- **Salsa:** SalsaViva on Live365, station ID `a37497`; public station page currently displays now-playing and last-played information. A publicly listed candidate stream URL is `https://streaming.live365.com/a37497`, but validate the exact working mount/format at runtime and do not treat this third-party-listed URL as a permanent contract.
- **Bachata:** Bachata Sensual Radio; its official website advertises 24/7 bachata and displays a now-playing area. Its page embeds a Radio.co programming schedule and cites Radio.co for listener statistics. This does **not** prove that the live audio stream itself is hosted on Radio.co or that its station ID is available through the Radio.co public track API. Discover and validate the actual live stream and metadata method before enabling it.

The design must be provider-independent. One source may use a public JSON API, another may use ICY stream metadata, and a third may use an AzuraCast endpoint. The player and scheduler must consume one normalised internal track-change event regardless of provider.

**Important reality:** two independent live radio stations are not synchronised. Metadata makes it possible to detect track changes, but it cannot guarantee that the end of a Salsa track and the beginning of a Bachata track coincide. The default behaviour must preserve the outgoing audible track to its next detected boundary, then join the incoming station's live stream. The incoming track may therefore already be in progress. Do not claim that every incoming radio track will be heard from its first beat. Offer a stricter aligned-boundary mode only as an optional policy, with a bounded wait and an explicit compromise when no aligned boundary occurs.

---

## 1. Non-negotiable integration rules

The coding agent must first inspect the live repository and current deployment. Do not assume that the architecture in this document matches the actual codebase line-for-line.

### 1.1 Inspect before changing

1. Run `git status`, identify branch and recent changes. Preserve existing user changes. Do not reset, checkout over, reformat, commit, push or deploy unrelated work.
2. Read `README`, `CLAUDE.md`, `AGENTS.md`, package manifests, existing architecture notes, migrations, tests, Railway/deployment configuration and the Qroove/LSU Salsa Society implementation specification if present.
3. Locate the existing fixed-playlist player, current playback state, queue scheduler, genre selection/rules, event lifecycle, `Now Playing` display, player lease/fencing logic, server event stream/SSE and persistence schema.
4. Map how the existing player reports `started`, `ended`, `paused`, `error`, progress and active source. Reuse its contracts and components wherever possible.
5. Determine whether the current fixed-playlist player is an HTML audio element, a media SDK, an embedded player, Web Audio, or a wrapper around multiple sources. Do not introduce a second competing playback controller if the existing one can accept a new provider adapter.
6. Review the existing database before proposing schema changes. Use additive, reversible migrations. Do not rename existing fields or routes simply to make this feature fit the plan.
7. Run the existing test suite and build before modifying anything. Record baseline failures privately in the implementation notes so they are not attributed to this change.

If the earlier implementation plan is not in the repository, this document is self-contained for the radio fallback work. The existing project rules remain authoritative where they are more specific and do not conflict with the explicit requirements below.

### 1.2 Preserve existing queue rules

The prior Qroove implementation specification establishes these important behaviours. Confirm their current implementation and preserve them:

- The event's rules are snapshotted/frozen when it starts. Radio fallback must not offer an indirect way to change event rules mid-session.
- The default maximum consecutive run is Salsa 2 and Bachata 2; this is a cap, not a mandatory 2:2 block. Use the actual saved event configuration rather than hardcoding these values in the radio controller.
- A further song from the same participant requires at least one actual style transition after that participant's last played song; same-participant adjacent plays are prohibited.
- The scheduler does not break hard fairness constraints to avoid silence. If no eligible queue item exists, it returns a reasoned waiting state.
- There is one authoritative playback controller at a time, protected by the existing player lease/fencing mechanism.
- Pausing, resuming, skipping, ending the event and transferring playback retain their existing semantics.
- User-submitted/authorised fixed-playlist audio remains the preferred source whenever the scheduler has an eligible item.

Radio items have a synthetic system owner, not an attendee. They do not consume anyone's request quota, create participant identities, or count as a participant submission. They **do** count as actual playback for genre history: the radio track's style updates last-played style, style run length, and style-transition history just like any other track. This ensures a real Salsa-to-Bachata radio track can satisfy a genre transition required by the existing scheduler, without attributing the radio song to a person.

Do not use radio fallback to sneak around a blocked queue. It may supply a genuinely played track in a different allowed style, which can naturally change genre history; it must never mark an unplayed style transition or alter request ownership/quotas.

---

## 2. Product behaviour and precedence

### 2.1 Playback decision at every boundary

At a legitimate track-end/boundary event, ask the existing scheduler for the next item using the authoritative event snapshot and playback history.

```text
if event is ENDED:
    stop every audio source
elif event is PAUSED:
    keep playback paused; do not auto-start another source
elif organiser has explicitly disabled radio fallback:
    follow existing empty-queue/wait behaviour
elif scheduler has an eligible queue or fixed-playlist item:
    play that item using the existing player
else:
    choose and play an eligible radio source
```

Do not use the presence/absence of a UI card or a stale browser queue as the authoritative decision. Use the server-authoritative scheduler result and player lease.

### 2.2 Startup behaviour

When the organiser starts an event:

1. If the scheduler has an eligible queue/fixed-playlist item, play it using the normal player after the required user gesture.
2. If no eligible item exists and radio fallback is enabled, start the highest-priority eligible radio genre. With no playback history, this is Salsa.
3. If Salsa is not enabled in the event, has no configured/healthy station, or fails its startup checks, try Bachata, then Other, then Cha-cha, subject to event rules.
4. If no radio source is usable, show a clear `No queue songs or working radio sources` state, keep the normal add-song controls available, and expose the organiser's manual playback controls. Do not silently pretend that music is playing.

Starting audio must remain tied to the organiser/player's explicit browser user gesture. Do not attempt to bypass iOS/Android autoplay restrictions. The event may enter `ACTIVE` before audio begins if that is how the existing product works, but show a visible `Tap to start audio` prompt and do not report a track as started until audio playback is confirmed.

### 2.3 Empty queue during an event

- Never cut off a Qroove/local track merely because the queue has become empty. Finish the current track, then use radio fallback at the next valid boundary.
- If the queue is already empty at a boundary, select the appropriate radio genre immediately; do not add an arbitrary silence delay.
- If the browser/player reports the queue has no current track and no candidate, start radio immediately after the organiser's initial audio-unlock gesture. A short retry grace (default 10 seconds, configurable) is only for transient player initialisation/error recovery, not for intentionally leaving the room silent.
- If the scheduler reports `WAITING_FOR_ELIGIBLE_SUBMISSION` or another fairness deadlock, radio may play an eligible different genre according to the frozen event rules. It must not force an ineligible attendee request to play.

### 2.4 A song arrives while radio is playing

- Do not interrupt the audible radio track immediately when someone submits a song.
- Mark `queueHandoffPending` and reserve the scheduler's next eligible queue item using the existing reservation and player-lease rules.
- At the next detected boundary of the currently audible radio track, hand off to the reserved queue item. The radio track that was audible is recorded as completed/played; do not record the next un-heard radio track as played.
- If a queued item is withdrawn, removed, becomes ineligible, or loses media availability before handoff, cancel/recompute the reservation and continue radio fallback.
- If several queue items arrive before the boundary, honour the existing scheduler ordering/fairness logic. Do not allow radio mode to reorder, promote or delete requests.
- Organiser may have an explicit `Play next queued song now` action if the existing product supports forced skip. It must be clearly labelled as an interruption/skip and must use the existing skip state transitions; never present it as a seamless boundary handoff.

### 2.5 Queue runs out again

After the last eligible queue item finishes, call the scheduler again. If it returns no eligible track, resume radio fallback according to the latest event history and style rules. Do not always restart Salsa. If the last played genre was Bachata and the rules/caps make Salsa the next eligible genre, choose Salsa; otherwise follow the scheduler's next-style decision.

### 2.6 Organiser controls

Expose the smallest useful set of controls in the existing organiser player view:

- `Radio fallback: On/Off` (default On for new events; if the current rules snapshot is immutable, store this as a separate operational playback setting or freeze the default at event start according to the current schema).
- Current source and genre, e.g. `Radio · Salsa · SalsaViva`.
- Current now-playing title/artist when reliable metadata is available; otherwise show `Live radio · track information unavailable` rather than fabricating details.
- `Switch source` / `Skip radio track` using the same safe handoff mechanism as the existing skip action.
- `Retry source` or `Choose station` only if appropriate for the current organiser permission model.
- Clear source status: `Connecting`, `Playing`, `Metadata delayed`, `Stream unavailable`, `Waiting for next track boundary`.

Do not expose provider API credentials, internal stream URLs, station diagnostics or admin tokens to attendees. Avoid expanding the attendee UI beyond a compact `Radio fallback`/currently-playing label unless existing design conventions call for it.

---

## 3. Genre selection and event rules

### 3.1 Default radio priority

Add a versioned default priority list for radio fallback:

```json
["salsa", "bachata", "other", "cha_cha"]
```

Display names should follow Qroove's existing genre labels, e.g. `Cha-cha` rather than the storage key `cha_cha`.

The ordering is a deterministic tie-breaker/initial preference. It must not override:

- styles not enabled for the event;
- frozen per-style consecutive-play caps;
- the last-played style/run state;
- an existing scheduler decision that another style is next;
- a healthy queue item that should take precedence over radio.

With no prior playback history, choose Salsa if enabled and a healthy Salsa radio mapping exists. Then use the next enabled/configured eligible genre by priority. If Salsa is disabled or has no source, skip to Bachata. If neither is available, try Other, then Cha-cha.

### 3.2 Radio-source mapping per style

Maintain a small source registry, with one or more radio candidates per style. Do not hardcode station-selection logic into UI components.

Initial proposed configuration (all endpoints must be verified before `enabled: true`):

```json
{
  "salsa": [
    {
      "id": "salsaviva-live365",
      "name": "SalsaViva",
      "provider": "live365",
      "stationId": "a37497",
      "stationPageUrl": "https://live365.com/station/SalsaViva-a37497",
      "websiteUrl": "https://salsaviva.fm/",
      "candidateStreamUrl": "https://streaming.live365.com/a37497",
      "metadataMode": "unverified",
      "enabled": false
    }
  ],
  "bachata": [
    {
      "id": "bachata-sensual-radio",
      "name": "Bachata Sensual Radio",
      "provider": "unknown",
      "stationPageUrl": "https://bachatasensualradio.com/",
      "metadataMode": "unverified",
      "enabled": false
    }
  ],
  "other": [],
  "cha_cha": []
}
```

Use this as a discovery/configuration starting point, not as proof that the candidate stream or metadata endpoints are production-ready. Keep secrets out of this object. Prefer checked-in non-secret station configuration with operational health/metadata state stored separately.

### 3.3 Source fallback order

For a chosen genre, try its configured stations in deterministic priority order. Station preference should be configurable centrally; default to the explicitly selected preferred station, then validated backups. A candidate is eligible only if:

- its audio URL is HTTPS and has passed an audio playback test;
- the stream is reachable and its MIME/codec is supported by the supported browsers;
- its metadata adapter returns a valid current track or a known limitation explicitly accepted for that source;
- its last health check is recent enough;
- it is not in an exponential-backoff/circuit-breaker period;
- its declared dance style is permitted by the event.

If all sources for a genre fail, move to the next eligible genre. If all genres fail, report the condition and use existing manual-playback/wait state.

`Other` is not a reliable musical genre by itself. Only enable a station for it if the organiser has explicitly approved the station's content as suitable for the event's `Other` category. Cha-cha needs a specifically curated source or an approved multi-genre station with credible track-level style classification. Never infer that a generic Latin station is all cha-cha.

### 3.4 Interaction with style caps/history

On every confirmed radio track start, call the same domain-level playback-history function used for normal tracks:

- `last_played_style = radioTrack.style`
- increment that style's consecutive run if it matches the previous style; otherwise reset run to 1 and increment the style-transition counter;
- set `owner_type = SYSTEM_RADIO`, `owner_id = null` (or existing equivalent synthetic owner), `request_id = null`;
- do not increment participant submission counts;
- record source/station ID and canonical radio-track identity where metadata exists.

Radio track metadata can be missing, duplicated or delayed. Only apply a confirmed style transition once, idempotently, per unique track-start event. Polling the same `artist/title` repeatedly must not increment history repeatedly. A radio track without track identity should still be playable as a stream, but it must be marked `metadata_unknown`; do not invent a title or use repeated polling as repeated track starts.

---

## 4. Radio candidates and metadata/API feasibility

This section records what is publicly documented or visible as of 5 November 2026. Provider availability, URL formats, CORS policies and station configuration can change. The implementation must perform runtime verification and must not rely on unverified private endpoints.

### 4.1 SalsaViva — Live365 (Salsa candidate)

Public pages:

- Station page: <https://live365.com/station/SalsaViva-a37497>
- Official website: <https://salsaviva.fm/>
- Station ID: `a37497`
- Candidate direct stream listed by a third-party directory: `https://streaming.live365.com/a37497`

The public Live365 station page currently displays `Now playing` and a `Last played` list with recent tracks and relative times. It is therefore a useful public manual verification page and a possible source of metadata for a prototype. The page is accessible to listeners without an account.

**Do not claim that Live365 supplies a documented public, general-purpose listener now-playing JSON API.** The Live365 material reviewed documents station pages, an embeddable player, a Last Played widget and stream delivery, but does not establish a stable public JSON endpoint for any arbitrary station. The official Last Played/player widget embed code is obtained from the broadcaster's Dashboard; that is not the same as a publicly documented listener API.

Live365's official support documentation says its streaming service is based on Icecast2 and delivers audio in ICY and HLS formats. This creates two potential machine-readable metadata paths:

1. **ICY metadata in the audio stream:** probe the exact SalsaViva stream for an `icy-metaint` response header and interleaved `StreamTitle` metadata. This is the preferred Live365 route if the station's actual mount supplies valid artist/title changes.
2. **HLS metadata:** inspect the actual playlist/segments for supported timed metadata (e.g. ID3 or timed tags) only if the stream/player exposes it. Do not assume that all Live365 HLS streams expose usable track metadata.

Live365 explicitly documents that metadata can arrive out of synchronisation with the audible audio because text metadata travels separately and faster than audio through the streaming pipeline. Measure this offset for the exact station/stream/player path. Do not treat metadata event receipt as a perfectly timed audible boundary until verified.

**Candidate endpoint is not a permanent contract:** the `a37497` stream URL was found in a public directory, while Live365's official encoding documentation describes stream URL formats based on station output settings/mounts. Test redirects, content type, codecs, HTTPS, ICY headers, CORS and browser playback. If this URL is invalid or changes, retrieve the official current listen URL from SalsaViva's public Live365 profile/player or the station website. Do not invent a different mount.

### 4.2 Bachata Sensual Radio — stream and metadata host must be discovered

Public page: <https://bachatasensualradio.com/>

The official page describes Bachata Sensual Radio as a 24/7 bachata service and displays a `NOW PLAYING` section. It also embeds a Radio.co programming schedule and cites Radio.co as the source for listener-country statistics.

**Critical correction:** a Radio.co schedule iframe or analytics attribution does not establish that the live radio audio stream is hosted by Radio.co. Do not assume the station has a Radio.co station ID or that its player emits the Radio.co `songChanged` event.

Discovery procedure:

1. Inspect the official website's own player markup and scripts. Locate the actual audio source and any metadata requests used by the live player.
2. In a browser/network test, start playback and identify requests made to the stream host and metadata host. Record only public endpoints intended for listener/player use.
3. Determine whether the station uses Radio.co, AzuraCast, Icecast/SHOUTcast with ICY metadata, another public now-playing API, or a custom player.
4. Verify the metadata endpoint with an unauthenticated request, without cookies, login, API key or subscription. Check browser CORS separately from server-side reachability.
5. If it is Radio.co, determine the exact station ID from the stream/player configuration, then test the documented public endpoints below.
6. If it uses another provider, implement the corresponding adapter only after confirming its documented public interface.
7. If only the website's visible now-playing text exists and there is no stable machine-readable feed, do not scrape undocumented page internals as the production solution. Keep the station disabled for automatic boundary-driven switching or use the explicitly documented degraded mode with organiser approval.

### 4.3 Radio.co — documented public metadata and player events

Official developer documentation: <https://www.radio.co/api>

Radio.co documents these station endpoints (replace `{stationId}` only after confirming the actual station ID):

```text
GET https://public.radio.co/api/v2/{stationId}
GET https://public.radio.co/api/v2/{stationId}/track/current
GET https://public.radio.co/stations/{stationId}/status
```

The current-track response is documented as containing the current track, start time and artwork. The status endpoint exposes station status/history/bitrate information. The public player documentation also describes these methods/events:

- `event('songChanged', callback)` — fires when the station's current song changes.
- `event('audioLoaded', callback)` — audio loaded successfully.
- `event('invalidStream', callback)` — invalid stream.
- `event('streamInfoError', callback)` — stream information not received.
- `getStreamState()` — player readiness state.
- `isPlaying()`, `volume(value)` and `mute()` — playback state/volume controls.

Radio.co's published example player uses:

```html
<script src="https://public.radio.co/playerapi/jquery.radiocoplayer.min.js"></script>
```

Qroove should **not automatically embed Radio.co's jQuery player as a second player system**. Use Qroove's existing player engine for audio output and create a small metadata adapter that consumes the public current-track endpoint or a documented event source. The Radio.co widget/player may be used for the initial feasibility test to confirm station metadata behaviour, but avoid introducing jQuery or multiple controllers into production unless the existing architecture makes that unavoidable.

The public API documentation does not specify an API key in the documented read examples. Nonetheless, prove unauthenticated access with a clean GET and record the result. A public endpoint may still be subject to provider rate limits, CORS restrictions or changes. Cache and poll conservatively.

### 4.4 AzuraCast — supported alternative adapter

Official documentation: <https://www.azuracast.com/docs/developers/now-playing-data/>

For a station confirmed to use AzuraCast, the documented per-station now-playing endpoint is:

```text
GET https://{station-host}/api/nowplaying/{station_shortcode}
```

A static, more cache-friendly form is:

```text
GET https://{station-host}/api/nowplaying_static/{station_shortcode}.json
```

The JSON includes current track details, `played_at`, duration, source/live-DJ details and a short recent-song history. The standard endpoint is cached for a few seconds; calculate elapsed time from `played_at` and a known server/client clock offset rather than assuming the response's elapsed value is exact.

AzuraCast also documents live Now Playing updates using WebSocket and Server-Sent Events. Use those only if the station's specific public installation exposes them without credentials and the connection works from the intended environment. For a first adapter, REST polling is simpler and adequate to validate metadata semantics; use a conservative interval (e.g. 10–15 seconds) until a real push connection is confirmed.

Do not assume Bachata Sensual or SalsaViva uses AzuraCast. This is a provider adapter for future verified stations.

### 4.5 Live365: stream metadata and latency

Official documentation:

- Stream types/server: <https://help.live365.com/en/support/solutions/articles/43000532835-what-server-types-does-live365-use>
- Stream URL/encoding settings: <https://help.live365.com/en/support/solutions/articles/43000739178-output-encoding-settings>
- Metadata timing: <https://help.live365.com/en/support/solutions/articles/43000608525-why-is-the-metadata-delayed-and-not-displaying-in-real-time-sync-with-the-music>
- Public player/Last Played widget: <https://help.live365.com/en/support/solutions/articles/43000533536-how-do-i-launch-my-live365-station-from-my-webpage>

If ICY metadata is available, its format commonly consists of audio bytes interleaved at `icy-metaint` intervals with a metadata block containing a `StreamTitle` value. A server-side probe can parse it, but the implementation must correctly handle streaming chunks, reconnects, metadata padding, changing titles and malformed blocks.

**Bandwidth consideration:** a server-side ICY probe must consume/discard the intervening audio bytes to reach metadata. A 128 kbit/s stream is roughly 57.6 MB per hour of received audio; probing two streams for a two-hour event can therefore consume about 230 MB of inbound data even though the audio is not relayed to users. Do not create continuous ICY probe connections on Railway by default. Prefer public JSON/push metadata. Use an ICY probe only after a measured proof of concept and cost calculation; make it one bounded metadata connection per source, not one per attendee.

If the exact stream provides metadata only through its audio bytes and the browser cannot read those bytes due to CORS, choose among:

1. a public provider JSON/event endpoint (preferred);
2. a single server-side metadata probe with measured cost and rate, with audio still played directly by the browser;
3. a clearly labelled degraded mode without automatic track-boundary switching.

Do not route or relay the radio audio through the Qroove backend merely to inspect metadata. Do not use DRM circumvention, ad removal, hidden endpoints or attempts to defeat provider restrictions.

### 4.6 Radio Browser — discovery, not track-boundary metadata

Official API documentation: <https://docs.radio-browser.info/>

Radio Browser is a free community-maintained directory with station search and health-check fields. Its API can be used for **future dynamic discovery** of backup salsa/bachata stations, for example by tags, codec, bitrate, country, online state and last check.

It explicitly offers no uptime guarantee. It is not a live now-playing track API: station records and health checks do not prove what track is playing at this instant. Treat tags as candidate classification only.

Use the documented JSON search endpoints on a current Radio Browser mirror, include a descriptive `User-Agent`, handle mirror failover, cache responses, and validate every discovered stream before offering it to the playback selector. Never select a random directory station as a trusted Salsa/Bachata source without genre verification and working audio/metadata tests.

### 4.7 What must not be assumed

- Do not assume any candidate's public website DOM is a supported API.
- Do not assume a station's directory listing or genre tag is correct or that it broadcasts the genre continuously.
- Do not assume that an endpoint that works in an authenticated browser also works unauthenticated.
- Do not assume that a metadata event's timestamp is the audible audio boundary.
- Do not assume that `songChanged` from a generic provider SDK can be used for a station until that station's actual stream/player is proven to use that provider.
- Do not invent station IDs, API keys, stream paths, CORS headers, current-track data or track durations.

---

## 5. Metadata adapter contract

Create one provider-independent interface. Use the project's existing language/conventions; TypeScript-like pseudocode follows:

```ts
type RadioGenre = 'salsa' | 'bachata' | 'other' | 'cha_cha';

type RadioTrack = {
  stationId: string;
  stationName: string;
  genre: RadioGenre;
  title: string | null;
  artist: string | null;
  album: string | null;
  artworkUrl: string | null;
  durationMs: number | null;
  providerTrackId: string | null;
  startedAtProvider: string | number | null;
  metadataReceivedAt: number;
  metadataMode: 'json_poll' | 'json_push' | 'icy' | 'hls_timed_metadata' | 'unknown';
  confidence: 'verified' | 'partial' | 'unknown';
  rawTitle: string | null;
};

type RadioSourceHealth = {
  online: boolean;
  audioReachable: boolean;
  metadataReachable: boolean;
  lastAudioCheckAt: number | null;
  lastMetadataCheckAt: number | null;
  metadataStale: boolean;
  failureCount: number;
  backoffUntil: number | null;
  lastErrorCode: string | null;
};

interface RadioMetadataAdapter {
  readonly provider: string;
  canHandle(source: RadioSourceConfig): boolean;
  getCurrentTrack(source: RadioSourceConfig, signal?: AbortSignal): Promise<RadioTrack | null>;
  subscribe?(source: RadioSourceConfig, handlers: {
    onTrackChange(track: RadioTrack): void;
    onError(error: Error): void;
  }): Promise<() => void>;
  healthCheck(source: RadioSourceConfig, signal?: AbortSignal): Promise<RadioSourceHealth>;
}
```

Normalise all provider responses into this contract. Store raw provider responses only in bounded diagnostic logs with no personal data; do not persist full stream payloads.

### 5.1 Track identity and de-duplication

Use a conservative radio identity key:

1. provider track ID, where present;
2. otherwise normalised `artist + title + stationId`;
3. otherwise a per-source opaque change sequence derived from the adapter's observation timestamp.

Do not treat every poll as a new play. A new track-start event is emitted only when the normalized identity changes, or the provider provides a new unique `played_at`/track-start value. Track repeats that genuinely occur later in a station's rotation are separate plays if their provider start timestamp changes.

If track metadata is missing, do not emit a fake title or create a stable event-level deduplication key from a null value. Record a `metadata_unknown` radio segment and use audio-health/heartbeat state to determine whether the stream remains active. It may be played in the degraded mode, but it cannot be used for strict track-change synchronisation.

### 5.2 Staleness and polling

- Prefer a documented push event (`songChanged`, AzuraCast WebSocket/SSE, etc.) when available and stable.
- Otherwise poll at a configurable conservative interval, initially 5–10 seconds for a provider with reliable, low-latency current-track JSON; 10–15 seconds for slower/cache-backed endpoints. Adjust only after tests show the provider's actual metadata latency and allowed request rate.
- Add request timeouts, ETag/conditional GET where supported, no-cache parameters only when required, and exponential backoff after errors.
- Mark metadata stale if unchanged beyond a threshold based on the source's recent track duration and last check; an unchanged title alone does not prove the stream is dead because a long song or live DJ set may be in progress.
- Health-check audio separately from metadata. `Metadata unavailable` does not always mean `Audio unavailable`.
- If metadata is stale or contradictory, do not automatically switch on a fabricated track boundary. Keep the audible source running and report a warning to the organiser.

### 5.3 Time calibration

For every station/provider/browser combination, measure:

- provider track event timestamp to metadata receipt;
- metadata receipt to audible track transition;
- difference between the browser audio player and the metadata request/stream connection;
- clock skew between provider, Qroove server and player device.

Store a per-source `metadataToAudioOffsetMs` calibration with sample count, measured variance and last verified time. Use it only after multiple measurements. If the source delay is unstable, widen the safe boundary window or disable strict alignment. Never hardcode a guessed offset as truth.

---

## 6. Playback engine and source switching

### 6.1 One authoritative playback controller

Integrate radio as another source type in the existing playback adapter. The existing player lease and fencing epoch remain authoritative. A second device must not accidentally play a second copy of the event because it loaded the public page.

Represent active playback with an explicit source type, e.g.:

```ts
type ActivePlaybackSource =
  | { kind: 'queue_track'; requestId: string; reservationId: string }
  | { kind: 'fixed_playlist'; playlistId: string; itemId: string }
  | { kind: 'radio'; stationId: string; genre: RadioGenre; stationTrackKey: string | null }
  | { kind: 'manual'; label: string | null };
```

Fit this into the existing domain model; do not introduce a parallel `currentTrack` state that can disagree with the current player.

### 6.2 Radio warm-standby strategy

The controller needs to know when the inactive genre's next radio track starts if it is to attempt a track-boundary source switch. There are two possible implementations:

**Preferred initial implementation — metadata-only standby:**

- Keep the currently audible source streaming directly to the player.
- Subscribe/poll metadata for the currently audible source and the likely next genre's station.
- Do not run a second audible stream simply to read metadata.
- At the outgoing stream's detected boundary, switch the audio element/source to the selected station's direct stream URL. The incoming stream joins its current live position; it may be part-way through a track.
- This is simpler, uses less listener bandwidth and avoids creating a second hidden audio stream, but it does not guarantee an incoming track intro.

**Optional enhanced implementation — warm muted standby:**

- Only if the target browsers and stream CORS/player constraints allow it, keep a second audio element connected and muted while monitoring its track changes.
- Start/unlock both streams from the same explicit user gesture.
- At a safe transition, fade between them through the existing audio mixer if technically supported.
- Confirm that the muted stream continues to progress on iOS Safari and Android Chrome, and that background suspension does not stop it.
- Stop and release the losing audio stream immediately after the handoff.

Do not assume that setting `.volume = 0` or using Web Audio gain is reliable on all iOS devices. Web Audio processing of a cross-origin stream may be blocked/silenced when the stream does not grant appropriate CORS access. Test real devices. If programmematic gain/crossfade is not reliably supported, use a controlled hard source switch at the outgoing track boundary; do not add a third-party player library simply to simulate mixing.

### 6.3 Default switching rule

For radio-to-radio genre changes:

1. The scheduler chooses the next eligible genre using the frozen event rules, last-played genre/run and fallback priority.
2. Keep the current audible stream playing until its **outgoing track boundary** is detected, using the source-specific calibrated timing offset.
3. If the next genre's station can be joined at a boundary at the same time (within the configured alignment tolerance), switch there and optionally crossfade.
4. If it cannot be aligned, switch at the outgoing boundary and join the incoming stream at its current live position. Show the incoming track metadata as `Live · may have joined mid-track` if its current track start is known and predates the transition.
5. Never leave the room silent indefinitely while waiting for perfect alignment. Default `preserve_outgoing_track` policy wins over `perfect_incoming_intro`.

Initial configurable values:

```json
{
  "radioFallback": {
    "enabledByDefault": true,
    "initialGenre": "salsa",
    "genrePriority": ["salsa", "bachata", "other", "cha_cha"],
    "switchPolicy": "preserve_outgoing_track",
    "alignedBoundaryToleranceMs": 5000,
    "strictAlignmentMaxWaitMs": 180000,
    "crossfadeMs": 1500,
    "emptyQueueRetryGraceMs": 10000,
    "metadataStaleWarningMs": 45000
  }
}
```

These are starting defaults, not guaranteed provider timings. Make them central/configurable and verify them in the rehearsal. `alignedBoundaryToleranceMs` is used only after measuring metadata/audio offset. A crossfade of 1.5 seconds is best-effort and may be disabled on browsers where it is not reliable.

### 6.4 Strict aligned-boundary mode (optional)

If the organiser prefers never to cut an incoming track, offer a stricter mode only after dual-source timing tests:

- Wait for an outgoing track-boundary event and an incoming track-start event within the alignment tolerance.
- If no matching pair occurs before `strictAlignmentMaxWaitMs`, do not wait silently forever. Fall back to `preserve_outgoing_track` and join the incoming source live, or remain on the outgoing station if the organiser explicitly selected that policy.
- Surface `Waiting for matching radio track boundary` and elapsed wait time to the organiser.
- The selected fallback after timeout must be deterministic and tested.

There is no algorithm that can guarantee full outgoing and incoming tracks across independent, unsynchronised live stations. If strict completion of every song becomes a hard requirement, replace live-radio switching with a single curated playlist/stream that controls both genres, or negotiate a common playout schedule with the broadcasters. Do not attempt to solve this by guessing track duration.

### 6.5 Returning from radio to Qroove queue

A queued Qroove item takes precedence after the current audible radio track completes. Use the metadata boundary of the **active audible station**, not the inactive station. Reserve and validate the queue item before the boundary. At the boundary:

- stop/mute the radio source;
- start the reserved Qroove item through the existing player;
- confirm actual audio start before committing the `PLAYING` state;
- if queue start fails, restore/reconnect a healthy radio source and retain the request unplayed/unconsumed unless its audio was actually started.

Do not mark an item complete merely because its expected duration elapsed. Preserve the existing player started/finished acknowledgement and stale-controller reconciliation.

### 6.6 Stream player and autoplay constraints

- Use direct HTTPS audio URLs; do not relay audio through the Qroove server.
- Use the existing audio element/player component. If the existing abstraction cannot handle arbitrary live streams, extend the abstraction with a `radio_stream` provider rather than replacing it.
- First play must be initiated by a visible user action on the designated player device.
- Test supported codecs and media MIME types on iOS Safari, Android Chrome and desktop browsers.
- Distinguish `audio.play()` rejection (autoplay/user gesture), network failure, unsupported codec, CORS metadata failure and stream ended/disconnected.
- Browser background suspension is expected. On foreground/resume, re-read metadata and player state; never infer that unseen track boundaries occurred during suspension.
- On reload/reconnect, reconcile the server's active source and lease. Require user confirmation if audio playback state cannot be safely determined.

---

## 7. State machine and server contracts

Reuse existing event/player state. Add only radio-specific state needed to reconcile and display the source.

Suggested radio states:

```text
DISABLED
IDLE
DISCOVERING_SOURCE
CONNECTING
PLAYING
WAITING_FOR_BOUNDARY
HANDOFF_PENDING_QUEUE
HANDOFF_PENDING_RADIO
METADATA_STALE
STREAM_ERROR
NO_SOURCE_AVAILABLE
```

Suggested transitions:

- `IDLE -> DISCOVERING_SOURCE -> CONNECTING -> PLAYING`
- `PLAYING -> WAITING_FOR_BOUNDARY` when a different genre or queued item is due
- `WAITING_FOR_BOUNDARY -> HANDOFF_PENDING_QUEUE -> PLAYING(queue)` when a queue item is ready
- `WAITING_FOR_BOUNDARY -> HANDOFF_PENDING_RADIO -> PLAYING(radio)` when the next genre station becomes active
- `PLAYING -> METADATA_STALE` when metadata fails but audio continues
- `CONNECTING/PLAYING -> STREAM_ERROR -> DISCOVERING_SOURCE` on source failure
- any active state -> `IDLE` on event pause/end or player lease release

Use idempotent commands and event revisions. Radio metadata callbacks must not mutate event rules or queue ordering directly. They call a domain service that validates the player lease, event state and current source before recording a track boundary.

### 7.1 Suggested API shape
Adapt to existing route conventions rather than copying blindly:

```text
GET  /api/events/:id/public               existing public state; include sanitised source type/genre/track
GET  /api/events/:id/player/state         current source, lease/revision, radio state
POST /api/events/:id/player/radio/start   request start through the active lease after user gesture
POST /api/events/:id/player/radio/retry   retry a failed source
POST /api/events/:id/player/radio/skip    organiser-authorised radio skip
POST /api/events/:id/player/radio/disable disable fallback operationally
POST /api/events/:id/player/radio/enable  enable fallback operationally
POST /api/events/:id/player/track-started confirm actual radio/queue audio start
POST /api/events/:id/player/track-ended  idempotent boundary/completion notification
GET  /api/radio/sources                   sanitised configured station list/health state
GET  /api/radio/metadata/:sourceId       server-side metadata proxy only when required
```

If a public radio metadata API is CORS-accessible and browser use is safe, the player may call it directly. If not, use a small server-side metadata adapter/proxy that only returns compact JSON. Protect the proxy with an allowlisted source registry: the client must never supply an arbitrary URL to fetch (SSRF prevention).

No endpoint should proxy or re-stream audio. Do not expose the raw provider endpoints to attendee clients unless necessary and safe.

### 7.2 Minimal persistence additions

Fit the following into existing tables or add migration columns/tables only where necessary:

- `radio_sources`: `id`, `name`, `provider`, `genre`, `station_page_url`, `stream_url`, `metadata_mode`, `metadata_url` (where verified), `enabled`, `priority`, `last_verified_at`, `config_version`.
- `radio_source_health`: `source_id`, `checked_at`, `audio_reachable`, `metadata_reachable`, `last_track_change_at`, `last_error_code`, `failure_count`, `backoff_until`, `metadata_latency_ms`, `latency_variance_ms`.
- `radio_track_observations`: `event_id`, `source_id`, `provider_track_id`, `normalised_track_key`, `title_nullable`, `artist_nullable`, `genre`, `provider_played_at_nullable`, `observed_at`, `metadata_confidence`.
- `playback_history` (existing): add/encode `source_kind = RADIO`, `radio_source_id`, optional `radio_track_observation_id`; do not create a separate history stream that the scheduler ignores.
- event runtime state (existing): active `source_kind`, active radio station/genre, `handoff_pending`, current metadata key, last boundary timestamp, metadata offset, controller lease epoch.

Do not store full radio audio, station login credentials, attendee personal data or provider API secrets. If all fixed station metadata can remain in static configuration plus event play history, avoid adding a full station database.

### 7.3 Concurrency and leases

- All state transitions are validated server-side against event revision and player fencing epoch.
- A stale player must not be able to mark a radio track started/ended after another device takes the lease.
- A duplicate metadata event or retried callback must be idempotent.
- Only the lease owner can initiate stream playback/skip/handoff for the event.
- A server-side metadata poller is independent of the player lease but may only publish observations; the active player/domain service decides whether they are actionable.

---

## 8. Failure handling and automatic next steps

The coding agent must implement these paths; do not stop and ask the user what to do when one station/provider fails.

### 8.1 Metadata path discovery fails for Bachata Sensual Radio

1. Check whether the website exposes a public audio URL and a public now-playing value through documented player code.
2. Identify the actual provider via the stream host/player scripts, then try its official public now-playing API (Radio.co, AzuraCast or another verified provider).
3. If the provider's current-track REST endpoint works, create a polling adapter. If it offers a documented push event, use it only after verifying stability and CORS/connection behaviour.
4. If the stream exposes ICY metadata, test it with a local/server-side proof of concept and measure bandwidth/latency before considering it.
5. If only the public webpage's visible text is available, do not base production switching on a brittle undocumented endpoint or aggressive HTML scraping. Keep the stream disabled for automatic track-boundary selection and proceed to the backup station/discovery path.
6. Do not leave the rest of the feature unimplemented: use the available Salsa source and a generic station registry; show Bachata as `Not configured for automatic switching` until a validated metadata path is added.

### 8.2 SalsaViva Live365 metadata cannot be read reliably

1. Confirm exact current stream URL/encoding from the public Live365 profile/player and test the candidate `https://streaming.live365.com/a37497`.
2. Test ICY response headers/metadata and HLS timed metadata.
3. Check whether Live365's public player widget/current page supplies a stable, permitted public data source. Do not invent a JSON endpoint.
4. If no dependable machine-readable data exists, search Radio Browser by salsa tags and validate a small set of candidate stations. A directory entry alone is insufficient: check audio, genre, current-track metadata and stream reliability.
5. Implement the first validated backup in the same source registry; keep SalsaViva in the list as a manual option if its audio works but metadata is unreliable.
6. If no salsa metadata source can be validated, support degraded radio playback only if the organiser explicitly accepts it. In degraded mode, do not claim accurate automatic song-end detection; switch by an explicit organiser action or by a conservative source-specific duration heuristic only when duration is trustworthy. Never use a generic timer to pretend that a live DJ set has ended.

### 8.3 Provider API rate-limits, CORS or endpoint downtime

- Try browser direct GET only for public, CORS-enabled endpoints.
- If CORS blocks browser access, check whether a server-side GET is permitted and add a strict allowlisted metadata proxy with caching. CORS is a browser access restriction, not proof that an endpoint requires a paid account.
- If the provider returns 401/403 without credentials, do not attempt to bypass it. Try another documented public endpoint/source.
- If the provider returns 429, respect `Retry-After`, increase poll interval, cache and use other metadata modes.
- On 5xx/network failure, use exponential backoff and the next healthy source. Do not hammer a provider.
- If metadata is down but audio remains healthy, continue the audible stream; postpone automatic handoff and warn the organiser.

### 8.4 Stream failure while playing

1. Do not leave the output silent while blindly retrying the same source.
2. Attempt one short reconnection of the active source.
3. Try the next healthy station in the same genre.
4. If unavailable, ask the event scheduler for the next eligible genre and try that genre's first healthy source.
5. If no radio source works, try the existing fixed-playlist player/next eligible queue item if possible.
6. Otherwise enter the existing waiting/manual state and show a clear organiser message.
7. Record source failure reason and backoff; do not permanently blacklist a station for a single transient timeout.

### 8.5 Browser suspension, refresh or handover

- Do not replay a radio track solely because the browser was suspended or refreshed.
- Reclaim/verify the player lease. If the same device still owns it, reattach to the current stream only after a user gesture if the browser requires it.
- If another device takes the lease, stop the old audio source and invalidate its callbacks.
- A handover cannot guarantee transfer of the exact live-radio timestamp. The new player joins the station's current live position; this is acceptable for radio fallback and must be shown in the organiser UI.
- If the outgoing radio stream was interrupted, do not count the interruption as a genre transition or completed song unless the track boundary was actually observed/confirmed.

### 8.6 Source quality/content unsuitable

The organiser must be able to disable or deprioritise a station after a poor-quality broadcast, ads, unsuitable DJ programme, explicit content or genre drift. Never attempt to remove or mute station advertisements. Mark the source as organiser-rejected for that event or globally disabled through an owner-controlled configuration. For a live DJ programme that changes away from the declared genre, use a verified track classifier only if available; otherwise rely on the station's curated format and allow organiser override.

---

## 9. User interface and event operations

Respect Qroove's established dark, high-contrast, phone-first visual system. Do not redesign the app as part of this feature.

### 9.1 Organiser/player view

Add a compact source-status row near the existing `Now Playing`/player controls:

```text
NOW PLAYING
[Radio] SalsaViva · Salsa
Artist — Track title

Radio fallback: ON    Source: Healthy
Next style: Bachata
```

Use actual project visual tokens and genre colours. Ensure the UI clearly distinguishes:

- user-requested Qroove track;
- fixed-playlist track;
- live radio station track;
- manual/external playback;
- metadata unavailable/stale.

Do not duplicate title/artist/artwork if the underlying player already displays them. The genre, source type, station and diagnostic/warning are the additional information that matters.

### 9.2 Attendee view

Keep attendee display minimal. The attendee can see `Radio fallback · Salsa` or `Radio fallback · Bachata` and a now-playing title/artist when the metadata is verified. Do not expose player-only controls, provider URLs, station health diagnostics, API data or admin actions.

### 9.3 Event setup defaults

- New events: radio fallback enabled by default.
- Initial genre: Salsa if event rules allow it.
- Priority: Salsa, Bachata, Other, Cha-cha.
- Per-style maximum runs: use the event's existing default configuration; do not create a different hidden radio-only cap.
- Existing active events: migration must not rewrite frozen rules. Apply radio fallback only as a separate compatible operational setting, and only if that setting is permitted by the current event model.

If the event template supports user-configurable allowed genres, populate radio fallback only for those selected styles. Do not silently enable Bachata/Other/Cha-cha in an event whose style rules exclude them.

### 9.4 Admin runbook updates

Before the event:

1. Check that fallback is enabled and at least one source is healthy for the event's initial genre.
2. Tap `Sound check` and verify audio comes through the connected speaker.
3. Confirm the player device is the sole playback lease owner.
4. Confirm metadata is current and source track changes are being observed.
5. If a source is unhealthy, choose another station or use the existing fixed playlist/manual mode.

During the event:

- Radio starts automatically when no eligible queue item is available.
- User submissions wait for the current radio track boundary before handoff.
- Organiser can manually skip/switch if the broadcast is unsuitable.
- If track metadata is stale, Qroove keeps current audio where possible and warns rather than making an unverified switch.

At event end, stop and release all radio streams, close subscriptions/pollers and preserve event history with only track metadata/source identifiers.

---

## 10. Technical implementation phases

Complete phases autonomously in this order. Do not ask for the user's next instruction between phases. If a gate fails, implement the prescribed degraded path and continue with the remaining work.

### Phase 0 — repository and provider feasibility audit

- Inventory the Qroove repository and current playback/queue architecture.
- Add a requirements traceability table mapping each requirement in this file to code/tests.
- Identify the actual existing player implementation and define the smallest extension point.
- Test SalsaViva's public page/stream and Bachata Sensual's public player/stream.
- Determine unauthenticated metadata access for each candidate; record exact status code/content type/CORS/latency/metadata fields without storing credentials.
- Verify the actual stream codec and browser compatibility.
- Produce a short technical decision record for each station: `usable`, `usable with degraded metadata`, or `not usable`; state evidence and chosen fallback.

**Gate:** at least one station per one of Salsa/Bachata has both a playable stream and a metadata method appropriate to the selected mode, OR the degraded-mode behaviour is explicitly implemented. Do not mark a station as fully verified solely because its website displays a song title.

### Phase 1 — domain integration and selection logic

- Extend the existing playback source abstraction with `radio` while preserving existing queue/fixed-playlist behaviour.
- Add pure function `chooseRadioFallbackGenre(eventRules, playbackHistory, availableRadioSources)` that reuses the same rules and returns a reasoned result.
- Add `getNextPlaybackSource()` decision flow: eligible queue item first, then radio, then waiting/manual.
- Add synthetic system-owner playback-history events; test genre runs/transitions against existing scheduler invariants.
- Ensure no mutation of frozen rules and no participant quota/identity changes.

**Gate:** deterministic property tests show all existing queue invariants still pass with arbitrary radio tracks interspersed.

### Phase 2 — provider adapters

- Implement `RadioCoMetadataAdapter` only if a real station is confirmed to use Radio.co and the unauthenticated endpoint succeeds.
- Implement `AzuraCastMetadataAdapter` only for confirmed stations/hosts.
- Implement `Live365MetadataAdapter` using public metadata where available; add ICY probe only if it passes cost, terms and reliability checks.
- Add generic ICY parser behind a tested interface if needed; unit-test chunk boundaries, padding, reconnect and malformed metadata.
- Add station registry, health status, staleness and circuit breaker.
- Add adapter contract tests using captured fixtures with personal data removed.

**Gate:** provider response parsing is deterministic; metadata staleness and outages cannot trigger false track starts.

### Phase 3 — playback integration and handoff

- Reuse the one existing player controller and lease.
- Add direct HTTPS radio audio source support.
- Add user-gesture audio unlock and source health handling.
- Implement radio-to-radio genre handoff at outgoing song boundaries; incoming source may join mid-track by default.
- Implement radio-to-queue handoff at active source boundary and queue reservation validation.
- Implement optional crossfade only after Safari/Android/desktop validation; otherwise do a deterministic short hard switch.
- Implement pause, resume, skip, event end, refresh, browser suspension, player handover and stale lease fencing.

**Gate:** no duplicate audio controllers, no phantom plays and no accidental replay after refresh/handover.

### Phase 4 — organiser/attendee UI

- Add compact radio status, current station/genre and metadata confidence to existing player/Now Playing components.
- Add fallback enable/disable and retry/skip controls subject to existing permissions.
- Add clear error/warning/metadata-stale states and no-source empty state.
- Keep the attendee UI minimal and preserve established layouts.

**Gate:** organiser can understand and recover a failed source without developer intervention; attendee can tell whether music is from the queue or radio.

### Phase 5 — tests, operational rehearsal and deployment

- Run all existing tests plus the matrix below.
- Rehearse a full 2-hour simulated event with no submissions, late submissions during radio, emptying the queue, radio failures, source switches, pause/resume, browser refresh and handover.
- Test on current iPhone Safari and Android Chrome using actual devices, not desktop emulation alone.
- Measure metadata/audio offset for both stations over at least 10 track changes each (more where variance is high).
- Verify Railway usage/cost from metadata calls and avoid server-side audio relay/continuous stream probes unless explicitly justified by measurements.
- Deploy through the existing controlled release process; do not make production changes outside established deployment instructions.

**Gate:** all acceptance criteria pass; otherwise keep radio fallback disabled by default in production until failures are resolved, but do not remove working implementation or existing playback.

---

## 11. Test and acceptance matrix

### 11.1 Queue/fallback behaviour

1. New event, no queue, no history: Salsa radio starts after organiser taps Start.
2. New event, Salsa disabled: try Bachata, then Other, then Cha-cha only if a valid source is configured and that style is enabled.
3. New event, first eligible Qroove track present: play the queue track, not radio.
4. Current queue song completes and queue is empty: radio begins at the next boundary without an avoidable silence delay.
5. Radio is playing; a song is submitted: let the current audible radio song finish, then play the eligible queued item.
6. Queue item is withdrawn or removed while handoff is pending: cancel reservation and continue radio.
7. Multiple queue items arrive while radio plays: existing scheduler chooses next; radio handoff does not change FIFO/fairness.
8. The queue later empties: radio resumes based on updated last-played style and rules, not always Salsa.
9. One participant submits all tracks and becomes temporarily ineligible: radio may play a genuine permitted genre transition; it must not bypass requester-spacing or genre caps.
10. Radio track starts: style run/transition history updates exactly once; participant quota does not.
11. Radio station repeats the same title in a later rotation: it creates a new play event if provider start timestamp/identity proves it is a new occurrence.
12. Radio metadata does not change for a long live DJ set: no false track boundary from timeout alone.
13. No healthy radio source: clear no-source/manual state, normal queue submission continues.

### 11.2 Metadata/provider tests

- GET station metadata with no cookies, no auth header and no API key.
- Confirm HTTP status, content type, CORS headers, cache headers, response schema and current-track timestamp.
- Confirm stream is HTTPS, playable, supported format and does not require a login/subscription.
- Confirm track changes are observed for actual scheduled/live programming, not only on the website demo player.
- Record at least 10 transitions per source with audio/video capture or independent listening timestamp; calculate median and p95 metadata-to-audio offset.
- Confirm a station's genre remains suitable during day/evening/night and DJ/live programmes.
- Test stale response, repeated response, missing title, malformed artist/title, null duration, wrong track timestamps, 429, 401/403, 5xx, timeout and DNS failure.
- Verify whether browser CORS is sufficient; if not, prove the server-side metadata-only proxy works without relaying audio.
- Verify station page/player changes do not silently break the adapter. Add a documented manual re-verification procedure.

### 11.3 Audio/device tests

- iPhone Safari: user gesture, audio start, pause/resume, source switch, volume/gain, foreground/background, screen lock, refresh, Bluetooth speaker.
- Android Chrome: same scenarios plus app switch and network handoff.
- Desktop Chrome/Firefox/Safari where supported.
- Test MP3/AAC/HLS content types and actual station codecs.
- If crossfade is implemented, confirm there is no double-volume jump, phase/echo, silence gap or muted incoming stream. If not reliable, verify hard switch.
- Network drop during radio: reconnect; do not claim track played/ended without evidence.
- Player lease transfer: old device becomes silent before new device starts; no overlap.

### 11.4 Existing product regression tests

Re-run all current scheduler, queue, participant limit, duplicate, event state, break, end-time, overflow, pause/resume, admin handover, player handover, PWA/offline, API security and persistence tests. The radio work must not weaken any existing property test or silently change existing semantics.

### 11.5 Definition of done

- No queue item loses precedence to radio.
- Radio begins when no eligible item is available and fallback is enabled.
- Initial radio choice is Salsa when allowed and healthy, with the required priority order and event-rule constraints.
- Radio tracks update the existing playback history correctly without being attributed to participants.
- User-submitted tracks hand off at a detected outgoing radio boundary, not immediately on submission.
- Provider adapters make no unauthenticated/public API claim until directly tested.
- Metadata staleness, source outage, CORS, unsupported codec, autoplay failure and provider throttling have deterministic recovery.
- Only one playback lease/controller is active.
- Existing fixed-playlist and queue playback still work unchanged.
- The organiser can disable or recover radio fallback without a code change.
- No audio is proxied through the Qroove server.
- No unverified source is enabled by default.
- All relevant tests/build pass and docs/runbook are updated.

---

## 12. Deployment, cost, privacy and maintenance

### 12.1 Cost controls

- Prefer provider public JSON/push metadata over raw-stream probing.
- Poll once per station from the active player/backend service, not once per attendee.
- Use bounded caching and low request rates. For example, the player can poll the Qroove backend for source status while the backend updates provider metadata once per station.
- Do not proxy radio audio. It would turn a low-bandwidth event-control app into a high-bandwidth streaming relay.
- Avoid permanent two-stream warm standby unless it is required for verified boundary behaviour and device/network testing proves it works. Two simultaneous 128 kbit/s listener streams use roughly 115 MB/hour per playback device before overhead.
- Avoid a separate always-on worker/service. Reuse the current deployment and event runtime; use a lightweight timer only while an event/player lease is active.
- Stop metadata subscriptions and pollers when event ends or no active player needs them.
- Log errors and state changes, not audio payloads or repeated full API responses.

### 12.2 Privacy/security

- Public station metadata is not personal user data, but do not pass participant tokens to third-party radio providers.
- Do not put event admin capabilities or participant identifiers in provider requests/referrers.
- Validate station URLs against an allowlist. Never accept arbitrary user-supplied stream/API URLs and fetch them server-side.
- Redact provider diagnostics and avoid logging secrets or full tokens.
- Enforce existing organiser permissions server-side for source selection, skip, enable/disable and global station rejection.
- Escape station names, song titles and artist names before rendering; provider metadata is untrusted input.
- Keep radio station/source configuration free of credentials. If a future provider unexpectedly requires credentials, do not embed them in frontend code; look for a public alternative or ask for explicit product approval rather than silently adding a paid dependency.

### 12.3 Music licensing

The organiser has confirmed that the LSU session already has the required music licence for this use. Treat that as a settled project constraint; do not block implementation by reopening the licensing question. Do not remove station advertisements, bypass provider restrictions, or assume that public listening authorises arbitrary rebroadcasting. Audio plays directly from the station to the event player; Qroove is not to record or redistribute the stream.

### 12.4 Operations and maintenance

- Keep station source configs version-controlled and non-secret.
- Store last-verified timestamp and metadata method for every enabled station.
- Revalidate endpoints after a provider/site/player change, and disable a source automatically only after a defined failure threshold; notify the organiser in-app.
- Maintain one known-good source per enabled genre where possible. If no backup source exists, the UI must clearly say so.
- Maintain a simple `Radio diagnostics` organiser/owner view: last audio check, last metadata check, current track, last track change, metadata latency, source URL host (not full internal diagnostics), and failure reason.
- Never hide a source outage by leaving a stale `Playing` badge indefinitely.

---

## 13. Autonomous implementation instructions to the coding LLM

Act as the principal full-stack engineer, media-playback integrator, deterministic scheduler specialist and QA owner. Implement this complete feature in the existing Qroove repository.

1. Inspect the repository and current system first; use the existing project instructions and implementation specification. Do not assume stack, routes, schema or player internals from this plan.
2. Preserve all existing functionality and queue invariants. Extend the present player/provider abstraction; do not replace the app's playback system.
3. Verify external streams and metadata sources empirically. Use documented public endpoints and unauthenticated reads. Never invent station IDs/endpoints or treat a public web display as a supported API.
4. Implement SalsaViva and Bachata Sensual as candidate configurations, but only enable a station after its direct audio and track-boundary metadata have passed the feasibility tests. If one fails, follow Section 8 and implement the next viable station/provider adapter without asking the user.
5. Make radio fallback work from the start of an empty event, after the last current song, and whenever the queue has no eligible item. Queue tracks always take precedence at the next safe boundary.
6. Use event rules and last-played history to choose genre. Default priority is Salsa, Bachata, Other, Cha-cha. Initial source is Salsa when enabled/healthy. Never override a frozen genre cap or requester fairness rule.
7. Treat radio tracks as system-owned playback history, not attendee requests. Do not increment participant request quotas or create attendee identities for radio songs.
8. Keep one authoritative playback lease. Handle player refresh, suspension, reconnect, handover and event end without duplicate audio.
9. Implement metadata adapters, source health, staleness, latency calibration, bounded retries, circuit breaker and organiser diagnostics. Do not rely on hidden undocumented provider APIs, scrape private endpoints, bypass authentication or strip ads.
10. Start with metadata polling/push and one audible stream. Add a muted warm standby/crossfade only if it passes actual iPhone Safari and Android device testing. Do not compromise reliable playback for a visually seamless transition.
11. If incoming/outgoing station boundaries cannot align, use the documented default: finish the outgoing audible track, then join the next station's live stream (possibly mid-track). Do not wait indefinitely or falsely promise complete incoming tracks.
12. Do not stream audio through the Qroove backend. Only proxy compact allowlisted metadata when browser CORS requires it and provider terms permit it.
13. Complete every phase, including all fallback/recovery paths, tests, deployment documentation and runbook changes. Do not stop after reporting that a provider endpoint is inaccessible; use the alternatives in Section 8.
14. Do not make production deployments, push commits or modify unrelated files unless the repository's existing instructions and explicit task authorisation permit it.
15. At completion, provide a concise report with files changed, provider endpoints actually verified, enabled/disabled station status and evidence, switching mode, tests run, browser/device results, known limitations and exact deployment steps. Clearly distinguish proven behaviour from unverified candidate paths.

**Final engineering principle:** Qroove's queue remains authoritative. Radio exists to keep the room playing when the queue cannot supply an eligible track; it must never undermine the event rules, hide an outage, or make unsupported claims about metadata timing or song completion.

---

## 14. External technical references

All sources below were checked on 5 November 2026. These references explain provider capabilities; they do not prove that a particular station has enabled every feature.

1. **SalsaViva public Live365 station page** — current and recently played track display: <https://live365.com/station/SalsaViva-a37497>
2. **SalsaViva official website:** <https://salsaviva.fm/>
3. **SalsaViva candidate stream listing** — third-party directory, so revalidate URL before use: <https://www.rcast.net/dir/salsa/page1>
4. **Bachata Sensual Radio official site** — 24/7 description, now-playing display, Radio.co schedule embed and listener statistics attribution: <https://bachatasensualradio.com/>
5. **Radio.co developer API** — public track endpoint, station details/status, player methods and `songChanged` event: <https://www.radio.co/api>
6. **AzuraCast Now Playing Data APIs** — public JSON metadata and optional live update mechanisms: <https://www.azuracast.com/docs/developers/now-playing-data/>
7. **AzuraCast API overview/authentication notes:** <https://www.azuracast.com/docs/developers/apis/>
8. **Live365 server/protocol description** — proprietary Icecast2-based streaming, ICY and HLS: <https://help.live365.com/en/support/solutions/articles/43000532835-what-server-types-does-live365-use>
9. **Live365 stream URL/encoding documentation** — output formats and mount URL examples: <https://help.live365.com/en/support/solutions/articles/43000739178-output-encoding-settings>
10. **Live365 metadata timing explanation** — metadata may not align exactly with audible track transition: <https://help.live365.com/en/support/solutions/articles/43000608525-why-is-the-metadata-delayed-and-not-displaying-in-real-time-sync-with-the-music>
11. **Live365 public player and Last Played widget guidance** — public station profile/player behaviour and broadcaster-dashboard widget setup: <https://help.live365.com/en/support/solutions/articles/43000533536-how-do-i-launch-my-live365-station-from-my-webpage>
12. **Radio Browser API documentation** — station search, health checks, request format and no-uptime-guarantee warning: <https://docs.radio-browser.info/>

