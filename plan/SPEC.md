# LSU Salsa Society — Collaborative Music Queue

## Complete product, architecture, implementation, testing and operations specification

**Status:** Implementation blueprint, 29 October 2026  
**Owner:** Independent student/member project; no LSU commission or institutional integration  
**Primary use:** Friday Salsa/Bachata socials, 19:00–21:00, 20–40 participants, 15–25 submitters  
**Secondary uses:** Optional 10–20-minute dance break during Monday Salsa choreography (20:30–22:30) or Thursday Bachata choreography (19:00–21:00); casual small-group sessions, studio-to-Students'-Union continuation  
**Build:** Solo, GitHub + Claude Code; deploy on owner's existing Railway account; incremental operating-cost target £1/month; no additional paid services assumed.

---

## 0. Executive decision

Build a minimal, installable Progressive Web App (PWA) with a **server-authoritative, constraint-aware queue scheduler**, anonymous per-event identities, QR-code joining, immutable rules once the event starts, delegated administrator handover, and an interchangeable playback adapter. The primary ad-free playback adapter is an event-host-controlled library of audio recordings that the host is authorised to use; music-service URLs provide _track identification_, not unauthorised audio extraction. The product must operate with low bandwidth, continue through reconnection, and preserve the exact upcoming queue and genre-state across devices. Phase 1 can run with server-side metadata and explicit playback confirmation before a reliable automatic player is integrated. Phase 2 adds automatic playback from permitted locally stored audio on the player device and seamless song-end advancement. Keep the project non-commercial and separately named; do not imply LSU's approval.

### Hard boundaries

1. **No DRM circumvention, YouTube ripping, ad blocking or unauthorised audio-stream resolution.** Apple Music/Spotify subscriptions are not a dependency; an organiser-supplied rights-cleared music library is the primary automatic playback path.
2. **No rules edits once the event is active.** Rules are captured as a versioned snapshot at start; transfers cannot alter them. End-time extensions are an explicitly allowed _schedule-control operation_, not a change to genre or fairness rules.
3. **Superseded by ADR 0018 (2026-10-30): the queue considers genres only, not who added a song.** The requester-spacing text elsewhere in this document no longer applies.
4. **A genre limit is a cap on consecutive plays, not an exact block pattern.** Default Salsa 2 and Bachata 2, e.g. `S,S,B,B,S,B` is allowed _if the requester-spacing constraint is also satisfied_.
5. **No identical recording repeats in one event.** Distinct edits, remixes or versions require separate recording identity and review when uncertain.
6. **First accepted requester owns a recording in the event.** Later duplicates are rejected clearly and do not advance position, confer votes or consume the duplicate submitter's quota.
7. **Withdrawn, rejected or removed upcoming entries free one slot** of the relevant attendee's active-submission quota; already played/skipped entries and their quota treatment must be explicitly defined as below.
8. **No hidden reliance on logged-in user accounts, tracking cookies or personally identifying data.** A pseudonymous session token is enough; administrator link possession is a capability, not authentication by a real-world identity.

---

## 1. Scope, acceptance criteria, non-goals

### Required for first public pilot

- Participant: scan QR, join event anonymously, optionally choose ephemeral nickname, submit song via title/artist or share/paste Spotify, Apple Music or YouTube Music link; select style from controlled presets; see accepted songs, upcoming position and rolling time-to-track; withdraw unplayed, unstarted songs; clear feedback for duplicates, caps and infeasibility.
- Admin: create a session with optional concrete end time and named breaks; configure submission cap (default 5), per-style consecutive cap (Salsa 2, Bachata 2), allowed genres, style ordering preference, spacing rule (fixed for MVP), optionally seed song pool; start/freeze settings; moderate/delete unstarted songs and skip now-playing; pause/resume, hand over playback+controls, move venue, extend event by entering a _specific new end time_, end/archive event; import an old event as a new event; independently shuffle pools when creating a new event without violating FIFO/fairness commitments for live sessions.
- Scheduler: deterministic; transparent decision reason; never adjacent same owner, never replay a recording, no second track from requester without a style transition; obey per-genre run caps; preserve genre run state and owner eligibility over pause, skip, admin change and venue move; compute preview horizon and overflow from known durations.
- Playback: web player for files deliberately added to the authorised event library, autoplay initiated by explicit user gesture, with one active controller and fail-safe manual confirmation when autoplay/Bluetooth restrictions prevent automatic advancement. Local files can remain on the playback device; server only holds metadata and stable references as appropriate.
- Transport: phone-first, iOS Safari and Android Chrome/Firefox supported; graceful reconnect and caching of shell; no requirement for continuous high-speed connectivity.

### Not in MVP

- Commercial SaaS, billing, university SSO, profile accounts, follower/social graph, crowd votes, uploaded third-party copyrighted files hosted publicly by default, AI audio analysis, harmonic beat matching, tempo transitions, DJ mixing/crossfades, unlimited streaming catalogue, automatic genre recognition from audio, native mobile apps, video projector controls, browser notification delivery guarantees.

### Measurable pilot acceptance

- 40 connected people, 25 concurrent submitters, 100–150 unique requests submitted over a test session without duplicates/race corruption; target under 2 seconds for common queue mutations on reasonable connectivity, with explicit retry on bad links.
- Scheduler invariant/property test: 100,000 generated sequences containing no same-owner adjacency, no same-owner replay before a style change, no run exceeding allowed per-style maximum, no repeated canonical recording, and no song scheduled after a concrete event end-time.
- Pause/handover across two phones, interrupted internet, refresh, process restart: next unplayed song remains unchanged; only one controller may start a track; playback is not accidentally duplicated.
- Appropriately labelled forecast versus actual countdown; server-authoritative end-time state; withdrawn/rejected songs free the quota immediately.
- Accessibility: 44×44 CSS-pixel touch targets minimum, keyboard navigation, WCAG 2.2 AA colour contrast for text and controls, `prefers-reduced-motion`, readable in low light and under bright studio light.

