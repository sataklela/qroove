# Changelog

All notable changes are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **Log in with Google for YouTube playlists.** _My YouTube playlist_ now works like _My Spotify playlist_: a guest logs in with Google (read-only `youtube.readonly` scope; the refresh token stays in an encrypted HttpOnly cookie on their device) and sees their own playlists, private ones and _Liked music_ included. Needs `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and a consent screen set up in Google Cloud (runbook: Google sign-in). Without them the login link is hidden and the public-channel lookup remains. ADR 0024.
- **My YouTube playlist.** Under _Add music_, guests can paste their YouTube channel link or @handle (remembered on that device) and pick one of its public playlists, like _My Spotify playlist_ but with no sign-in. Uses the existing YouTube Data API key (`GET /api/youtube/playlists`, 2 quota units); the songs then load through the same playlist import as a pasted link. 
- **Radio fallback.** An organiser switch (on by default; fills genre gaps when one genre is held by its run limit) plays a live station when no guest song is due: Bachata Sensual Radio is enabled (Salsa, Other and Cha-cha have no verified station yet; SalsaViva answered 401). The player tells the server which radio track is audible (`POST /player/radio/started` and `/ended`, `POST /admin/radio`); radio updates the genre history without being anyone's request and never counts toward a run; a waiting guest song takes over at the station's next track, after 4 minutes at most, or on _Play the queued song now_. Guests see "Radio fallback" on _Now playing_. ADR 0023.
- **Queue first, My songs one swipe away.** Once a guest has joined, the whole queue is open by default under _Add music_, and _My songs_ is a second tab you reach by swiping left or tapping the tab, where you can still review and withdraw what you submitted.
- Picking one of your Spotify playlists now closes the playlist menu straight away and scrolls to the songs it loaded, instead of leaving the menu open until you add them.
- **Organiser console.** The event starts by itself when the organiser page opens (Pause is there if wanted; the _Start event_ button remains as a fallback). Radio starts by itself too, and one **Start radio** button appears only if the browser refuses sound; the separate _Allow sound for the radio_ button is gone. The _Radio fallback_ tick box moved to the third page (More), and the pause / skip bar is slimmer with a shorter player area, so the queue gets well over half the screen. A radio station now fades in over 4 seconds when it starts or resumes after a pause (it already faded out on pause).
- **Radio fixes.** (1) Switching radio off and on again now carries on with the station that was on, and no longer rests every station (which ended with "no station is available"): an interrupted `play()` or the error raised by deliberately removing the source is not counted as a station failure, switching it on or tapping _Start radio_ forgets earlier failures, and a "no station" state retries by itself when the earliest resting station is back. (2) _Pause At End of Current Song_ now fades a playing station out over 4 seconds (`pauseFadeMs`) instead of cutting it; resuming during the fade restores the sound. iPhones ignore the volume setting, so there the sound still just ends.
- **Salsa radio.** Radio Calle Latina Salsa (Lima, via Zeno.fm) is enabled as the Salsa station, so Salsa gaps and the start of an event are filled with Salsa. It brings a second now-playing source: Zeno's server-sent-events feed (one event read every 10 s, no key, no audio through the server). The CSP now allows the Zeno stream, its signed `surfernetwork.com` host and `api.zeno.fm`. Waiting guest songs still take over after at most 4 minutes.
- The radio fallback implementation plan is now kept in the repository (`troubleshoot/Qroove_Radio_Fallback_Implementation_Plan.md`), and ADR 0023 ends with a table of what is done against it and what is not (no Salsa station, no ICY/AzuraCast adapters, no crossfade or strict alignment, no organiser skip or sound check, no device tests).
- **Radio starts at once; songs before Start.** Radio no longer waits 5 minutes after Start: it plays immediately unless a queued song is ready. Guests can now join and submit songs while the event is still a draft; they appear in the queue in submission order and only play once the organiser starts the event.
- **Radio in the queue.** The _Whole queue_ now ends with a dashed "Radio Salsa queued" / "Radio Bachata queued" row (the station the player would pick) wherever no guest song is eligible, with "add a song to take its place".
- UI overhaul of the two main screens. **Live deck:** a header with the real live/paused/ended/reconnecting state, a wide _Now playing_ card beside a narrow _Next up_ card (a time only when the queue is sure of it), a compact _Add music_ card showing your accepted-songs count and genre chips, and a _My songs_ card in play order with a collapsible _Played songs (n)_. The old _Up next_ list is now the collapsed _Whole queue_. **Planner:** three drums in one row (total duration, songs in a row, songs per person), a _Synced parameters_ switch (5 songs per 15 minutes, 5 to 50), one card per genre with a separate non-Latin switch, a _Visual event progression_ preview drawn by the same scheduler the queue uses (ratio, approximate song count, legend and a text version), and a sticky **Create event** bar. See [ADR 0021](/adr/0021-ui-overhaul).
- Songs found through Spotify now play in full from YouTube when Spotify cannot (no Premium login, a refused account or only a preview). The matching video is found by title, artist and length with the YouTube Data API (`YOUTUBE_API_KEY`) and cached; adverts play out with the page's own sound muted. `GET /api/events/:id/player/youtube/:rid`; ADR 0022.
- Spotify and YouTube songs now play on the player page, in each service's official player, and the queue advances when they end. Spotify needs a browser signed in to Premium; a 30-second preview is refused rather than counted as played.
- Song links work wherever playlist links do, with title, artist and length taken from the source. A YouTube Music song link counts as that song, not its radio mix.
- Guests can add a whole playlist: paste a link, sort the songs (drag to reorder, swipe left to remove with a red bin, swipe right to send to the top with a green arrow), and add the top songs that fit their remaining allowance; the rest are greyed out. `POST /api/resolve-playlist` and `POST /api/events/:id/requests/batch`.
- The organiser's create page uses the same sortable list for playlist songs (greyed out beyond the planned time minus one minute); the create request now takes the sorted `songs` instead of playlist links.

### Changed

- Genre colours are now the same everywhere: red salsa, blue bachata, amber cha-cha, purple Other (bachata was black, Other grey). The dark theme uses the new charcoal and amber palette.
- Planned time on offer: 0:15, 0:30, 0:45, 1:00, 1:30, 2:00, 2:30, 3:00, 3:30, 4:00, then whole hours to 8:00 (the API still takes any multiple of 15 minutes).
- The live status on the event page is now a labelled pill in the page, not a dot in the header.
- Joining requires a name.
- Guests can search Spotify inside Qroove with no login, and accounts on the pilot list can log in to use their own playlists.
- New defaults: 1 song in a row (up to 3); 20 songs per person, in steps of 5, with a maximum that grows with planned time (5 per 15 minutes).
- Organiser controls: **Pause At End of Current Song** and **Resume Playback** replace the icons; Skip asks twice; the state label at the top is gone; played songs are greyed out; the player's corners no longer show white.
- Organisers can log in with Spotify so the Qroove page itself plays full songs (Premium, pilot accounts only), with simple pause and resume. The embedded player remains as a fallback.
- The organiser's device is now the player: the organiser page takes the role by itself and shows one **Start playing** button, with a warning while nothing plays. The separate player page and the required sound check are gone; the chime and local files are optional under More.
- The queue now looks only at genres: one person's songs can play back to back, up to each genre's limit. The per-person song limit stays, and an event with one genre has no run limit.
- Landing page: the "Start from a playlist" button and the tagline are gone. The footer is now a short copyright and contact note there, and a single copyright line on every other page. The licence moved to a new License page in the docs.
- The interface and its messages now mention only Spotify, for the first test.
- Tidier player and guest pages: local files are an optional collapsed section, the audio bar appears only when a file plays, and empty or repeated guest sections are gone.
- One "Add music" card replaces the separate song form and the music-plus-sign section. It takes a link and a top-level genre, and warns which other genres to remove. Artist, length and typed titles are no longer asked for.
- The live status is one small green dot under the event name in the header, with no "Live" text.

### Fixed

- Long-press paste works in fields on organiser, player and event pages.

### Changed (also)

- Joining: the permanent 6-character room code (shown as two triplets, `ABC-123`) now joins on its own, so remote classes can use it, and the landing page opens the event as soon as the sixth character is typed. The QR code stays on the Invite page as a non-verbal backup (it is the same public link). The secret join key is gone.
- The event name moves to the header on organiser and attendee pages: very small, lower-case, hyphen-separated (`mango-octopus-rye`), Courier New, in the menu's colour and not selectable, so it reads as a label. The big heading is kept for screen readers only.
- Creating an event (or carrying one over) goes straight to the organiser page. The interstitial that showed the organiser link and recovery secret is gone, and so is the recovery form: control belongs to the browser that created the event, and moves by handover.
- Buttons have a lighter background so they stand out from the page; the timeline's genre stripes are drawn again on every browser (segments are no longer `<button>` elements, whose layout Safari ignores); the break's time range above the bar is gone, only its minutes and the remove button remain.
- Organiser console: Playing + queue, the QR code and the rest (player, hand over, time, rules, end) are three pages to swipe between sideways, replacing the bottom tab bar, so scrolling the queue no longer affects them. Pause and Resume are icons. The queue has its own blue-grey background.
- The footer is a single thin, small block (about a quarter of its former height), with Docs and Source inline.
- Timeline gestures: tap a part of the bar to select it; press and hold a part to add a break in its middle (snapped to the 10-minute grid). Breaks are dragged as a whole, and only the end handle changes their length (the start handle is gone). Minutes are written above every break and every part. Breaks still cannot touch (at least 20 minutes of music between them).
- Time stamps sit above the timeline (in a fixed-height row, so selecting a break never moves the bar); the "h:mm" caption under the time wheel is gone.
- Breaks are royal purple (was sky blue).
- Style selectors show the style's name inside a box whose thick border is its colour (striped for non-Latin); unselected boxes fade border and text together. The same boxes are used when an attendee picks a style for a song.
- Wheel pickers settle faster: the value follows the wheel live, and the rest position is confirmed on `scrollend` (fallback 40 ms, was 90 ms).
- Header: the menu is a three-line icon holding Docs, Privacy and Source (plus session rules on event pages); light/dark is a sun/moon toggle beside it.

## [0.3.0] - 2026-10-29

### Added

- Wheel pickers (drums with fade-away rows) for planned time (quarter hours, default 2:00), most songs in a row, songs per person and ratio parts; the ratio defaults to an equal split.
- Visual timeline: the evening as one bar of fixed width; tap to add a break (10-minute grid), drag handles to move or resize, limits enforced while dragging.
- Rules per part of the evening: each part between breaks has its own styles and ratio; new parts copy the part they split.
- Colour-coded genres with a thin white outline (red salsa, black bachata, orange cha-cha, grey Other, stripes for non-Latin); swatches replace most style text.
- "Other (Musicality Exercise)" style; style grid with Latin styles on the left and non-Latin counterparts across.
- Generated event names (three neutral words); no name is repeated until all permutations are used, and consecutive names share no word.
- Playlists per style: one per style, every active genre needs one (a Latin style's playlist covers its non-Latin counterpart and vice versa); songs interleaved and cut to the planned time minus one minute.

### Changed

- Event names can no longer be typed; the create request rejects a `name`.
- Planned time moves in quarter hours (was ten-minute steps); breaks are placed by tapping the bar (was evenly spread automatically).
- Default styles are salsa and bachata with their non-Latin versions; cha-cha is an extra.
- Rules snapshot is version 3.

### Removed

- Break-adding buttons, number inputs and the event name field on the create screen.

## [0.2.0] - 2026-10-29

Changes from the first pilot feedback.

### Added

- Six dance styles in three genres (salsa, bachata, cha-cha, each with a non-Latin-compatible variant); style changes and run caps count per genre. One master "most songs in a row" number, with an optional ratio (parts 1–5) and a hard floor of 1 part in 10 per genre.
- Single-genre spacing: a returning requester waits for half of the other people's waiting songs.
- Planned time like an oven timer (hours up to 8, minutes in steps of 10); breaks (10/20/30 min, at most 3) centred on the planned time, at most half of it, never back to back, shown in the attendee queue; songs never run into a break.
- Playlist import: start an event from a public Spotify, YouTube Music/YouTube or Apple Music playlist link, queued up to one minute less than the planned time.
- Joining needs the secret in the organiser's QR code; a room code alone no longer joins.
- Landing page with six single-character code boxes (auto-advance, paste, backspace), header with the logo (home link) and a menu with session rules and theme.
- Organiser console that fits one screen (Queue / Invite / Player / More tabs; only the queue scrolls).
- Right-click and text selection are disabled on organiser, attendee and player pages (a deterrent).

### Changed

- Ending an event is two distinct taps with nothing to type.
- The organiser screen shows only the QR code: no room code, join link or copy button.
- Carry-over keeps the previous planned time and fits songs within it minus one minute.
- Rules snapshot is version 2.

### Removed

- Pasting or uploading a JSON export to start an event, and the JSON download on past events.
- Kizomba, merengue and "other" styles; free-form planned end time at creation; creation templates.

## [0.1.0] - 2026-10-29

First release, ready for the pilot.

### Added

- Monorepo scaffold (pnpm workspaces, strict TypeScript, ESLint, Prettier).
- `@qroove/config` with brand, style presets and rule defaults.
- Fastify server with `/api/health`, static hosting for the web app and docs, helmet CSP and compression.
- React + Vite PWA shell with landing page and the Sataklela OÜ copyleft footer.
- VitePress docs site served at `/docs`, with initial architecture pages and ADRs.
- Dockerfile, `railway.json` and GitHub Actions CI.

- Brand assets in `brand/` (avatar + transparent logo) and `pnpm icons` to generate favicons, PWA/maskable/Apple icons and Open Graph preview images.

- `@qroove/contracts`: zod 4 schemas for rules (with canonical hash), events, requests, player leases, every API body, and typed error codes with user-facing copy.
- `@qroove/scheduler`: pure eligibility, selection, queue projection (ETA and overflow) and quota logic, with example and property tests.
- Docs: scheduler architecture page, ADRs 0004 (no ageing bonus) and 0005 (quota counts played).
- Persistence port (`Repository` / `EventTx`) with a memory adapter and a Firestore adapter, both passing one contract suite; the Firestore run uses the emulator (`pnpm --filter @qroove/server test:emulator`, also in CI).
- Domain commands: create/update/start/pause/resume/end/archive events, end-time and breaks, join, submit/withdraw/remove requests, metadata resolution, admin handover and recovery, player lease (claim, heartbeat, started, finished, release), and snapshot import with a seeded per-style shuffle.
- Automatic next-track reservation, request-state labelling and a denormalised queue preview after every change.
- ESLint rules: `firebase-admin` only under `db/firestore`; no `Date.now()` in domain code.
- Docs: data model page and ADR 0006.
- HTTP API: every route in SPEC §8 plus `by-slug`, `resolve-link`, `admin/session|state|stream|draft|breaks|duplicate|recover|archive`, export/import and the reserved `/api/spotify/callback`; zod-validated bodies and typed JSON errors with a next action.
- Admin auth: URL-fragment secret exchanged for an HttpOnly `SameSite=Strict` cookie, with origin check and double-submit + HMAC CSRF.
- Per-IP/per-participant rate limits and a 16 KB body limit.
- Link intake: allowlisted `parseLink`, Spotify Web API (client credentials, cached token) with oEmbed fallback, iTunes lookup for Apple Music, YouTube oEmbed; SSRF-guarded fetch; ISRC → platform id → fingerprint duplicate keys; possible duplicates held for admin review; style suggestions from title cues only.
- Server-Sent Events (`/stream`, `/admin/stream`) fed by one repository subscription per event.
- Attendee UI: landing with join-by-code, event page (`/e/:slug`) with live connection indicator (SSE with 10 s polling fallback), now playing, "My next song" with a ticking server-clock countdown, add-song form (paste, link preview, manual fallback, style chips, idempotent submit), my songs with confirmed withdraw, up-next list with overflow labelling, privacy page and a dark/light toggle.
- `ANALYZE=1 vite build` writes a bundle report (`rollup-plugin-visualizer`).
- Docs: attendee guide with screenshots.
- Organiser UI: create-event form with templates, one-time organiser link and recovery secret (`/new`), fragment-secret sign-in and handover claim (`/a/:id`, `/claim/:id`), and the organiser page (`/admin/:id`): playback controls with confirmation, moderation with possible-duplicate review, end time extension, breaks, QR + join code, hand-over, player status, read-only rules with fingerprint, typed-confirmation end, carry-over into a new event; read-only past playlist (`/h/:slug`). All lazy-loaded.
- API: `GET /admin/carry-over`; `GET /admin/state` now returns the CSRF token (the page cannot read the API-scoped cookie).
- Docs: organiser guide with screenshots.
- Docs: API reference, realtime, security, threat model and privacy pages.

- First production deploy on Railway (Firestore-backed) at https://qroove.sataklela.com, with Cloudflare DNS; deploy, DNS and Firebase runbooks.

### Changed

- `hashRules`/`canonicalJson` moved to `@qroove/contracts/hash` so the contracts index is browser-safe.
- Licence switched from MIT to AGPL-3.0-only.

- Player (`/player/:eventId`): lease claim/takeover with 10 s heartbeat and immediate stop on `STALE_LEASE`, required sound check, local-file library (files or folder, tags via lazily loaded `music-metadata`, filename fallback), optional IndexedDB "remember on this device", automatic start/finish reporting with auto-advance, manual mode (source link, Mark started/ended), Media Session and Wake Lock.
- `@qroove/contracts/normalise`: `norm`/fingerprint shared by the server and the player.
- Admin state includes each request's `sourceUrl` for manual playback.
- Docs: player guide.
- Retention purge (abandoned drafts 7 d, participants 30 d after end, audit 90 d, idempotency 24 h), run at start-up and every 6 h, and via `POST /api/internal/purge` with `CRON_SECRET`.
- `/import`: start an event from a pasted or uploaded playlist JSON; "Download as JSON" on past events.
- Playwright e2e suite with axe accessibility checks on every route (dark and light), a load-sanity script (`pnpm load`), and CI jobs for the Firestore emulator and e2e.
- Docs: backup and retention runbook.

### Changed

- Firestore transactions on one event are queued in-process, cutting p95 submit latency under 25 concurrent contributors from over 50 s to about 1 s on the emulator.
- Faded (opacity) list rows replaced by a dashed marker, which fixes a colour-contrast failure.
- The server now shuts down cleanly on SIGTERM and releases its Firestore listeners.
