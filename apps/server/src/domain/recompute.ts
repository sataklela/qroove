import { RULE_DEFAULTS } from '@qroove/config';
import type { PreviewItem } from '@qroove/contracts';
import {
  applyPlay,
  DEFAULT_DURATION_MS,
  projectQueue,
  selectNext,
  type BreakWindow,
  type Candidate,
} from '@qroove/scheduler';
import { SYSTEM_SEED_ID, type RequestDoc } from '../db/types.js';
import type { Work } from './context.js';
import {
  fromSchedulerHistory,
  rulesAt,
  ruleWindowsOf,
  toCandidate,
  toSchedulerHistory,
} from './history.js';

const POOL_STATES: ReadonlySet<string> = new Set(['QUEUED', 'INELIGIBLE_TEMPORARILY', 'OVERFLOW']);

/**
 * Breaks still to come or in progress, as absolute times. A break the organiser never started is
 * dropped once its slot has fully passed, so a forgotten break cannot block the night.
 */
export function breakWindows(w: Work, now: number): BreakWindow[] {
  const out: BreakWindow[] = [];
  for (const b of w.event.breaks) {
    if (b.actualEnd !== null) continue;
    const ms = b.durationSec * 1000;
    if (b.actualStart !== null) out.push({ startMs: b.actualStart, endMs: b.actualStart + ms });
    else if (b.startsAt !== null && now < b.startsAt + ms) {
      out.push({ startMs: b.startsAt, endMs: b.startsAt + ms });
    }
  }
  return out.sort((x, y) => x.startMs - y.startMs);
}

/** Time left to play music: until the next break starts, or the planned end. */
function musicWindowMs(endAt: number | null, windows: readonly BreakWindow[], now: number) {
  let limit: number | null = endAt;
  let byBreak = false;
  for (const b of windows) {
    if (b.endMs <= now) continue;
    if (limit === null || b.startMs < limit) {
      limit = b.startMs;
      byBreak = true;
    }
    break;
  }
  return { remainingMs: limit === null ? null : Math.max(0, limit - now), byBreak };
}

export const breakInProgress = (w: Work) =>
  w.event.breaks.some((b) => b.actualStart !== null && b.actualEnd === null);

/**
 * After any mutation: keep a single next-track reservation, refresh request states that depend on
 * the projection, and rewrite the denormalised preview. Mutates `w` only.
 */