---

## 2. User journeys and roles

**Guest**: opens event link/QR; device receives random participant ID and opaque event-scoped token. Sees 'Now playing', 'My next song', 'Add a song', 'My requests' and event clock; no login. Nickname optional and not unique. Can remove their own queued-but-not-started songs; cannot change rules, alter the queue or affect any other attendee.

**Session admin**: event creator holds a private, unguessable admin capability URL/code, not part of the QR. May review/mute/remove or skip, pause/resume, enter a concrete end time or extend it, import recommended carry-over songs, and initiate handover. Cannot change initial fairness, caps or allowed styles once started. Handovers revoke the old admin capability immediately or after a short grace for network acknowledgement; a stale admin must not regain control by refreshing.

**Designated player**: a lease-backed controller on the device connected to the Bluetooth speaker. A delegated admin may also own playback, but these are separate privileges. Transfer player lease only with explicit recipient acceptance, stop old player, preserve `next_track_id`, and require an explicit 'Start playback' tap on the receiving device due to browser autoplay rules. No attempt to transfer exact audio timestamp; continuation starts with _next unplayed song_, consistent with stated requirements. If the current track had already started, log it as played/partially played and do not replay it automatically.

**Historical viewer**: possesses a read-only public event link; can see catalogue and a reusable playlist view. Can import songs into a new event only by creating a new event with separate admin capability. No old participant IDs/identities transferred; historical participant nicknames should be removed or hidden by default.

### Session states

`DRAFT -> ACTIVE -> PAUSED -> ACTIVE -> ENDED -> ARCHIVED`; optional `ACTIVE -> TRANSFERRING -> PAUSED/ACTIVE`. `ENDED` is terminal; 'resume' applies only to non-ended sessions. To use an ended event's songs, _create a new event from a snapshot_, not reactivate the old event. Inactive/abandoned drafts expire under retention policy.

### Event UX examples

- Friday: choose template `Friday Social`, set 19:00–21:00 or no fixed end, Salsa/Bachata caps 2 each, 5 active requests/user, generate QR, start.
- Break: select `10-minute break` or `20-minute break` during event creation; default eligible style(s) editable before start, but class instructors can simply ignore the app. End time is applied to the break event, not to the longer class.
- Temporary routine: admin hits pause; scheduler reserves the track and halts running countdown; admin resumes and track selection remains stable.
- Studio → lounge: pause, initiate handover, receiver opens private claim link, reconnects different Bluetooth speaker, taps resume; current partially played song is considered consumed and the next unplayed track plays.

---

## 3. Rules: formal definition and invariants

### 3.1 Event rules snapshot

> **Superseded in part (2026-11-11, ADR 0025):** planned time, genres, songs in a row and songs per person may be changed by the organiser while the event runs; the hash is recalculated and each change is audited.

Store immutable `rules_version`, `genre_run_caps` mapping (default Salsa:2, Bachata:2), `submission_limit_active` (default 5), allowed style names, requester-spacing requirement (`minimum_style_transitions_since_requester_play=1`), `no_same_requester_adjacent=true`, `recording_unique_per_event=true`, FIFO admission order and music duration policy. Event time and pause/reservation periods belong to _mutable operational schedule_, separately audited from immutable rules. At event start commit frozen JSON and hash; server rejects any subsequent attempt to modify it, even from admin.

### 3.2 Per-track states

`PENDING_METADATA`, `QUEUED`, `INELIGIBLE_TEMPORARILY`, `RESERVED_NEXT`, `PLAYING`, `PLAYED`, `SKIPPED`, `WITHDRAWN`, `REJECTED`, `UNAVAILABLE`, `OVERFLOW`. Treat `OVERFLOW` as a derived view of queued entries, **not a permanent status**; if an end time is extended, those entries may automatically become reachable again. Track state transitions are server-validated. A moderator cannot remove a played record to erase the anti-duplicate history.

### 3.3 Submission quota

Adopt a **five accepted songs per participant per event** cap, including songs already played or skipped after starting. This best preserves the stated purpose of preventing one person's dominance. Count accepted `PENDING_METADATA`, `QUEUED`, `INELIGIBLE_TEMPORARILY`, `RESERVED_NEXT`, `OVERFLOW`, `PLAYING`, `PLAYED` and `SKIPPED` requests towards the cap. Do **not** count requests `WITHDRAWN` before starting, `REJECTED`, or `UNAVAILABLE` when finally removed before starting. If an administrator strikes off a future song, its slot immediately reopens for a replacement. If an admin skips a song **after playback begins**, it counts towards the five, even though it was not completed. Use the same distinction if media fails after starting, to avoid a loophole. Display `3 of 5 accepted songs this event` and explain that deleting an unplayed request frees its slot.

A song cannot be withdrawn once `PLAYING`. Moderating an unstarted reserved track frees the slot; an already started track cannot have its play history erased. Use transactional locking to prevent six concurrent submissions being accepted. A future requirement for 'five concurrently waiting, unlimited throughout the event' would be a **different versioned rule** and must not be silently substituted. This interpretation should be validated with dancers during the first pilot, but is the safest baseline given the primary fairness goal.

### 3.4 Fairness eligibility

Track `t` of style `g` owned by participant `p` is eligible iff:

- its `QUEUED` record is not already reserved elsewhere;
- its canonical recording has not been played/started in this event;
- `p != last_played_owner` (hard adjacency check);
- **there has been at least one actual transition between styles since the last `PLAYING` song owned by `p`**, unless this is `p`'s first played song;
- if `g == last_played_style`, current consecutive run of `g` is _strictly below_ the frozen max for `g`;
- style `g` is among allowed styles and playable media is available where required;
- adding the song does not exceed the remaining scheduled play window when fixed-end scheduling is enforced.

