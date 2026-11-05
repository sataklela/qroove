# API reference

All routes are under `/api`. Bodies and params are validated with the zod schemas in `@qroove/contracts`
(`packages/contracts/src/api.ts`). Errors are always JSON:

```json
{
  "error": {
    "code": "QUOTA_FULL",
    "message": "…",
    "action": "Remove a song that has not started to free a slot."
  }
}
```

| Code                   | HTTP | When                                                     |
| ---------------------- | ---- | -------------------------------------------------------- |
| `VALIDATION`           | 400  | Bad body/params, body over 16 KB                         |
| `UNAUTHORISED`         | 401  | Missing/stale credential, CSRF or origin failure         |
| `NOT_OWNER`            | 403  | Changing someone else's request                          |
| `NOT_FOUND`            | 404  | Unknown event, request, slug, or expired/used code       |
| `DUPLICATE`            | 409  | Recording already in the event (`Already queued as …`)   |
| `QUOTA_FULL`           | 409  | Participant used all accepted slots                      |
| `RULES_FROZEN`         | 409  | Rules edited after start                                 |
| `ALREADY_STARTED`      | 409  | Withdrawing/removing a started song                      |
| `EVENT_NOT_ACTIVE`     | 409  | Event not accepting that action right now                |
| `STALE_LEASE`          | 409  | Player epoch/token not current                           |
| `STALE_VERSION`        | 409  | `expectedVersion` mismatch, or player acted on old queue |
| `EVENT_ENDED`          | 410  | Event ended                                              |
| `UNSUPPORTED_LINK`     | 422  | Link host/shape not supported                            |
| `RATE_LIMITED`         | 429  | See rate limits in [Security](/architecture/security)    |
| `METADATA_UNAVAILABLE` | 502  | Lookup failed; the client should offer manual entry      |

## Credentials

- **Participant:** `Authorization: Bearer <participantId>:<token>` from `POST …/join`.
- **Admin:** HttpOnly cookie `qa_<eventId>` from `POST …/admin/session`. Non-GET calls also need an allowed
  `Origin` and `X-Qroove-CSRF` equal to the readable `qc_<eventId>` cookie.
- **Player:** `leaseToken` + `epoch` in the body, from `POST …/player/claim`.

Any POST may carry an `Idempotency-Key` header (≤100 chars); a replay returns the first response. Responses
that carry a secret are not replayable and send `Cache-Control: no-store`.

## Discovery and public

