# Qroove — Progress Tracker

Update at the end of every phase (see `plan/EXECUTION_PLAN.md` §5).

**Current phase:** — (all phases done; Phase 17 radio fallback added 2026-11-05)
**Next session starts with:** Pilot follow-up: the user-side items under "Blocked / needs user", then the pilot validation questions below. Phases 0–10 done, plus Phases 11–12 (pilot feedback); v0.3.0 tagged.

## Phases

- [x] 0 — Accounts, MCP & infra provisioning
- [x] 1 — Monorepo scaffold, branding, docs skeleton, CI
- [x] 2 — Contracts + scheduler
- [x] 3 — Persistence ports, adapters, domain commands
- [x] 4 — HTTP API, auth, realtime, metadata
- [x] 5 — Attendee UI
- [x] 6 — Admin UI
- [x] 7 — Player
- [x] 8 — Hardening, e2e, a11y, perf
- [x] 9 — Deploy (Railway + Cloudflare + Firestore)
- [x] 10 — Release 0.1.0 + transfer readiness

## Decisions made (during planning, 2026-10-29)

- Firestore (new Firebase project, Spark tier) replaces SQLite from SPEC §7.
- Docs: VitePress served by the app at `/docs`.
- Metadata: Spotify Web API (keys supplied by user) + keyless oEmbed/iTunes fallbacks.
- Domain: `qroove.sataklela.com` via Cloudflare. Branded as a Sataklela OÜ CSR initiative.
- Licence AGPL-3.0 (copyleft). Repo may move to a company org → brand/repo URL centralised in `packages/config`.

## Blocked / needs user

- Connect the GitHub repo to the Railway service (Settings → Source; needs the Railway GitHub app authorised) for auto-deploy on `main`. Until then deploy with `railway up --ci --service web`.
- Two-phone smoke test (checklist in `docs/src/runbook/deploy.md`).

## Notes per phase

### Phase 0 (2026-10-29)

- Firebase project `qroove-sataklela` (Spark), Firestore `(default)` in `eur3`, rules deny-all + indexes deployed.
- Firestore TTL needs billing → idempotency cleanup moved to purge job.
- Service account `qroove-server@qroove-sataklela.iam.gserviceaccount.com` (roles/datastore.user); key at `.secrets/firebase-sa.json` (gitignored).
- Railway: workspace "Raunak's Projects", project `qroove` (0b641c46-8212-47d0-855e-2c9d5c0c64bb), env `production` (98c294ea-68d2-496e-8ad9-bca1cccf1c68), service `web` (64552298-e13d-4699-b3df-913c5b4ca77a), repo linked locally via `railway link`. Variables set (no deploy yet): NODE_ENV, PUBLIC_BASE_URL, REPO_DRIVER=firestore, FIREBASE_PROJECT_ID, FIREBASE_SERVICE_ACCOUNT_B64, COOKIE_SECRET, CRON_SECRET, SPOTIFY_CLIENT_ID.
- Spotify redirect URI registered: `https://qroove.sataklela.com/api/spotify/callback` → reserve `/api/spotify/*`.
- Cloudflare MCP authenticated (Phase 9 DNS).

### Phase 1 (2026-10-29)