Transitions are counted **from the committed playback history**, not from future queue predictions. A change from Salsa to Bachata, then back to Salsa comprises two transitions. Skipped before-start/rejected/withdrawn songs do not count as plays or style transitions. If a currently playing track is skipped mid-song, count that started track for spacing, style run and duplicate blocking. Pauses, silence, breaks, announcements and controller moves do **not** count as genre changes. An optional other genre (Cha-cha, Kizomba, Merengue, etc.) counts as a style change when played, using its own immutable cap defined at event creation.

**Critical impossibility example:** If requester A owns all Salsa tracks and requester B all Bachata tracks, strict rules do not permit `A-S1, A-S2, B-B1, B-B2` despite the 2:2 genre cap: owner A (and B) would play twice consecutively. The acceptable sequence is `A-S1, B-B1, A-S2, B-B2, ...`, provided every returning requester has experienced a genre transition. If just one requester owns every outstanding song, play at most the first eligible track, then show `Waiting for another contributor / a genre change` rather than violating a hard constraint. Preserve user intent over literal examples that conflict with the declared anti-clustering requirements.

### 3.5 FIFO versus shuffled genres

Within each style use chronological first-accepted order as the default preference, but look past the head when it is _temporarily ineligible_; otherwise one blocked owner can deadlock all contributors. Stable fairness-aware selection chooses earliest admitted **eligible** request. Admin cannot arbitrarily reorder live queues. A historical pool can be shuffled **independently per style only while creating the next event**; resulting order becomes that new event's intake sequence, and all constraints continue to apply. Store shuffle seed for reproducibility. Participant live submissions remain chronological.

### 3.6 Style run caps and multiple styles

For two active styles default to `max_consecutive[Salsa]=2` and `max_consecutive[Bachata]=2`. This is **not** a duty-cycle ratio or mandatory 2:2 block. A single Salsa followed by one Bachata is legal. For other enabled styles, use configurable initial caps (recommend 1 as a conservative default), each frozen at event start. Where a style has no candidate, prefer any eligible different style; do not inject an ineligible song or silently exceed a cap. If no eligible candidate, enter `WAITING_FOR_ELIGIBLE_SUBMISSION` and give an administrator-readable reason.

### 3.7 Selection and deadlock

Use deterministic comparator: (1) prefer style other than last if its run cap is hit; (2) among eligible styles, choose one with longer waiting eligible request or older earliest entry, with a balanced-style tie-breaker to approximate the 2:2 maximum; (3) select oldest eligible song in selected style; (4) resolve exact ties using accepted sequence then stable ID. To prevent style starvation, expose an ageing bonus, but never let it overrule hard constraints. Do not change comparators mid-event. If no candidate is eligible, pause automatic advancement in `WAITING`; automatically retry whenever new submissions arrive, a playable source is made available, or current settings permit a new eligible move. A human cannot bypass the frozen constraints; the admin can remove a problematic request, solicit new contributors or end the event.

### 3.8 Playback reservation and concurrency

Maintain a **single next-track reservation** to prevent live reordering as new submissions arrive seconds before playback. Reserve on next selection with transactional event version check, then mark `PLAYING` only after the player explicitly acknowledges that actual audio has started. Reservation expiration must not silently start multiple devices. A monotonically increasing event generation/lease fencing token invalidates stale players. Track end happens through a signed player callback or timeouts with manual reconfirmation when uncertain. Never infer a song played merely because estimated duration elapsed if the player disconnected.

---

## 4. Time scheduling, ETA and overflow

If the admin provides **no end time**, do not classify any entries as overflow; show expected remaining queue length and rough duration, excluding unknown-duration songs from a precise ETA. If a concrete end time is set, compute `remaining_playable_seconds = end_time - now - reserved_break_seconds - expected_player_transition_overhead`; honour pause state, and recalculate after every state change. To prevent inaccurate predictions, store `duration_ms` with source/confidence and handle missing duration as unknown and no promise that a song fits. A partial song must **not** start when it cannot finish before the end time, unless a separately set, explicit operator policy allows overrun (not recommended for MVP).

Queue planner simulates future plays using **hypothetical history updates**, including future style transitions, instead of repeatedly running an eligibility check against unchanged current history. Do not mutate real events during projection. Return `(projected_track_ids, stopped_reason, predicted_starts, uncertain_ranges, overflow_track_ids)`. A `WAITING` result due to fairness is not necessarily overflow and must be distinguished. Grey out only those tracks predicted beyond the concrete end time; do not claim they can never play, as withdrawals, shorter songs or admin extensions can change the projection. When extending, admin enters a real clock time _later than the current cutoff_, the server audits who did it and immediately recomputes forecasts. Reject arbitrary duration extension buttons without showing the concrete new time.

**Attendee countdown:** For a request predicted to play in `n` tracks, show `2 songs until [Title]` (correct pluralisation) and a ticking `~MM:SS until your song`, based on known remaining duration of current track plus predicted preceding tracks. If the current song's actual progress is unavailable, use approximate counts and label `Estimated`. In paused mode freeze or replace timer with `Session paused`; in waiting mode show `Waiting for more eligible songs`; in overflow show `Beyond planned end — admin must extend`; where blocked show `Position not yet predictable`. Countdown must be based on server-supplied timestamp/clock offset, with occasional reconciliation, not a browser-local claim of authoritative state. Multiple requests show the _next_ one prominently and all others in a compact list. For online clients, use SSE where viable, with exponential-backoff polling fallback; no need for per-second network messages. The client can tick the display locally.

**Unplayed carry-over:** At the end, compile unique queued, unplayed recordings as recommendations for the next event. Admin may select any, none or all. Copies are new event-specific entries owned by a **system seed identity** (not original users), chronologically inserted as manually accepted starters or pool candidates, never blindly placed ahead of actual members. Treat system tracks as a separate synthetic requester subject to the **same** owner-spacing rule; otherwise a full sequence of seed tracks could monopolise the night. Make seeded entries optional/removeable before new event starts.

---

## 5. Media ingestion, deduplication and playback

### Link intake

