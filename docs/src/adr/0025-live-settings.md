# ADR 0025 — Settings can change while the event runs

**Status:** accepted · **Date:** 2026-11-11 · Supersedes the "frozen at start" rule of SPEC §3.1 for the settings listed here

## Context

Rules were frozen when the event started (SPEC §3.1), so an organiser had to get the planner right before any music played. The aim now is the fewest possible actions before the first song: start with the defaults (2 hours, 1 song in a row, Salsa and Bachata, 20 songs per person) and adjust once the room is dancing.

## Decision

- `POST /api/events/:id/admin/settings` (`updateSettings`) works in DRAFT, ACTIVE, PAUSED and TRANSFERRING. It accepts `plannedDurationMin`, `enabledStyles`, `masterRunCap`, `submissionLimit` and `guestsFirst`; unknown fields are refused.
- **Time:** the end becomes _start + planned time_. It may be made shorter as well as longer, but not into the past; planned breaks must still fit (`validateBreaks`).
- **Genres and songs in a row** apply to every part of the evening. Songs of a genre that is switched off are not removed: they wait (`STYLE_DISABLED`) and play again if the genre comes back.
- **Songs per person** keeps the existing ceiling of 5 per 15 planned minutes. Lowering it removes nothing; it only stops further additions. The console lowers it together with the time when the new ceiling requires it.
- The rules fingerprint (`rulesHash`) is recalculated on every change and the audit log records `settings.update` with the old and new fingerprint, so it is still possible to say which rules were in force when.
- `PATCH /admin/draft` stays draft-only (`RULES_FROZEN`); it is what the planner's richer options (per-part genres, ratios, breaks) would use.

## Consequences

- Guests see a changed limit or genre list on their next update; nothing is announced to them.
- Per-part genres and ratios set in the planner are flattened if the organiser later changes genres or the run cap from the console.
- Breaks cannot be added or moved once the event runs. The planner remains for evenings that need them.