- Monorepo scaffolded: pnpm 10.34.9 (via corepack), TS 5.9 strict, ESLint 9, Prettier, Vitest 4. Local default pnpm was v12; `packageManager` pins 10.
- Server bundled with tsup (`noExternal: @qroove/*`) because workspace packages are source-only `.ts`. Docker image builds and serves `/api/health`, `/docs/`, `/` (verified).
- Versions chosen as newest >14 days old: `@vitejs/plugin-react` 5.2.0 (6.x needs Vite 8; plan says Vite 7); TypeScript 5.9.3 (7.x skipped, new native port).
- VitePress config imports `packages/config/src/brand` by relative path (VitePress config loader can't resolve the workspace `.ts` package). Docs theme adds the shared footer via `layout-bottom`.
- CSP: `/docs` gets `script-src 'self' 'unsafe-inline'` (VitePress inline bootstrap scripts); everything else stays `'self'`. Covered by a test.
- Mermaid is a plain fenced block for now (no plugin); revisit if diagrams need rendering.
- Brand art added post-phase: `brand/` holds logo + avatar; `pnpm icons` generates PNG icons, maskable, Apple touch, OG images (replaces the placeholder SVG icons).

### Phase 2 (2026-10-29)

- `packages/scheduler` is dependency-free: `StyleId` is an opaque string there; contracts' `RulesSnapshot` has a partial `runCaps`, so Phase 3 must adapt it to `SchedulerRules` (fill missing caps / use `FALLBACK_RUN_CAP`).
- Scheduler `HistoryState.playedKeys` is a `Set`; the Firestore `EventDoc` stores an array — convert at the adapter boundary.
- Overflow is decided by an eligibility check (`WOULD_EXCEED_END`, `remainingMs`), so a shorter later song may still fit; overflow items are appended after playable ones with `predictedStartMs: null`.
- `OVERFLOW` is included in quota-counting states (SPEC §3.3); the plan's list omitted it.
- Property test: 2,000 runs in `pnpm test`; `pnpm --filter @qroove/scheduler test:property` = 100,000 runs (passes).
- `z.partialRecord` is required for non-exhaustive enum-keyed records in zod 4.

### Phase 3 (2026-10-29)

- `apps/server/src/db/{ports,types}.ts`, `memory/`, `firestore/`; `createRepository(env)` lazy-loads Firestore. Domain commands in `src/domain/commands/`, shared plumbing in `context.ts` (`runCommand`, `Work`, `commit`) and `recompute.ts`.
- Tests: `test/repo.contract.ts` and `test/commands.suite.ts` run against memory (`pnpm test`) and the Firestore emulator (`pnpm --filter @qroove/server test:emulator`; needs Java; wired into CI). 39 tests each, all passing, including the 6-concurrent-submit, concurrent-duplicate, stale-admin and stale-epoch cases.
- Plan deviations: times stored as plain epoch-ms numbers (no Timestamp converters); `RequestDoc.ownerId` replaces `participantId` (indexes file updated; request lists are sorted in the adapter, so the composite indexes are not actually used); `putEvent(doc, {silent})` for heartbeats; added `EventDoc.{playbackSeq,leaseEpoch,transferOfferId,importSeed}`; `putPlayback`/`getPlayback` instead of `appendPlayback`. `subscribe` passes the raw event doc; the LRU public-view cache is deferred to Phase 4, where the view is built.
- Decisions: claiming the player requires an admin secret (a separate player credential can come later); a lease claim or handover treats any track still playing as consumed; handover claim leaves the event PAUSED so the receiver must resume; only one handover offer is live at a time and resuming cancels it; a recovery secret can replace all admin access (`recoverAdmin`); `startBreak` holds new starts until `endBreak`; submissions are accepted while PAUSED but not reserved until resume; a duplicate is refused before quota is checked.
- Phase 4 must: build `RequestView`/`EventPublicView` from `getEventPublic`, add `parseLink`/`canonicalKey` and call `resolveMetadata` for `PENDING_METADATA`, set `Idempotency-Key` through `idempotencyKey`, and skip SSE pushes for silent (heartbeat) writes.
- Not covered: a player-side "media unavailable before start" command (reserved track that cannot play); the admin can remove it.

### Phase 4 (2026-10-29)

- `apps/server/src/{api,ingestion,security,realtime}`; `buildApp(env, {repo, clock, fetch})` takes overrides for tests. 64 new tests (API via `inject`, SSE over a real port, ingestion with a mocked network). Emulator suite still 39/39.
- Plan deviations: no `fastify-type-provider-zod` (zod 4 compatibility risk) — a small `parse(schema, data)` helper does the same; no `@fastify/rate-limit` or `@fastify/cookie` — an in-process sliding-window limiter and a tiny cookie parser (prod runs one instance, so per-process limits are exact); SSE pushes the full public view on each change instead of a ≤4 KB revision message (queue capped at 50); `EventPublicView` kept from Phase 2 and gained `runIndicator`.
- Auth transport: participant `Authorization: Bearer <participantId>:<token>`; admin cookie `qa_<id>` holds the raw secret (HttpOnly), CSRF = HMAC(`COOKIE_SECRET`, secret) echoed in header and `qc_<id>` cookie. Without `COOKIE_SECRET` a random per-process key is used (sessions' CSRF tokens then reset on restart; prod sets it).
- Duplicates: `RequestDoc` gained `keys`, `looseKey`, `possibleDuplicate`. Certain duplicate = any of ISRC / platform id / exact fingerprint already locked (fingerprint hits where both durations are known and differ >5 s are treated as uncertain). Uncertain (loose-key hit, i.e. same artist+title with another version tag) = request held as `PENDING_METADATA` + `possibleDuplicate`, never reserved until an admin approves or rejects (`admin/duplicate/:rid`). A held request never takes over another request's key locks; withdraw/reserve/start only touch locks it owns.
- Spotify oEmbed has no artist, so a Spotify link without API keys has no artist and its fingerprint only matches manual entries with an empty artist. With keys (ISRC, artist) matching is much better — set `SPOTIFY_CLIENT_SECRET` in Railway before the pilot.
- Added routes beyond the plan list: `admin/draft` (PATCH), `admin/archive`, `admin/recover`, `admin/duplicate/:rid`, export/import.
- Not done / for later: purge job and retention (Phase 8); `statusText` copy and `RATE_LIMITED` retry-after hints are plain; SSE client reconnect + polling fallback is Phase 5; Firestore read cost per change grows with request count (fine at pilot size).

### Phase 5 (2026-10-29)

- `apps/web/src/{attendee,shared,landing}`; web imports only **types** from `@qroove/contracts` (error copy comes from the API's own `error.message/action`, so zod is not bundled). `hashRules` moved to `@qroove/contracts/hash` (needs `node:crypto`).
- Tests: 15 new (countdown/pluralisation/duration parsing, `nextSong` states, EventPage flows with a stubbed fetch). Screenshots in `docs/src/public/screens/` were taken with Playwright (chromium + system libs installed in the codespace; the scripts are not committed — Phase 8 adds the real e2e setup).
- **Bundle size:** attendee route initial load is ~79 KB gzip JS (react-dom ≈ 45, react-router ≈ 20, app ≈ 15) + 1.8 KB CSS, so the 40 KB target is **not met**. Only the placeholder `/create` route is code-split so far; Phase 6/7 must lazy-load admin and player. Cheapest future saving: replace react-router with a ~1 KB router (≈ −20 KB). Re-measure with `ANALYZE=1 pnpm exec vite build`.
- Decisions: joining is an explicit one-tap card (so a nickname can be set) instead of an automatic join; "songs until" counts the playing song plus songs ahead in the preview; `/create` is a placeholder until Phase 6; the queue never shows nicknames' owners beyond what the API sends — the UI ignores `ownerNickname` entirely.
- Not done: QR code for the join link (admin screen, Phase 6); service-worker offline shell is whatever vite-plugin-pwa generates (no runtime caching of API).

### Phase 6 (2026-10-29)

- `apps/web/src/admin/*`, `shared/widgets.tsx` (ConfirmButton, CopyButton, QrCode). QR uses `qrcode-generator` 2.0.4 (tiny, no deps) rendered as one SVG path, instead of `qrcode`. 10 new web tests; server +1 (carry-over/CSRF).
- Routes: `/new` (plan said `/new`; landing links there), `/a/:id#k=`, `/claim/:id#c=` (shared `AdminEntry`), `/admin/:id`, `/h/:slug`. Handover code lives in the fragment; both entries replace the history entry before navigating so secrets leave the address bar.
- CSRF: the CSRF cookie is scoped to `/api/events/<id>`, so page JS cannot read it; `GET /admin/state` returns the token and commands send it as `X-Qroove-CSRF`. The token is not in the SSE stream.
- Decisions: confirmation is an inline two-step button (no modal dialogs); templates set name/end time only ("Dance break N min" ends N min after pressing it, so start soon after); Skip needs confirmation but Pause does not; "Transfer player" is a status panel + link to `/player/:id` — the player itself is Phase 7, and a takeover claim already fences the old device; the created panel shows the recovery secret inside a `<details>`.
- Bug caught by tests: number inputs that clamped on every keystroke turned "4" into "14"; they now keep raw text and clamp on submit.
- Bundle: attendee initial JS ≈ 80 KB gz (+0.6 KB vs Phase 5); AdminPage 4.6 KB, CreateEvent 10.4 KB (includes the shared widgets + QR), others <1 KB, all lazy.
- Not done: editing a DRAFT after creation from the UI (the `PATCH admin/draft` API exists; the form is create-only); admin page does not show participants' counts; pre-start seed removal for imported events is possible via Remove once started, not in DRAFT view since DRAFT has no moderation-specific tools beyond Remove.

### Phase 7 (2026-10-29)

- `apps/web/src/player/*` (lazy route `/player/:eventId`, 5.4 KB gz + `music-metadata` 12.2.1 as a separate on-demand chunk; attendee initial JS unchanged at ≈ 80 KB gz). `norm`/fingerprint moved to `@qroove/contracts/normalise` (server `domain/keys.ts` re-exports). `AdminRequestView.sourceUrl` added. 9 new web tests (matching, lease/start/finish flow, manual mode, stale lease).
- Player uses the admin state stream (needs the admin cookie and CSRF for `claim` only); the reserved song is the request in `RESERVED_NEXT`. Lease creds live in memory + `sessionStorage` (reload resumes via heartbeat).
- Decisions: Start is blocked until lease held + sound check done; auto-advance only after one successful user-initiated `play()`; a refused autoplay drops back to the Start button; audio load error before start → manual mode, after start → `FAILED` (counts as skipped); release/takeover leaves any playing track to the server's claim rule (closed as played); exact match = same fingerprint, title-only match is allowed when either artist is missing and is labelled "probable"; the per-request file choice is local only (no availability reported to the server).
- Not done: availability per request sent to the server (SPEC §5 "mapping availability"; MVP shows it locally only); `pagehide` release (reload must keep the lease); real-browser audio is untested in CI (jsdom stubs) — Phase 8 e2e should cover it with a generated WAV and Chromium's fake audio; the server has no "media unavailable before start" command.

### Phase 8 (2026-10-29)

- Retention: `Repository.purge(cutoffs)` (memory + Firestore, contract-tested on both) and `maintenance/purge.ts` (policy constants, 6 h timer started from `main.ts` only, `POST /api/internal/purge` with `x-cron-secret`; 404 without `CRON_SECRET`). Participants' docs are deleted but requests keep their pseudonymous `ownerId`; admin grants are kept so an organiser can still carry over after 30 days.
- Import UI: `/import` (paste/upload) and a shared `ImportPicker` also used by carry-over. Export UI: "Download as JSON" on `/h/:slug`.
- E2E: `playwright.config.ts`, `tests/e2e/{flow,theme}.spec.ts` (Playwright 1.64.1, axe-core/playwright 4.13.0; 4.14.0 is under 14 days old). Runs against the built server (`pnpm build` first) with memory repo on port 3100; `RATE_LIMIT_OFF=1` (ignored in production). Pixel 8 Chromium runs; iPhone 15 WebKit is opt-in (`E2E_WEBKIT=1`, needs `playwright install webkit`) and was **not run** here. Browsers: `pnpm exec playwright install chromium`.
- A11y: one real violation found and fixed (opacity-faded rows failed contrast). Axe checks cover `/`, `/new`, `/import`, `/privacy`, `/e/:slug`, `/admin/:id` (draft and ended), `/player/:id`, `/h/:slug`; light theme on the public pages only.
- Load (`pnpm load`, contributors staggered over 3 s with 0.3–1.5 s think time): memory p50 6 ms / p95 13 ms; Firestore emulator p50 0.9 s / p95 1.4 s (budget 2 s). Finding: unqueued transactions on one event aborted each other (p95 > 50 s); the Firestore adapter now queues per event in-process, bounding throughput to roughly 13 mutations/s per event on the emulator (a fully simultaneous 25-person burst still reaches p95 ≈ 2.2 s).
- Also fixed: the SSE bus never released Firestore listeners on close (client refused to terminate); SIGTERM/SIGINT handlers added.
- CI: separate `integration-emulator` and `e2e` jobs. Not verified on GitHub yet (first run happens on push).
- Not done: webkit e2e run; real-audio e2e for the player (manual mode only); e2e on a second mobile viewport beyond Pixel 8; multi-instance behaviour is untested.

### Phase 9 (2026-10-29)

- Deployed with `railway up` (Dockerfile build). Railway domain `web-production-a1be78.up.railway.app`; custom domain `https://qroove.sataklela.com`. Verified: `/api/health`, `/`, `/docs/`, `/docs/changelog`, admin session cookies on the custom domain are `HttpOnly; Secure; SameSite=Strict`, a foreign `Origin` is refused (401). The start-up purge logged against production Firestore, confirming credentials work.
- Cloudflare (via MCP): `CNAME qroove → jy6odhax.up.railway.app` (DNS only) and TXT `_railway-verify.qroove`. The TXT was missing at first, so the certificate sat at "validating ownership" for about 15 minutes serving `*.up.railway.app`; Railway's CLI does not print the TXT (use `domain-status`). Documented in the DNS runbook.
- Proxy (orange cloud) intentionally left off; SSE through Cloudflare is untested.
- A throwaway DRAFT event ("Smoke") was created in production for the cookie check; the purge deletes it after 7 days.
- Not done: GitHub auto-deploy, phone smoke test (both need the user); `commit` is null in `/api/health` because `railway up` does not set `RAILWAY_GIT_COMMIT_SHA`.

### Phase 10 (2026-10-29)

- Released **0.1.0** (all package versions and `VERSION` bumped, changelog cut, tag `v0.1.0`). Added `CONTRIBUTING.md` (DCO), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, reports go to the contact details on sataklela.com rather than a personal email), README badges (relative links so no owner name is hard-coded), screenshot, live/docs links and CSR statement. `runbook/transfer-ownership.md` written. `grep -ri raunak` now matches only `BRAND.repoUrl` and the plan files (history).
- No "Documented in Phase" placeholders remain in `docs/src`.

## Summary

Qroove 0.1.0 is live at https://qroove.sataklela.com: fair queue scheduler, attendee PWA with live queue and countdown, organiser UI with QR, handover, carry-over, import/export, a local-file player with manual mode, Firestore persistence, retention purge, e2e and axe checks, runbooks.

## Known limitations

- Player: audio tested only via jsdom and manual-mode e2e, never with real files on iOS or Android; WebKit e2e not run; file availability is not reported to the server; no "media unavailable before start" command.
- Auto-deploy from GitHub is not connected (deploy with `railway up`); `/api/health` shows `commit: null` for that reason.
- Cloudflare proxy is off; SSE through it is untested. Throughput is serialised per event (~13 mutations/s on the emulator); multi-instance behaviour is untested.
- Attendee initial JS is ≈ 80 KB gzip (target was 40 KB); the cheapest saving is replacing react-router.
- A Spotify link without API keys has no artist; the keys are set in production, but real-world matching quality is unverified.
- Draft events cannot be edited from the UI after creation (the API exists).
- No analytics or error reporting beyond Railway logs.

## Pilot validation questions

1. Quota (SPEC §3.3): is "five accepted songs per person per event, played ones included" what dancers expect, or do they want "five waiting at once"? The latter is a different, versioned rule.
2. Is the style run cap (default 2) and the minimum style change right for the room, and do organisers need to override it?
3. Do guests understand "up next" and the countdown, and does the "uncertain" estimate mislead anyone?
4. Do organisers prefer local-file playback or manual mode, and which devices and Bluetooth setups actually work?
5. Is the 30-day retention and anonymous nickname model acceptable to the society and its members?
6. Does the venue/society have the public-performance licences needed for the music played?

### Phase 11 — pilot feedback (2026-10-29, v0.2.0)

- Done as planned in `/home/codespace/.claude/plans/flickering-wiggling-map.md` (genre groups + ratios, planned-time timer, break windows, QR-secret join, landing code boxes, one-screen organiser console, two-tap end, right-click lock, header logo/menu), plus the follow-up request: **playlist import** replaces the JSON import (`ingestion/playlist.ts`).
- Decisions (ADRs 0007–0010): scheduler "style" = genre; ratio parts 1–5 with a 1-in-10 floor; single-genre spacing = wait for half of the others' waiting songs (snapshotted at the owner's play, as canonical keys); breaks centred on even points of the plan, ≤ half of it, ≥ 20 min of music around each, max 3, set before start; organiser starts/ends breaks manually; join key stored on the event doc and carried in the QR fragment; room code can view the queue but not join.
- Logo is top-left (home link) because the brief also put the rules menu top-right; confirmed with the user.
- Playlist import is **scraping of public pages**, not an API: Spotify embed page (`__NEXT_DATA__`, ~50 tracks), Apple Music page (`serialized-server-data`, ~50 tracks), YouTube playlist page (`ytInitialData`, ~100 videos; YouTube Music links map to the same playlist id; titles are cleaned and the channel is used as artist). Verified against live pages from the dev sandbox on 2026-10-29, covered by fixture tests only, and likely to break when those sites change; long playlists are truncated to what the page shows. A public "Spotify playlist" via API keys was not used (the embed needs none). Hosts added to the SSRF allowlist: `music.apple.com`. Songs get one organiser-chosen style, so imported songs are always one style.
- Rules snapshot is v2 and prod's earlier throw-away "Smoke" draft (v1 rules) is unreadable; the purge deletes it after 7 days.
- YouTube needs the `SOCS=CAI` consent cookie or EU-hosted servers get a consent redirect (found only after deploying; Spotify, Apple and YouTube imports were then verified on production, 17/17/13 songs for a 60-minute plan).
- Not done: automatic break timer; rotating the join key; "Lock this device" / idle auto-lock for organiser sessions (right-click lock is cosmetic only); editing a draft's settings after creation; iPhone/WebKit e2e; playlist import for YouTube/Apple beyond the first page of tracks.
- Tests: scheduler 27 (+property), contracts 10, server 125 (+emulator 46), web 45, e2e 3 (flow, 360×640 no-scroll, light theme) incl. axe.

### Phase 12 — wheel pickers, timeline, colours, segments, names, playlists (2026-10-29, v0.3.0)

- Plan: `/home/codespace/.claude/plans/flickering-wiggling-map.md`. ADRs 0011–0014. Rules snapshot v3 (segments), `BreakSpec.startMin`, planned time in quarter hours, `Candidate.variant` + `SchedulerRules.allowedVariants`, `projectQueue({ruleWindows})`.
- Mid-turn requests folded in: generated event names (no typed name at all, to avoid offensive text) with a persistent ledger (`meta/eventNames`, `Repository.updateNameLedger`), and playlists per style with genre coverage (`playlistCoverageProblem`, `interleave`).
- Wheel picker: the scroll-snap element is itself the `spinbutton` (needed for axe `scrollable-region-focusable`); commits 90 ms after scrolling stops; arrow keys work. Verified in jsdom and Chromium; real touch inertia on iOS/Android is untested.
- Timeline: tap adds a break at the nearest legal 10-minute spot within an hour (shake if none); thin breaks stay tappable because the handles reach outward. Removal is one tap on ✕ (the plan said two taps; it is a draft setting). The part-selector row sits under the bar because tapping the bar itself adds breaks.
- Names: 112 words (28 each of fruit, vegetables, carbs, sea creatures), about 1.4 M ordered triples. Names are claimed at creation, so unused suggestions are never burned. The ledger keeps every used triple in one document (about 100 k events before the 1 MB limit); fine for a pilot, revisit before wide use. Attendee nicknames are still free text.
- Not done: segment-specific rules in the attendee style picker (it offers every style allowed anywhere; the server accepts it and the song waits for its part); WebKit e2e; editing a draft after creation.
- Tests: scheduler 32 (+2 property incl. segments), contracts 11, server 140 (+emulator), web 63, e2e 4 incl. axe.

### Phase 13 — room code, sortable playlists (2026-10-30)

- Superseded the QR-only join (ADR 0008 → ADR 0015): the permanent 6-character room code (shown `ABC-123`) joins on its own; QR is the backup; join key removed from the model and API.
- Playlist import is now interactive for everyone (ADR 0016): `shared/SongList.tsx` (drag by grip, swipe left to remove with a red bin, swipe right to send to top with a green arrow, hidden keyboard buttons, greyed rows past the allowance), `shared/PlaylistInput.tsx` + `usePlaylist` (debounced load of a pasted link), `attendee/AddPlaylist.tsx` (batch add, one style), and the create page (songs from per-style links, interleaved, greyed beyond planned time minus one minute; create sends `songs`).
- Server: `POST /api/resolve-playlist`, `POST /api/events/:id/requests/batch`, `CreateEventBody.songs` (replaces `playlists`), `safeSourceUrl`, `songCoverageProblem`.
- Verified in Chromium with real pointer events (e2e `playlist.spec.ts`), not on a touch device: swipe thresholds (35% of the row), the 8 px sideways slop before a touch becomes a swipe, and iOS rubber-banding are untested. Drag uses a fixed 60 px row height.
- Not done: per-song style for guests (one style per batch); a batch that crosses a quota moment mid-way reports the rest as QUOTA_FULL; drag auto-scroll when the list is taller than the screen.
- Tests: scheduler 32, contracts 11, server 141, web 81, e2e 5.

### Phase 14 — pilot flow fixes (2026-10-30)

- ADR 0017: required name, link-only "Add music" card (`attendee/AddMusic.tsx` replaces `AddSong` and `AddPlaylist`), top-level genre with removal advice, official Spotify/YouTube players on the player page (`player/embed.ts`), green dot in the header.
- The paste bug was `useLockedPage` blocking the context menu everywhere, including in fields.
- Spotify's iframe API script uses `eval`, blocked by the CSP, so `embed.ts` speaks its unpublished postMessage protocol directly. Expect this to need attention if Spotify changes it.
- Verified live from the sandbox: song and playlist lookup for Spotify and YouTube Music. Spotify embed loads, starts and is correctly refused as a preview (headless, not signed in).
- **Not verified:** full-length Spotify playback signed in to Premium, whether third-party cookie blocking stops that session reaching the embed, and any YouTube playback (every video gave error 150 from this sandbox's browser, even Big Buck Bunny, on any origin). Test on the real player device before relying on them.
- Not done: docs screenshots `attendee-join.png` and `attendee-add.png` are stale; guests cannot pick a non-Latin variant any more; provider terms for use at events are unchecked.
- ADR 0018 (genres only): removed all owner-based eligibility after the live test stalled. Also applies to running events. Open: the queue still stops when only a capped genre has songs waiting; the iPhone guest's "top 5" report is unexplained.
- Playback moved into the organiser console (`player/PlayerConsole.tsx`), auto-claiming with takeover; `/player/:id` redirects. A second organiser tab or device takes the role from the first.
- ADR 0019: Web Playback SDK (`player/spotifySdk.ts`, `api/spotifyAuth.ts`). Not verified against a real Premium account or on a phone.
- ADR 0020: search, guest playlists, limits, controls. Real guest login and playlist access are unverified; pause and resume are covered by tests only.

### Phase 15 — UI overhaul: live deck and planner (2026-11-01)

- ADR 0021. Attendee: `DeckHeader` (status pill from the real event state and stream connection), `NowPlaying` (65%) beside `NextUp` (35%), `AddMusic` (quota counter, genre chips, validation line, always-visible submit), `MyRequests` (play order, playing highlighted, `Est. in ~N min` only from the queue's prediction, collapsible `Played songs (n)`), `UpNext` is now the collapsed `Whole queue`. Planner: `CreateEvent` (three drums in one row, Synced parameters switch, `GenreGroups`, sticky action bar), `ProgressionFlow` + `progression.ts` (preview from `projectQueue`, `syncedLimit`, `trackEstimate`).
- Colours are now one map (`GENRE_COLOURS`): red, blue, amber, purple. Dark tokens changed globally to the charcoal/amber palette; light theme keeps its own tokens.
- Template demo parts were not shipped: the Switchover button, canned Spotify results, fake toasts, the example data. No API, schema or business-rule changes; the web app now depends on `@qroove/scheduler`.
- Decisions: planned-time wheel offers the 14 template values (API unchanged); the songs-per-person wheel still goes up to what the event may hold (not 50); the preview assumes songs added in blocks of the "songs in a row" size (fullest rotation); the top bar no longer shows the connection dot on the event page (the pill replaces it).
- Not done: screenshots in the docs (`attendee-*.png`, create page) are stale; real-device touch testing of the wheels.

### Phase 16 — YouTube fallback playback (2026-11-05)

- ADR 0022. Spotify songs play from a matched YouTube video when Spotify cannot play them in full; adverts play out with the page's own output muted (`adGate` in `player/embed.ts`). Server: `ingestion/providers/youtube.ts` (scoring plus API calls), match cache on the `Repository` port (`ytMatch` collection), `GET /api/events/:id/player/youtube/:rid`, `YOUTUBE_API_KEY`. Admin request view now carries `durationMs`.
- The match is fetched only for the song reserved next (that is the prefetch); nothing is matched when a song is added.
- **Not verified:** any real YouTube playback or advert behaviour. The sandbox browser gets error 150 for every video, and whether `getDuration()` reports an advert's length (and `getVideoData().video_id` changes) in practice is unproven. Unit tests use a fake player. The 2-minute cap is the safety net. Needs a real-device check with the key set.
- **User to do:** create a YouTube Data API v3 key in Google Cloud Console and set `YOUTUBE_API_KEY` on Railway service `web`.

### Phase 17 — radio fallback (2026-11-05)

- ADR 0023, from `troubleshoot/Qroove_Radio_Fallback_Implementation_Plan.md` (read it for the full brief). Config: `packages/config/src/radio.ts` (station registry with evidence, `RADIO_DEFAULTS`, pure `chooseRadioStation`). Server: optional `EventDoc.radio` / `radioFallback`, `domain/commands/radio.ts` (`setRadioFallback`, `reportRadioStarted`, `reportRadioEnded`), `applyRadioPlay` in `history.ts`, `commit()` clears stale radio, public view gains `radioFallback` and `radio`; routes `POST /player/radio/started|ended`, `POST /admin/radio`; CSP `media-src`/`connect-src` for `radio.co`. Web: `player/RadioFallback.tsx` + `player/radio.ts`, wired into `PlayerConsole` (the main auto-advance is held while a station is on), attendee _Now playing_ shows the radio.
- Decisions: default **off** (`enabledByDefault: false` in `radio.ts`; the plan's own gate wants device tests first); radio never extends a same-genre run (prevents cap starvation); guest song takes over at the station's next track, after 5 min, or on a button (stations play hour-long DJ mixes); no owner-based rules (ADR 0018); no server poller, no PlaybackDoc for radio (the audit log records starts and ends).
- Verified from the sandbox: Bachata Sensual Radio stream and Radio.co status feed (unauthenticated, CORS `*`). SalsaViva/Live365 answers 401 → disabled. No qualifying Salsa station found → Salsa falls through to Bachata.
- **Not verified / not done:** any real-browser or phone playback (iOS, Android, Bluetooth), the CSP in a real browser, station-to-station switching (only one station), AzuraCast/ICY adapters, warm standby, crossfade, strict-alignment mode, offset calibration, a 2-hour rehearsal, Cha-cha and Other stations.
- To enable by default after device checks: set `enabledByDefault: true` in `packages/config/src/radio.ts`. Not deployed (`railway up` is the user's step; the Railway MCP was down).
- Tests (Firestore emulator suite also passes, 54): config 6, server +8 (6 command-suite on memory, 2 history), web +4 radio and +3 parser.