- Recognise Spotify `/track/{id}`, Apple Music album/song links with song ID where possible, and YouTube/YouTube Music watch URLs or share links. Permit `title — artist` manual search even without links; unknown URL must be rejected with plain-language instructions rather than failing silently.
- Normalise/sanitise URLs; do not fetch arbitrary supplied URLs server-side (SSRF); use only allowlisted domains or trusted platform APIs, strict redirects, timeouts and response limits; remove tracking query parameters.
- Metadata adapters return `source`, `external_id`, `title`, `primary_artists`, `album`, `duration_ms`, `isrc` if available, artwork (optional), and match confidence. Obtain metadata through official authorised APIs where possible; beware API access limitations and rate limits. Fallback to manually entered title/artist/duration and admin verification; never claim cross-platform catalogue lookup is guaranteed for free.
- Pre-fill Salsa/Bachata/Cha-cha etc. from unambiguous _title_ cues, but **do not automatically infer the dance style from sound or catalogue genres**. Any track can be danced as Bachata even if musically Hip-hop or a film score; an explicit attendee-selected dance style is authoritative unless corrected before admission. Prefer style selection chips, default Salsa/Bachata, optional Cha-cha, Kizomba, Merengue, Other (admin enables styles before start).

### Duplicate identity

- Match exact platform ID first, exact ISRC when reliable, then normalised artist-title-duration fingerprints with conservative version tagging (remix/live/acoustic/radio edit), and explicit human review for borderline matches. ISRC can differ between releases of same audio, and shared titles can reference different recordings: do not blindly dedupe by title alone.
- Maintain event-level unique constraint for canonical recording key, transactional across concurrent requests. Duplicates return `Already queued as [Title]` and the first requester's position remains unchanged. No second-claimant quota consumed. When matching is uncertain, label `Possible duplicate — needs review`; default to no play until identity resolved so the same recording cannot inadvertently play twice.
- Reject re-entry of started/played or previously skipped recording for current event, even when that entry was removed from the future queue.

### Playback adapters

**Primary:** browser player using authorised locally selected files on the designated playback device; for a polished pilot, allow admin to import a folder/library and map metadata requests to local files. Because browser File System Access support differs by platform, provide `input type=file` multi-select and IndexedDB blob caching **only when suitable and with the content owner's permission**; require explicit re-selection if mobile browsers evict local storage. Avoid routing music files through Railway and avoid hosting/distributing copyrighted recordings. Record mapping availability per controller device; missing files remain queued but ineligible until mapped. IndexedDB is best-effort device storage, not authoritative session DB. For large collections, a laptop with reliable local files will be substantially easier than iOS; support phone-first control but clearly flag audio source limitations.

**Alternative:** legally permitted provider SDK integration as a later optional adapter under its terms, only if all subscription, platform, public-performance and API restrictions are satisfied. Never attempt to turn Spotify/Apple/YouTube URLs directly into downloadable audio or strip adverts. Community playback of commercial recordings may have additional venue/public-performance obligations, regardless of whether the audio file or subscription is lawfully acquired; get the society/venue's existing arrangements checked before deployment.

**Fallback:** If no authorised playable file exists, allow transparent `Manual playback / Mark started / Mark ended` mode with the track title and a link to the user's source. This _cannot promise ad-free automatic playback_. A manually started track counts for requester fairness, style cap and duplicate history. In manual mode, do not automatically mark played solely because a countdown reached zero.

### Browser/Bluetooth realities

- A first user tap is required to unlock audio on iOS/Android browsers; browsers can suspend background execution and Bluetooth audio routing may be controlled by the OS, not the PWA.
- A handover between devices cannot guarantee seamless mid-track playback or transfer a local file that exists only on the previous phone. Resume at the next unplayed track after recipient confirms media availability.
- Single device playing audio at once; enforce lease fencing and receiver acknowledgement, with old device stopping on transfer. Have a visible `Sound check` before live launch.

---

## 6. UX and accessibility

Design for dark-room use: dark charcoal surfaces (not pure black by necessity), warm restrained accent, high contrast, simple type, large controls, no autoplaying visual animations, no heavy artwork required. Include optional high-contrast/light mode. Use under-40 KB initial CSS/JS where feasible by code splitting; compress text responses, use system fonts and SVGs. Keep network payload lean; avoid large cover images and full-library downloads on attendee pages. Prefer server rendering/static assets with tiny hydrated controls if it reduces mobile work.

**Participant main page**: event name/status; prominent `Now Playing` tile; `My next song: ~2 songs / ~08:30`; `Add Song` large action; three style chips; link/title single input with paste affordance; submissions mini-list with `Withdraw` on eligible items; clear connection indicator. Do not show nicknames of other attendees by default. Provide accessible text alternatives to all status colours; grey overflow entries also labelled `After end time`.

**Admin mobile page**: now playing with pause/skip; next reserved track; visible genre/style run indicator, `Waiting for [reason]`/overflow count; moderation list with `Remove` + confirmation; explicit `Extend until [time]`; `Hand over admin` with one-time code; `Transfer player`; `End event`; immutable settings read-only. No control labelled `change rules` once event started.

**Join**: display public QR + short text event code/URL (QR not a dependency), accessible and copyable, never embed admin tokens in displayed QR. Use no intrusive cookie banners when unnecessary; provide concise privacy notice. Android and iPhone do not need installation to work.

**Unavailable states**: differentiate network offline, missing playback file, authorisation failure, duplicate entry, quota full, genre-fairness deadlock, session paused, event ended, and beyond scheduled time. Every message includes a practical next action.

---

## 7. Technical architecture

### Recommendation

A single TypeScript monorepo/application, React + Vite PWA front end, lean Node.js API (Fastify or equivalent), SQLite on a persistent Railway volume for pilot scale, built once into a single deployable service. Use SQLite WAL, one authoritative writer, prepared statements, foreign keys and `BEGIN IMMEDIATE` for concurrent changes. Do not add Redis, a separate paid database, background worker, object store, external analytics or real-time provider unless profiling proves necessary. Prefer one instance and one volume; multi-replica deployment must not occur with a single local SQLite writer. If Railway's selected plan/volume support or cost is unsuitable, use an external durable database explicitly costed before deployment; never depend on ephemeral container storage.