| Route                                                           | Auth            | Notes                                                                                                                                                            |
| --------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health`                                               | –               | `{ ok, version, commit }`                                                                                                                                        |
| `GET /api/events/by-slug/:slug`                                 | –               | `{ eventId, slug, name }`                                                                                                                                        |
| `GET /api/events/:slug/public`                                  | –               | Sanitised view: state, now playing, queue (request ids, titles, nicknames), preview, `waitingReason`, `runIndicator`, `serverNow`. No participant ids or tokens. |
| `GET /api/events/:id/stream`                                    | –               | Server-Sent Events, see [Realtime](/architecture/realtime)                                                                                                       |
| `GET /api/events/:id/export`                                    | –               | `ExportSnapshot`: unplayed and played songs, no people                                                                                                           |
| `POST /api/internal/purge`                                      | `x-cron-secret` | Retention purge; returns a count per category. 404 when `CRON_SECRET` is unset, 401 for a wrong secret                                                           |
| `POST /api/resolve-link`                                        | –               | `{ url }` → title, artist, duration, artwork, `confidence`, `suggestedStyle`. No side effects. 20/min/IP.                                                        |
| `GET /api/spotify/login`, `/callback`, `/token`; `POST /logout` | –               | Organiser Spotify sign-in (ADR 0019). Was: returns 204                                                                                                           |

## Creating and joining

| Route                                                               | Auth        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/events`                                                  | –           | Body: `timezone`, `plannedDurationMin` (15–480 in steps of 15), `enabledStyles`, `masterRunCap`, `ratio?`, `segments?[]` (one per part: `enabledStyles`, `masterRunCap?`, `ratio?`), `submissionLimit`, `breaks[]` (`startMin` on a 10-minute mark, 10/20/30 min, validated), `songs?: [{ title, artist, durationMs, sourceUrl, style }]` (the organiser's sorted playlist songs; only what fits the planned time minus one minute is queued, and every active genre needs at least one; unsupported `sourceUrl`s are dropped). There is no `name`: the server generates it and rejects the field. 201 with `eventId`, `slug`, `name`, `joinUrl` (the public `/e/<code>` link, shown as a QR code), `adminUrl` (`#k=` fragment), `recoverySecret`, `rules`, `seeded`. 5/hour/IP. |
| `POST /api/events/import`                                           | –           | Carry-over: `{ snapshot, timezone, plannedDurationMin, selectedIndexes?, shuffle?, name? }` → new DRAFT with a new admin; 201                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `POST /api/events/:id/join`                                         | –           | `{ nickname }` (required) → `{ participantId, token }`. The room code is enough. 20/min/IP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `GET /api/spotify/search?q=`, `GET /api/spotify/me/playlists[/:id]` | –           | Spotify search with app credentials; a logged-in guest's playlists (ADR 0020).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `POST /api/resolve-playlist`                                        | –           | `{ url }` → `{ tracks: [{ title, artist, durationMs, sourceUrl }] }` from a public Spotify, YouTube (Music) or Apple Music playlist or song link; a song gives one track (best effort). 12/min/IP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /api/events/:id/requests/batch`                               | Participant | `{ style, songs[] (1–30, in order) }` → `{ results: [{ index, status: ADDED \| DUPLICATE \| QUOTA_FULL \| FAILED }], accepted }`. Stops adding when the quota is full. 4/min/participant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/events/:id/requests`                                     | Participant | `{ style, url }` or `{ style, manual: { title, artist?, durationMs? } }` → `{ request }`. 10/min/participant, 30/min/IP. A possible duplicate returns state `PENDING_METADATA` with status text `Possible duplicate — needs review`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `GET /api/events/:id/my-requests`                                   | Participant | `{ accepted, limit, requests[] }` with position, predicted start and status text                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `DELETE /api/events/:id/requests/:rid`                              | Participant | Own, unstarted requests only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Admin

All require the admin cookie (and origin + CSRF for non-GET) unless noted.

| Route                                    | Notes                                                                              |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `POST /admin/session`                    | `{ secret }` → sets cookies, returns `{ csrf }`. No cookie needed; origin checked. |
| `GET /admin/state`                       | View plus moderation list, lease, `rulesHash`                                      |
| `GET /admin/stream`                      | SSE variant of the above                                                           |
| `PATCH /admin/draft`                     | DRAFT only; otherwise `RULES_FROZEN`                                               |
| `POST /start`                            | Freezes rules and records their hash                                               |
| `POST /admin/pause` · `/resume`          | Reservation is kept across a pause                                                 |
| `POST /admin/skip`                       | The playing track counts as played                                                 |
| `POST /admin/end-time`                   | `{ endAt }`; must be future and later than the current end                         |
| `POST /admin/breaks/:bid/start` · `/end` |                                                                                    |
| `POST /admin/remove/:rid`                | `{ reason? }`; played songs cannot be removed                                      |
| `POST /admin/duplicate/:rid`             | `{ decision: "approve" \| "reject" }` for held possible duplicates                 |
| `POST /admin/end` · `/archive`           | `end` returns the `carryOver` list                                                 |
| `POST /admin/handover`                   | `{ code, expiresAt }`; state becomes `TRANSFERRING`                                |
| `POST /admin/handover/claim`             | `{ code }`; no cookie needed; sets the new admin's cookies                         |
| `POST /admin/recover`                    | `{ recoverySecret }`; replaces all admin access                                    |

(Paths are relative to `/api/events/:id`, except `/start` which is `POST /api/events/:id/start`.)

## Player

| Route                      | Auth         | Notes                                                                                                       |
| -------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------- |
| `POST /player/claim`       | Admin cookie | `{ takeover? }` → `{ leaseToken, lease }`. Fences out the previous device.                                  |
| `GET /player/youtube/:rid` | Admin cookie | `{ videoIds }`: up to 3 YouTube videos that are the same recording as a Spotify song, best first (ADR 0022) |
| `POST /player/heartbeat`   | Lease        | Every 10 s; the lease lapses after 30 s                                                                     |
| `POST /player/started`     | Lease        | Must name the reserved request; this is when a song counts                                                  |
| `POST /player/finished`    | Lease        | `outcome: PLAYED \| FAILED`; idempotent                                                                     |
| `POST /player/release`     | Lease        |                                                                                                             |
