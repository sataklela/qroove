# Fewest-taps checks (Phase 18)

What was built on 2026-11-11, what has been checked, and what is still to check in a real browser and on real
phones. Branch: `claude/qroove-ux-simplification-gccoun` (not merged, not deployed). Decisions: ADRs
[0025](/adr/0025-live-settings), [0026](/adr/0026-codenames-no-event-name), [0027](/adr/0027-starter-songs-guests-first).

## Already checked

Automated only, in headless Chromium at phone size (360×640 and Pixel 8), with mouse-driven pointer events:

- Unit tests (scheduler 32, contracts 11, config 6, server 175, web 128), the Firestore emulator suite (59), lint,
  typecheck, build.
- End-to-end (7 tests, with axe accessibility checks): one-tap create, auto-join with distinct codenames, add in one
  tap, withdraw by swipe, organiser remove by swipe, a genre switched on mid-event reaching guests, manual play,
  handover, end, planner with a break, no page scroll with 30 songs queued and with the add sheet open.

## Not yet checked

- Anything on a real iPhone or Android phone: touch swipes, scroll-versus-swipe conflicts in the queue, iOS
  rubber-banding, the wheels in Settings, the on-screen keyboard pushing the add sheet.
- House playlists against live Spotify / YouTube pages (API tests use a fake network). **No links are set yet**, so a
  one-tap event starts empty.
- Real playback of starter songs (they need a playable link from the playlist).
- WebKit / Safari at all.

## Set up

1. `pnpm install && pnpm build`
2. Optional, to see starter songs: set two public playlist links, either in `packages/config/src/starter.ts`
   (`STARTER_PLAYLISTS`) or as environment variables `STARTER_PLAYLIST_SALSA` and `STARTER_PLAYLIST_BACHATA`.
3. Run the built server with the in-memory store:
   `PORT=3100 REPO_DRIVER=memory RATE_LIMIT_OFF=1 PUBLIC_BASE_URL=http://localhost:3100 node apps/server/dist/main.js`
4. Use two browser profiles (or one normal and one private window): one organiser, one guest. For phones, use a
   deployed preview or a tunnel, and set `PUBLIC_BASE_URL` to that address so the QR code points at it.
5. E2E on a machine with its own Chromium: `E2E_CHROMIUM=/path/to/chromium pnpm test:e2e`.

## Sequences to walk through

Count every tap and swipe. The target is in the last column.

### Organiser

| #   | Do this                                                             | Expect                                                                                                                             | Target            |
| --- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O1  | Home page, tap **Start an event now**                               | Organiser page, event already running, room code (`ABC-123`) in the top bar, no name asked, no link or secret shown                | 1 tap             |
| O2  | Look at the first page                                              | Player, Pause, and the queue. With playlists set: about 10 Salsa and 10 Bachata, alternating, each marked _Starter_                | 0                 |
| O3  | Start the first song                                                | One tap if the browser demands a gesture for sound; none after that                                                                | 0–1 tap           |
| O4  | Swipe to the second page                                            | Room code large, QR code scannable                                                                                                 | 1 swipe           |
| O5  | Swipe a queued song to the left                                     | Red bin appears; past a third of the row it is removed. A short swipe springs back. A vertical drag scrolls the queue instead      | 1 swipe           |
| O6  | Tap ✕ on a row, then **Remove**                                     | Same result without swiping; tapping elsewhere cancels                                                                             | 2 taps            |
| O7  | Third page: turn **Event time** to 1:30                             | Saves by itself; end time moves; songs that no longer fit are marked _After end time_                                              | swipe + 1 gesture |
| O8  | Third page: tap **Cha-cha**                                         | Saves by itself; guests' add sheet gains _Add as Cha-cha_                                                                          | 1 tap             |
| O9  | Third page: tap **Bachata** off                                     | Bachata songs stay in the queue as _Waiting for its turn_; switching it back on restores them. The last genre cannot be turned off | 1 tap             |
| O10 | Third page: switch **Guest requests play before starter songs** off | Queue returns to order of arrival; on again puts requests first                                                                    | 1 tap             |
| O11 | Every page                                                          | The page itself never scrolls vertically; only the queue list does                                                                 | —                 |

### Guest

| #   | Do this                                             | Expect                                                                                                                  | Target           |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------- |
| G1  | Scan the QR code, or type the code on the home page | Event page opens already joined: _You are Carrot Octopus_ (vegetable + sea animal), add button enabled, nothing to type | 0 after the scan |
| G2  | Reload the page                                     | Same codename, same songs                                                                                               | 0                |
| G3  | Second guest joins                                  | A different codename                                                                                                    | 0                |
| G4  | Tap **＋ Add a song**, paste a song link            | Song appears in the sheet                                                                                               | 1 tap + paste    |
| G5  | Tap **Add as Salsa**                                | Sheet closes, "1 added.", the song is in the queue with a coloured edge and _Yours · ~N min_, counter reads 1 of 20     | 1 tap            |
| G6  | Check its position                                  | Ahead of all waiting starter songs of its genre, behind the song already reserved as next                               | —                |
| G7  | Organiser's queue                                   | The same song shows the guest's codename                                                                                | —                |
| G8  | Paste a playlist link                               | Sortable list (drag, swipe left to remove, swipe right to top); only the songs within the allowance are added           | —                |
| G9  | Add a song that is a waiting starter song           | No duplicate error: it becomes _Yours_                                                                                  | —                |
| G10 | Swipe own song to the left                          | Withdrawn, "Withdrew …", counter drops. Other people's rows do not move                                                 | 1 swipe          |
| G11 | Organiser removes the guest's song                  | A line under the queue says it was removed by the organiser                                                             | —                |
| G12 | Every state, including the add sheet with keyboard  | No vertical page scroll; the add button and genre buttons stay on screen                                                | —                |

## Known behaviour, not bugs

- A swipe removal has no undo.
- The song already reserved as next is not displaced by a new request.
- Clearing the browser or changing phone gives a guest a new codename and a fresh allowance.
- Events created before this change keep their three-word names.

## If something fails

Note the sequence number, the device and browser, and what happened. The pieces are: `apps/web/src/shared/SwipeRow.tsx`
(swipes), `attendee/EventPage.tsx` and `GuestQueue.tsx` (guest screen), `attendee/AddMusic.tsx` (add sheet),
`admin/panels.tsx` (`ModerationPanel`, `SettingsPanel`), `landing/Landing.tsx` (one-tap create); on the server
`domain/commands/event.ts` (`updateSettings`), `domain/commands/requests.ts` (join, takeover),
`ingestion/starter.ts` (house playlists). Layout rules are at the end of `shared/styles/base.css` under "phase 18".