**Modules:** Web attendee UI; admin/player UI; HTTP JSON API; event-sourced-ish transactional domain services; pure scheduler; metadata adapters; playback interface; SQL persistence; SSE publisher/polling fallback; PWA offline shell; event snapshots and export/import.

**Domain principle:** Every command verifies event version and permission, then applies all state changes and audit rows in one SQLite transaction. The scheduler is deterministic and pure on a snapshot. Recompute a bounded preview whenever submissions/playback/moderation/breaks/end-time change, then broadcast only the resulting revision and minimal event state. Player receives immutable track reservation ID + fencing token. Client-side predictions are informative only.

**Deployment:** GitHub repository with Actions running formatting/typecheck/unit/property/integration/e2e checks; Railway linked to main branch for controlled release; production environment secrets; health check; a small attached persistent volume for SQLite. Keep media bytes off Railway. Add minimal structured logs without participant tokens or music API credentials. Build private staging locally/in an ephemeral environment where possible rather than paying for a second always-on service.

### Suggested repository layout

```
/apps/web/src/{attendee,admin,player,shared,offline}
/apps/server/src/{api,domain,scheduler,db,ingestion,playback,realtime,security}
/packages/contracts/src
/packages/scheduler/src
/tests/{unit,property,integration,e2e,fixtures}
/migrations
/docs/{requirements,adr,runbook,threat-model,privacy}
/.github/workflows/ci.yml
```

### Persistence schema (minimum)

- `events(id, public_slug, name, state, timezone, rules_json, rules_hash, created_at, started_at, ended_at, version, end_at_nullable)`
- `event_breaks(id, event_id, label, starts_at_nullable, ends_at_nullable, duration_sec, actual_start, actual_end)`
- `participants(id, event_id, token_hash, nickname_nullable, joined_at, last_seen_at, expires_at)`
- `tracks(id, canonical_recording_key, title, artist, duration_ms_nullable, isrc_nullable, version_tag, source_metadata_json, created_at)`
- `source_links(id, track_id, platform, platform_track_id_nullable, url, metadata_confidence)`
- `requests(id, event_id, participant_id, track_id, style, accepted_seq, state, submitted_at, removed_reason_nullable, started_at_nullable, finished_at_nullable)`
- `playback_history(id, event_id, request_id, requester_id, style, started_at, ended_at_nullable, outcome, playback_revision)`
- `admin_grants(id, event_id, secret_hash, grant_version, issued_at, revoked_at_nullable, expires_at)`
- `player_leases(id, event_id, controller_nonce_hash, fencing_epoch, claimed_at, heartbeat_at, expires_at)`
- `track_reservations(id, event_id, request_id, lease_epoch, reserved_at, expires_at, revision)`
- `event_audit(id, event_id, action, actor_role, at, payload_redacted_json, idempotency_key)`
- `event_recording_keys(event_id, canonical_recording_key, track_id, UNIQUE(event_id,canonical_recording_key))`
- `event_snapshot_exports(id, event_id, created_at, format_version, seed, catalogue_json)`

Indexes on `(event_id, state, accepted_seq)`, `(event_id, style, accepted_seq)`, uniqueness of `(event_id, token_hash)` and idempotency keys. Use schema migrations with checksums and automatic backup before destructive migration; cap audit data retention.

**Anonymous IDs:** session ID is a high-entropy random opaque token stored in browser local storage for event-scoped continuity. Store only hash server-side. If the browser storage is wiped or the attendee changes phone they become a new participant; offer an optional one-time transfer/recovery code but do not pretend this is Sybil-proof. Per-event quota can be bypassed by clearing storage, so add IP-based coarse rate limits, submission cooling period and admin moderation without collecting invasive identifiers. Avoid persistent device fingerprinting. Make public event IDs non-sensitive; admin URLs must be unguessable and never leaked into social preview/meta tags or logs.

---

## 8. API and security contracts

Indicative routes (implementation may refine names):

```
POST   /api/events                         create draft, receive admin secret once
POST   /api/events/:id/start               freeze rules; require admin capability
GET    /api/events/:slug/public            sanitised status / now-playing / preview
POST   /api/events/:id/join                issue guest identity
POST   /api/events/:id/requests            idempotent, rate-limited submit
GET    /api/events/:id/my-requests         requester capability required
DELETE /api/events/:id/requests/:rid       only owner, only before playback
POST   /api/events/:id/admin/remove/:rid   moderator removal
POST   /api/events/:id/admin/skip          mark started track skipped
POST   /api/events/:id/admin/pause         pause; retain history and reservation
POST   /api/events/:id/admin/resume        resume without changing rules
POST   /api/events/:id/admin/end-time      explicit new concrete end timestamp
POST   /api/events/:id/admin/handover      one-time recipient admin claim token
POST   /api/events/:id/admin/handover/claim
POST   /api/events/:id/player/claim        one-controller lease, fencing token
POST   /api/events/:id/player/heartbeat
POST   /api/events/:id/player/started      reservation + lease checks
POST   /api/events/:id/player/finished     idempotent completion
POST   /api/events/:id/player/release
POST   /api/events/:id/admin/end          end event terminally
GET    /api/events/:id/export              public sanitised catalogue snapshot
POST   /api/events/import                  new draft from historic snapshot
GET    /api/events/:id/stream              event revisions, SSE where possible
```