export function recompute(w: Work, now: number): void {
  const e = w.event;
  const guestsFirst = e.guestsFirst !== false;
  const filler = (r: RequestDoc) => Number(guestsFirst && r.ownerId === SYSTEM_SEED_ID);
  const live = e.state === 'ACTIVE' || e.state === 'PAUSED' || e.state === 'TRANSFERRING';
  if (!live) {
    e.reservation = null;
    e.waitingReason = null;
    // Before the organiser starts, songs already submitted are listed in the order they came in,
    // with no predicted time. Nothing is reserved or played until the event starts.
    const early =
      e.state === 'DRAFT'
        ? [...w.requests.values()]
            .filter((r) => POOL_STATES.has(r.state))
            .sort((a, b) => filler(a) - filler(b) || a.acceptedSeq - b.acceptedSeq)
            .map((r, i) => ({
              requestId: r.id,
              position: i + 1,
              predictedStartMs: null,
              uncertain: true,
              overflow: false,
            }))
        : [];
    e.preview = {
      revision: e.version + 1,
      items: early,
      stoppedReason: 'EXHAUSTED',
      computedAt: now,
    };
    return;
  }

  const cand = (r: RequestDoc) => toCandidate(r, guestsFirst);
  const rules = rulesAt(e, now);
  const history = toSchedulerHistory(e.history);
  const overheadMs = RULE_DEFAULTS.transitionOverheadSec * 1000;
  const windows = breakWindows(w, now);
  const all = [...w.requests.values()];
  let reserved: RequestDoc | undefined = all.find((r) => r.state === 'RESERVED_NEXT');
  const playing = e.nowPlaying;

  // Invariant: `reservation` is set iff exactly one request is RESERVED_NEXT.
  if (!reserved) e.reservation = null;

  e.waitingReason = null;
  if (e.state === 'ACTIVE' && !reserved && !playing) {
    if (breakInProgress(w)) {
      e.waitingReason = 'On a break';
    } else {
      const pool: Candidate[] = all.filter((r) => POOL_STATES.has(r.state)).map(cand);
      const { remainingMs, byBreak } = musicWindowMs(e.endAt, windows, now);
      const sel = selectNext(pool, history, rules, { remainingMs });
      if (sel.pick) {
        reserved = w.setState(w.requests.get(sel.pick.requestId)!, 'RESERVED_NEXT', now);
        e.reservation = {
          requestId: reserved.id,
          reservedAt: now,
          leaseEpoch: e.lease?.epoch ?? 0,
        };
      } else if (pool.length === 0) {
        e.waitingReason = 'Waiting for songs to be requested';
      } else if (
        byBreak &&
        sel.blocked.every((b) => b.reason === 'WOULD_EXCEED_END' || b.reason === 'STYLE_DISABLED')
      ) {
        e.waitingReason = 'Break time — start the break';
      } else if (sel.blocked.every((b) => b.reason === 'WOULD_EXCEED_END')) {
        e.waitingReason = 'Beyond planned end — admin must extend';
      } else {
        e.waitingReason = sel.reason.replace(/^ALL_BLOCKED_FAIRNESS: /, '');
      }
    }
  }

  // Projection: the reservation (if any) is forced first, then the scheduler simulates the rest.
  const candidates = [...w.requests.values()].filter((r) => POOL_STATES.has(r.state)).map(cand);
  const playingLeft = playing
    ? Math.max(0, playing.startedAt + (playing.durationMs ?? DEFAULT_DURATION_MS) - now)
    : 0;
  let uncertain = playing !== null && playing.durationMs === null;
  const items: PreviewItem[] = [];
  let projHistory = history;
  let currentRemainingMs: number | null = playing ? playingLeft : null;

  if (reserved) {
    const startOffset = playingLeft + (playingLeft > 0 ? overheadMs : 0);
    items.push({
      requestId: reserved.id,
      position: 1,
      predictedStartMs: now + startOffset,
      uncertain,
      overflow: false,
    });
    projHistory = applyPlay(history, toCandidate(reserved));
    currentRemainingMs = startOffset + (reserved.durationMs ?? DEFAULT_DURATION_MS);
    if (reserved.durationMs === null) uncertain = true;
  }

  const proj = projectQueue({
    candidates,
    history: projHistory,
    rules,
    ruleWindows: ruleWindowsOf(e),
    nowMs: now,
    endAtMs: e.endAt,
    currentRemainingMs,
    breaks: windows,
    overheadSec: RULE_DEFAULTS.transitionOverheadSec,
  });
  for (const it of proj.items) {
    items.push({ ...it, position: items.length + 1, uncertain: it.uncertain || uncertain });
  }

  const overflow = new Set(proj.overflowIds);
  const waiting = new Set(proj.waitingIds);
  for (const c of candidates) {
    const r = w.requests.get(c.requestId)!;
    w.setState(
      r,
      overflow.has(r.id) ? 'OVERFLOW' : waiting.has(r.id) ? 'INELIGIBLE_TEMPORARILY' : 'QUEUED',
      now,
    );
  }

  e.preview = {
    revision: e.version + 1,
    items,
    stoppedReason: proj.stoppedReason,
    computedAt: now,
  };
}

/** Applies a started play to the event's stored history. */
export function recordPlay(w: Work, r: RequestDoc): void {
  w.event.history = fromSchedulerHistory(
    applyPlay(toSchedulerHistory(w.event.history), toCandidate(r)),
  );
}
