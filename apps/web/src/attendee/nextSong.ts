import type { EventPublicView, MyRequests, RequestView } from '@qroove/contracts';
import { formatCountdown, pluralise } from '../shared/time';

export interface NextSong {
  /** Short headline, e.g. "2 songs until Obsesión". */
  headline: string;
  /** Plain-language status line shown under it. */
  detail: string | null;
  /** Milliseconds until the song, when a ticking timer should be shown. */
  countdownMs: number | null;
  estimated: boolean;
  requestId: string | null;
}

const WAITING = new Set([
  'PENDING_METADATA',
  'QUEUED',
  'INELIGIBLE_TEMPORARILY',
  'RESERVED_NEXT',
  'OVERFLOW',
]);

/**
 * SPEC §4 attendee countdown. Pure: `serverNowMs` is the server's clock estimated from the last
 * `serverNow`, so a wrong phone clock never changes the answer.
 */
export function nextSong(
  view: EventPublicView,
  mine: MyRequests | null,
  serverNowMs: number,
): NextSong {
  const none = (headline: string, detail: string | null = null): NextSong => ({
    headline,
    detail,
    countdownMs: null,
    estimated: false,
    requestId: null,
  });
  if (view.state === 'ENDED' || view.state === 'ARCHIVED')
    return none('This event has ended', 'Join the next event with a new link.');
  if (view.state === 'DRAFT')
    return none(
      'The event has not started yet',
      'You can add songs now; they play once the organiser starts it.',
    );

  const active = (mine?.requests ?? []).filter((r) => WAITING.has(r.state));
  if (active.length === 0) {
    return none(
      'You have no songs waiting',
      mine && mine.accepted >= mine.limit
        ? 'You have used all your songs for this event.'
        : 'Add a song to join the queue.',
    );
  }
  // The soonest predicted song first; unpredictable ones after, oldest first.
  const ranked = [...active].sort(
    (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.acceptedSeq - b.acceptedSeq,
  );
  const r: RequestView = ranked[0]!;
  const base = { requestId: r.id };

  if (view.state === 'PAUSED' || view.state === 'TRANSFERRING') {
    return {
      ...base,
      headline: `Next: ${r.title}`,
      detail: 'Session paused',
      countdownMs: null,
      estimated: false,
    };
  }
  if (r.state === 'PENDING_METADATA') {
    return {
      ...base,
      headline: `Next: ${r.title}`,
      detail: r.statusText,
      countdownMs: null,
      estimated: false,
    };
  }
  if (r.state === 'OVERFLOW') {
    return {
      ...base,
      headline: `Next: ${r.title}`,
      detail: 'Beyond planned end — admin must extend',
      countdownMs: null,
      estimated: false,
    };
  }
  if (r.position === null) {
    const waiting = r.state === 'INELIGIBLE_TEMPORARILY' || view.waitingReason;
    return {
      ...base,
      headline: `Next: ${r.title}`,
      detail:
        waiting && view.waitingReason
          ? 'Waiting for more eligible songs'
          : 'Position not yet predictable',
      countdownMs: null,
      estimated: false,
    };
  }
  const before = r.position - 1 + (view.nowPlaying ? 1 : 0);
  const headline =
    before === 0
      ? `You’re up next: ${r.title}`
      : `${before} ${pluralise(before, 'song')} until ${r.title}`;
  const countdownMs =
    r.predictedStartMs === null ? null : Math.max(0, r.predictedStartMs - serverNowMs);
  return {
    ...base,
    headline,
    detail: countdownMs === null ? 'Position not yet predictable' : null,
    countdownMs,
    estimated: r.uncertain,
  };
}

export { formatCountdown };