Enforce authentication/authorisation server-side, not via UI. Admin endpoints require a capability with scoped role, same-origin checks and CSRF protection appropriate to the chosen token transport; tokens never in query strings when avoidable (exchange one-time claim URL for HttpOnly SameSite secure cookie). Rate-limit event creation, links, search metadata and requests; protect metadata adapters against SSRF and request amplification. Strict HTML escaping and CSP; use parameterised queries. Admin handover is **two-phase**: old admin issues short-lived single-use offer; new accepts; transaction increments grant version/revokes old; notify existing clients and require recipient confirmation of player readiness separately. Race condition: if original admin goes offline immediately, the server must still own revocation. Recovery when all admins lose access: a separate encrypted owner-held recovery secret set at creation, not accessible to participants; destructive action audited.

Protect against: duplicate racing; quota races; stale playback devices; join-link amplification; accidental token leakage in referrers/screenshots; malicious catalogue URLs; excessive uploads; forged 'track ended'; browser clock manipulation; same-user multiple identities; event takeover; accidental public access to audio media. Export/delete functionality must respect retention rules.

---

## 9. Scheduler reference algorithm

The following is illustrative pseudocode; use pure functions plus model-based tests rather than implementing literally without tests.

```
function eligible(request, history, lastStyle, styleRun, rules, event):
  if request.state != QUEUED: return false
  if request.recordingKey in event.startedRecordingKeys: return false
  if request.ownerId == history.lastOwner: return false
  if lastStyle == request.style and styleRun >= rules.cap[request.style]: return false
  previousIndex = history.lastPlayIndexByOwner[request.ownerId]
  if previousIndex exists:
     if history.styleTransitionCounter <= history.transitionsAtPlay[previousIndex]:
        return false
  if !request.playableOnCurrentController: return false
  return true

function chooseNext(eventSnapshot, history, candidates):
  options = earliestEligiblePerStyle(candidates, history, eventSnapshot.rules)
  if options empty: return WAITING(reasonBreakdown(candidates, history))
  ordered = rankStylesFairly(options, eventSnapshot.rules, history)
  return options[ordered[0]]

function project(eventSnapshot, now):
  shadow = copyHistoryAndRuntimeState(eventSnapshot)
  remaining = eventSnapshot.requests.filter(unstarted)
  while remaining and steps < boundedLimit:
    next = chooseNext(shadow, remaining)
    if WAITING: return forecastWithWaitingReason()
    duration = validatedDuration(next)
    if endIsSet and (now + accumulatedSeconds + duration + buffers) > endAt:
       return projectedAndOverflow()
    appendForecast(next)
    applySimulatedPlayback(shadow, next)   // updates owner, style/run, transition counter
    remove(next, remaining)
  return forecast
```

**Important refinements:** `lastPlayIndexByOwner` must store the transition counter **at that user's last start**, not count future tentative tracks as played. On genre transition, increment the counter exactly once at the start of the new-style recording. Treat first track as no transition. If a user submitted two same-style songs, they can become eligible again only after at least one _actually played_ different-style track intervenes; even then their next song may be blocked by the style run cap. Bounded forecast needs cycle/stall detection; one-pass selection at a step should scan all styles for earliest eligible candidate and never loop indefinitely. For explicit end time, reserve before starting and recompute if the track duration is corrected. Every step must preserve pre-existing `RESERVED_NEXT` unless invalidated by a legitimate withdraw before start, admin removal or unavailable source.

### Worked scenarios to encode as tests

1. Three people A/B/C submit Salsa tracks, D/E submit Bachata. Example `A-S, B-S, D-B, E-B, C-S` is valid under defaults (assuming distinct recordings); check all users and genre caps.
2. A-only Salsa and B-only Bachata: alternate styles and owners, never A,A or B,B.
3. A-only Salsa submissions: first can play, then WAIT until another style and requester provides a transition.
4. A-S1, B-S2, C-B1, D-B2, A-S3: valid if A-S3 after style change; not necessarily forced 2:2 blocks when cap allows shorter.
5. Admin skips a future Salsa song: select another _eligible Salsa_ if possible and that style is still allowed by cap; if impossible, may select another eligible style rather than violating cap or requester-spacing. Skipping a song already playing counts as a played start, therefore slot/run/history advance and the next song is freshly selected. This distinction is essential to meet the user's stated skip intent without ever overriding fairness.
6. A queued request removed: its owner's active count drops immediately, it can be replaced, but previously played history is unaffected.
7. A requests same recording via Spotify and B via YouTube: B gets duplicate notice; song plays once; only A owns request.
8. Session paused mid-track, moved: started recording is consumed; receiver starts next unplayed; no duplicate replay.
9. Concrete 21:00 ending: 20:58 next 4-minute song cannot be started; show greyed/overflow; after admin extends until 21:10 recalculate and admit if eligible.
10. Session with no end time: no overflow designation.
11. Player loses connection during `started` acknowledgment: reconcile with reservation/lease and human check; do not automatically play same recording twice.
12. New event imported from old: old played history and guest identity omitted; no song auto-accepted into current night without admin selection.

---

## 10. Infrastructure and cost envelope

**Current verified Railway pricing context (October 2026):** Free tier shows $0 subscription and a $1 monthly usage credit after trial, with tight resource limits; Hobby lists a $5 minimum monthly spend that includes $5 usage. The amount depends on the account/plan and total resource use. Sources: https://railway.com/pricing and https://docs.railway.com/pricing/plans . **£1 incremental cost is a target, not a guaranteed monthly quote.** On an already paid Hobby account, the app can fit into existing unused usage credit, but the account still incurs its existing base fee; incremental utilisation could cost more if usage surpasses the included amount. Free tier has small compute/storage limits, so validate before treating it as reliable production hosting.

Cost-minimising measures: one small service, SQLite volume, no server-side streaming/binary music hosting, no background pollers or massive logging, API responses tiny, static assets cache-first, attendee polling less frequent when SSE disconnected, cost alerts, monthly measurement of RAM/CPU/network/volume. Never set auto-scale to >1 replica with SQLite volume. Backups are essential despite cost; export encrypted database snapshots to owner-controlled storage or download after events. Verify Railway volume backup and restore availability for the exact plan. If media is stored on attendee/player devices, app server bandwidth is predominantly text/state, not audio.

