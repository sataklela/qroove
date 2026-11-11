# ADR 0026 — Guests get codenames; the event is known by its room code

**Status:** accepted · **Date:** 2026-11-11 · Supersedes [ADR 0013](/adr/0013-generated-event-names) and the "name required" part of [ADR 0017](/adr/0017-required-name-link-only-official-players)

## Context

Joining took a typed name and a tap. Events carried a generated three-word name that nobody used: people join by scanning the QR code or typing the six-character room code.

## Decision

- **Opening the event page is joining.** The page calls `POST /join` by itself when the browser has no pass for the event. There is nothing to type and nothing to tap. If the call fails, one button retries it.
- **Codenames.** The server gives each guest two words, one vegetable and one sea animal ("Carrot Octopus"), unique within the event (28 × 28 = 784 pairs; a number is added only if an event runs out). The used pairs are kept on the event document as indices (`EventDoc.codenames`), written without bumping the version, so a join does not push an update to everyone. A `nickname` sent by an old client is ignored.
- The guest sees their codename at the top of the page, and the organiser sees it beside each of that guest's songs. That is how a guest identifies themselves if something goes wrong. Other guests still do not see names in the queue.
- **No event name.** `EventDoc.name` is now the room code as it is spoken (`ABC-123`). The name ledger (`meta/eventNames`), its repository method and the generator are removed. The room code is always in the organiser's top bar.

## Consequences

- Nothing a guest types reaches a screen, so no moderation of names is needed.
- A guest who clears their browser or switches phone gets a new codename and a fresh allowance, as before.
- Every visitor who opens the page becomes a participant record (pseudonymous, purged after 30 days as before). The join rate limit (20 a minute per address) is unchanged.
- Events created before this change keep their three-word names.
