import type { Repository } from '../src/db/ports.js';
import { FakeClock } from '../src/domain/clock.js';
import type { Deps } from '../src/domain/context.js';
import { randomIds } from '../src/domain/ids.js';
import { createEvent, startEvent } from '../src/domain/commands/event.js';
import { joinEvent, type TrackInput } from '../src/domain/commands/requests.js';

export function makeDeps(repo: Repository): Deps & { clock: FakeClock } {
  return { repo, clock: new FakeClock(), ids: randomIds };
}

export const track = (n: string | number, durationMs: number | null = 180_000): TrackInput => ({
  canonicalKey: `spotify:track:${n}`,
  provider: 'spotify',
  title: `Song ${n}`,
  artist: 'Artist',
  durationMs,
  artworkUrl: null,
  sourceUrl: `https://open.spotify.com/track/${n}`,
});

export async function liveEvent(
  deps: Deps,
  body: Partial<Parameters<typeof createEvent>[1]> = {},
  start = true,
) {
  const ev = await createEvent(deps, {
    timezone: 'Europe/London',
    // Fixed here so these tests do not move with the product defaults.
    masterRunCap: 2,
    submissionLimit: 5,
    ...body,
  });
  if (start) await startEvent(deps, { eventId: ev.eventId, adminSecret: ev.adminSecret });
  return ev;
}

export async function guest(deps: Deps, eventId: string) {
  const j = await joinEvent(deps, { eventId });
  return { eventId, participantId: j.participantId, token: j.token };
}

export async function snap(deps: Deps, eventId: string) {
  const a = await deps.repo.getEventPublic(eventId);
  if (!a) throw new Error('missing event');
  const byId = (id: string) => a.requests.find((r) => r.id === id)!;
  return { ...a, byId, state: (id: string) => byId(id).state };
}

export async function expectCode(p: Promise<unknown>, code: string) {
  await p.then(
    () => {
      throw new Error(`expected DomainError ${code}, but the call succeeded`);
    },
    (e: { code?: string }) => {
      if (e.code !== code) throw e;
    },
  );
}