Estimate before launch by measuring: idle memory, CPU-seconds per queue recalculation, average SSE concurrent sockets, volume growth per 100 requests and metadata API calls, monthly billed usage from existing Railway account; project per four Friday events plus occasional smaller sessions. Maintain cost/runbook thresholds: warn at £0.50 forecast, halt optional metadata sync before £1 incremental forecast, but do not automatically shut down a live social and destroy usability.

---

## 11. Build plan: GitHub + Claude Code work packages

### Phase 0 — design contracts and feasibility gate

- Create repo, licence and non-affiliation notice, ADRs for queue semantics, anonymous identity, playback model and data retention; capture immutable defaults and change-policy. Verify legal playback approach and whether a reliable authorised library is available. Obtain Railway plan/volume details and budget baseline. Produce 12–20 representative test tracks (metadata and developer-authored or properly licensed test audio). **Gate:** playback files actually available on expected iOS/Android devices, otherwise pilot operates in transparent manual playback mode.

### Phase 1 — pure domain logic (do first)

- Define event/participant/request/recording/style types and state machines. Build pure `eligible`, `chooseNext`, `project`; freeze style caps and fairness. Use unit, property and fuzz tests with counterexamples and stable seeds; test the skip and pause/restart/transfer semantics. Define FIFO/ageing comparator and 'no next eligible' explanations. **Gate:** all hard invariants survive random 100k-sequence checks.

### Phase 2 — persistence and API

- SQLite migrations, transactional concurrent submit, idempotency, duplicate recording index, cap enforcement, anonymous join, frozen rules, future deletion/skip, audit and import/export. Signed admin capability handover; player lease fenced; integration tests with two concurrent browsers and process restart. **Gate:** no duplicate tracks or over-cap admission under concurrent mutations.

### Phase 3 — mobile UI and countdown

- Lightweight high-contrast PWA pages; QR + text code, attendee submission, style selection, next-song countdown, admin deck, downtime banners, end-time overflow; accessibility audit. Use synthetic timer and API clock offset. Reconnection recovery/poll fallback. **Gate:** complete attendee flow at throttled 2G/3G and keyboard/VoiceOver/TalkBack sanity checks.

### Phase 4 — permitted media adapter

- Media-library mapping and playback controller; user-gesture audio unlock, song-end confirmation, on-device file selection, missing-source handling, Bluetooth check, media leases and handover to second phone. Metadata ingestion adapters as optional enhancements (begin with paste/link parser and title/artist manual confirmation). **Gate:** 20 continuous tracks, phone handover, interrupted connectivity and browser-refresh recovery, with no repeat starts.

### Phase 5 — rehearsal, cost, operational readiness

- Run simulated 40-person 2-hour event; test 15–25 active requesters and live arrival patterns; dark-room UI trial; check logs/cost; verify SQLite backup and restore; check venue playback rights and admin runbook. Restrict feature changes and run a small non-official trial with willing friends before rolling out society-wide.

### Phase 6 — improvements only if pilot validates value

- Better metadata matching, playable library coverage, accessible projector view, richer multi-genre templates, safe optional notifications, historic session browser, optional curator suggestions; refrain from accounts/voting/business features without demonstrated demand.

**Definition of done for each work package:** code + migrations + tests + public API contract + at least one negative/security test + accessibility checks + docs + rollback instructions; do not merge untested scheduler changes merely because the UI appears to work.

---

## 12. Comprehensive validation matrix

**Functional:** submission cap exactly five accepted per event including played, replacement only after unstarted withdrawal/removal, concurrent multiple-tabs submission, withdrawal before/after reservation, duplicates across platforms, first-requester ownership, optional genres, title cue pre-selection override, date/time and timezone edge cases, past-pool import and shuffle reproducibility, public-read-only event link, late admin handover, end-time extension concrete timestamp, truly terminal ended events.

**Scheduler:** no owner adjacency, one intervening style transition for returning owner, genre run caps, chronological preference, no repeats, liveness when eligible candidate exists, deterministic result, forecast accuracy against actual history, wait reason correctness, skips before/after start, shortage of one genre, no hard end time, insufficient remaining time, unknown song durations, paused countdown, deadlines in British Summer Time changes.

**Concurrency:** two simultaneous participants request same recording; one participant submits six at once; stale admin attempts changes post-handover; player A starts after B takes lease; network retries finish event twice; duplicate start/finish callbacks; process crashes between transaction and push; SSE reconnect with revision gap; browser clocks skewed; DB lock contention and WAL checkpoint.

**Devices/network:** iPhone Safari normal/private tab, Android Chrome/Firefox, older low-power phone, reduced-motion and high-contrast modes, throttled 2G/3G, LTE loss and reconnect, captive Wi-Fi portal, page refresh, mobile OS suspends browser, switch to lounge and pair new Bluetooth speaker, offline shell read-only with queued actions clearly _not accepted_ until server confirms.

**Security/privacy:** XSS in song titles/nicknames; SSRF URLs; SQL injection; bruteforce admin URLs; public QR cannot retrieve admin details; admin handover token replay; guest token theft/cross-origin request; no unnecessary personal data in logs; GDPR deletion and retention; no analytics cookies; download/import sanitisation; data/DB recovery.

**Usability:** 5-second guest onboarding on good connection; first song request with three or fewer fields; 44px controls; legible at arm's length in a dark studio; elapsed current song and countdown accuracy; explicit disabled/reason; no ambiguous `greyed out` with no label; share QR and code legibility; clear warnings about locally missing songs.

---

## 13. Privacy, legal and practical policies

Because the app is independently built, do not use LSU marks or describe it as an official society service without permission. A short privacy statement must state: anonymous event identifiers and optional nicknames, purpose of fairness/session functioning, retention interval, where service is hosted, how to request deletion and any external metadata queries. Recommend 30 days of pseudonymous operational records after event end, then delete guest token hashes/nicknames and retain only an anonymised historical song snapshot; retain audit records only as long as reasonably necessary. The exact UK GDPR applicability and controller responsibilities depend on actual use; do not claim no personal data merely because there are no formal accounts. Ensure licences for music playback, and check venue/university public-performance arrangements rather than assuming a personal audio purchase covers all uses. No copyrighted music files should be redistributed via public web endpoints by default.

