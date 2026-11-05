import type { Candidate, HistoryState, RuleWindow, SchedulerRules } from '@qroove/scheduler';
import { FALLBACK_RUN_CAP } from '@qroove/scheduler';
import { genreOf, genresOf } from '@qroove/config';
import type { Segment } from '@qroove/contracts';
import type { EventDoc, HistoryDoc, RequestDoc } from '../db/types.js';

export const EMPTY_HISTORY_DOC: HistoryDoc = {
  lastStyle: null,
  runLength: 0,
  transitionCount: 0,
  playedKeys: [],
};

/** Adapter boundary: the stored array becomes the scheduler's Set. */
export const toSchedulerHistory = (h: HistoryDoc): HistoryState => ({
  ...h,
  playedKeys: new Set(h.playedKeys),
});

export const fromSchedulerHistory = (h: HistoryState): HistoryDoc => ({
  lastStyle: h.lastStyle,
  runLength: h.runLength,
  transitionCount: h.transitionCount,
  playedKeys: [...h.playedKeys].sort(),
});

/**
 * The scheduler's "style" is the genre: salsa and non-Latin salsa-compatible count as one, so a
 * change between them is not a style change. `allowedVariants` keeps the exact styles a segment
 * allows (a segment may allow salsa but not its non-Latin version).
 */
export function toSchedulerRules(seg: Segment): SchedulerRules {
  const genres = genresOf(seg.enabledStyles);
  const runCaps: Record<string, number> = {};
  for (const g of genres) runCaps[g] = seg.runCaps[g] ?? FALLBACK_RUN_CAP;
  return { enabledStyles: genres, allowedVariants: seg.enabledStyles, runCaps };
}

/** When each break ends (actual if known, else as scheduled); `null` before the event starts. */
function breakEnds(e: EventDoc): number[] | null {
  const ends: number[] = [];
  for (const b of e.breaks) {
    const ms = b.durationSec * 1000;
    if (b.actualEnd !== null) ends.push(b.actualEnd);
    else if (b.actualStart !== null) ends.push(b.actualStart + ms);
    else if (b.startsAt !== null) ends.push(b.startsAt + ms);
    else return null;
  }
  return ends;
}

/** Index of the segment of the evening that time `t` falls in. */
export function segmentIndexAt(e: EventDoc, t: number): number {
  const ends = breakEnds(e) ?? [];
  const i = ends.filter((end) => end <= t).length;
  return Math.min(i, e.rules.segments.length - 1);
}

export const rulesAt = (e: EventDoc, t: number): SchedulerRules =>
  toSchedulerRules(e.rules.segments[segmentIndexAt(e, t)]!);

/** Per-segment rules with the times they start, for the projection. */
export function ruleWindowsOf(e: EventDoc): RuleWindow[] {
  const ends = breakEnds(e) ?? [];
  return e.rules.segments.map((seg, i) => ({
    fromMs: i === 0 ? Number.NEGATIVE_INFINITY : (ends[i - 1] ?? Number.POSITIVE_INFINITY),
    rules: toSchedulerRules(seg),
  }));
}

export const toCandidate = (r: RequestDoc): Candidate => ({
  requestId: r.id,
  ownerId: r.ownerId,
  style: genreOf(r.style),
  variant: r.style,
  acceptedSeq: r.acceptedSeq,
  canonicalKey: r.canonicalKey,
  durationMs: r.durationMs,
  playable: r.playable,
});

/**
 * A radio track played on its own (ADR 0023). It is real music, so it can change the last genre,
 * but it never counts toward a run: the run restarts at zero on a genre change, and another track of the genre already playing leaves it as it is.
 * That keeps radio from using up a genre's cap or blocking guests' songs. Radio is system-owned, so
 * no key or participant is recorded.
 */
export function applyRadioPlay(h: HistoryDoc, genre: string): HistoryDoc {
  if (h.lastStyle === genre) return h;
  return {
    ...h,
    lastStyle: genre,
    // Zero, not one: radio is not a guest song, so it must not count toward the genre's cap. A guest
    // song of the genre radio is playing can still follow it (with a cap of 1, one would otherwise
    // wait for another genre that radio might never supply).
    runLength: 0,
    transitionCount: h.transitionCount + (h.lastStyle === null ? 0 : 1),
  };
}