---

## 14. Risks, mitigations and explicit decisions

| Risk / unresolved issue                                                          | Implemented response                                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Bare Spotify/Apple/YT URLs cannot guarantee ad-free sound                        | Discovery only; audio from separately authorised and available recordings, clear manual fallback                                         |
| iOS/Android browser cannot universally retain arbitrary local music directories  | File picker/mapping with availability checks; test target devices; prefer laptop if continuous playback proves unreliable                |
| User's illustrative `s1,s2,b1,b2` may contradict strict user anti-clustering     | Hard ownership constraint prevails; examples must include requester identities                                                           |
| Several styles with configurable maximum streaks is not strict ratio enforcement | Treat supplied 2:2 as _maximum consecutive per style_ exactly as clarified                                                               |
| Admin's right to skip vs not to change rules                                     | Admin may remove/skip; scheduler alone determines next eligible track and preserves caps                                                 |
| 'Five songs per user session' could mean five lifetime accepted or five waiting  | Choose five accepted per event, including already played, with replacements only for unstarted withdrawn/rejected songs; explain clearly |
| Default FIFO may starve a genre                                                  | Deterministic cross-style ageing/tie-breaking without compromising hard constraints                                                      |
| Unknown metadata duration makes countdown inaccurate                             | Show approximate/unknown until confirmed; do not mislabel certainty                                                                      |
| New guests evade five-request limit by clearing storage                          | Accept pragmatic event-scale anonymity, apply coarse rate limits/moderation; no intrusive fingerprinting                                 |
| £1 cost target may not be feasible as whole Railway bill                         | Track incremental usage separate from plan base charge; optional $0 Free tier if eligible and enough resources                           |
| Lack of music library turns automatic playback into manual control               | Media availability is an explicit launch gate, never falsely claim full auto                                                             |
| Public historical playlist privacy                                               | Public track-only archive with stripped attendee identifiers                                                                             |

---

## 15. Operational runbook

**Before:** admin creates draft, defines styles and cap, optional end-time/breaks, reviews local media mapping, tests Bluetooth and plays a sample, starts event to freeze rules, displays QR/public short code, keeps admin recovery token private. Confirm at least a few suitable tracks across styles and owners or automatic scheduler will properly pause on fairness deadlock.

**During:** attendees submit via QR, receive acceptance/duplicate and cap notices; admin handles unsuitable songs; scheduler selects earliest eligible tracks; admin sees warnings for insufficient genre diversity, unavailable media and end-time overflow. When a track is skipped after starting, preserve its historical genre/requester effects. Announcements or student routine: pause, then resume. Do not force a silent override in a deadlock.

**Handover:** old admin generates one-time claim, recipient accepts and confirms; previous credential revoked; if transferring music, player lease changes separately; old playback stops; new admin verifies next unplayed track and taps `Start`. For lounge, transfer playback after pairing the new Bluetooth speaker; current track does not resume mid-track.

**End:** admin ends the event, preserve song-only archive, report unplayed recommendations, optionally export snapshot/backup. Next Friday start a **new** event, preview/import carry-over selections by choice, independently shuffle historical genre pools only when generating that new event, and retain all strict rules.

**Incident response:** if internet disappears, player can finish already buffered/local track, but server changes are not accepted until reconnection; UI shows stale state. If player crashes, pause/claim lease and reconcile started status; never auto-restart possibly played recording. If Railway fails, use a recent admin-held exported pool and manual speaker fallback. If data corruption, stop writes, restore last verified backup, document any lost requests. If all admin tokens lost, use pre-issued owner recovery secret, not an unsecured backdoor.

---

## 16. Claude Code implementation handoff prompt

> Act as principal full-stack engineer, deterministic scheduling specialist, adversarial QA engineer and accessibility reviewer. Build the LSU Salsa Society independent student pilot exactly from this specification. First inventory the repository, dependencies, Railway deployment configuration and tests; write a requirements traceability matrix and ADRs before implementation. Enforce immutable event rules, a five-accepted-songs-per-event cap that frees slots only when unstarted requests are withdrawn or removed, no same-user adjacent playback, at least one actual style transition before a user's next playback, frozen per-style maximum streaks rather than mandatory 2:2 blocks, canonical song deduplication, server-authoritative audit/transactions, cross-device player lease fencing, and privacy-minimal anonymous sessions. The app must distinguish music metadata discovery from lawfully authorised playable audio; do not circumvent ads, DRM or provider restrictions. Implement in incremental phases with passing tests and reusable pure functions, confirm source-file feasibility on iOS/Android, use GitHub CI and one low-cost Railway service with persistent SQLite, and produce a reproducible end-to-end rehearsal with simulated 25 submitters, handover, breaks, forecast overflow and reconnect. Where requirements conflict, favour explicit hard invariants; document ambiguities rather than silently weakening them. Do not declare release-ready until the acceptance and security matrices pass.

---

## 17. Source references verified 29 October 2026

- Spotify Developer Policy, streaming Premium requirement and developer restrictions: https://developer.spotify.com/policy
- Spotify compliance guidance, personal-use/business restrictions and SDK caveats: https://developer.spotify.com/compliance-tips
- Apple Music MusicKit capabilities, subscription authorisation and web playback: https://developer.apple.com/musickit/
- YouTube API Developer Policies (no removing ads or extracting audio): https://developers.google.com/youtube/terms/developer-policies-guide
- Railway pricing and plan allowances: https://railway.com/pricing and https://docs.railway.com/pricing/plans

**Final implementation principle:** When there is no permissible next song, the system should openly wait rather than fake compliance. Reliable, comprehensible fairness matters more than uninterrupted playback at any cost.
