import type { BreakSpec, EventPublicView } from '@qroove/contracts';
import { chooseRadioStation, genreOf, type GenreId, type StyleId } from '@qroove/config';

export type QueueRow =
  | { kind: 'song'; q: EventPublicView['queue'][number] }
  | { kind: 'break'; b: BreakSpec }
  /** A radio stand-in: it plays until a guest song takes its place. */
  | { kind: 'radio'; stationName: string; genre: GenreId };

const safeGenre = (s: string): GenreId | null => {
  try {
    return genreOf(s as StyleId);
  } catch {
    return null;
  }
};

/**
 * The radio slot that fills the queue's gap: where nothing eligible is left (queue exhausted, or
 * everything left is held back by fairness). Null when radio is off, the event is not live, or no
 * station fits. Mirrors the player's own choice so the label matches what will be heard.
 */
export function radioGap(view: EventPublicView): { stationName: string; genre: GenreId } | null {
  if (!view.radioFallback || view.state !== 'ACTIVE' || !view.rules) return null;
  if (view.preview.stoppedReason === 'HORIZON') return null;
  const playable = view.queue.filter((q) => !q.overflow);
  const lastStyle =
    playable.at(-1)?.style ?? view.nowPlaying?.track.style ?? view.runIndicator?.style;
  const lastGenre = lastStyle ? safeGenre(lastStyle) : null;
  const seg = view.rules.segments[0];
  const allowed = [...new Set(view.rules.segments.flatMap((s) => s.enabledStyles.map(safeGenre)))];
  const cap = (lastGenre && seg?.runCaps[lastGenre as keyof typeof seg.runCaps]) || 1;
  const run = playable.length === 0 ? (view.runIndicator?.runLength ?? 0) : 1;
  const st = chooseRadioStation({
    allowedGenres: allowed.filter((g): g is GenreId => g !== null),
    lastGenre,
    runLength: run,
    runCap: cap,
  });
  return st ? { stationName: st.name, genre: st.genre } : null;
}

/**
 * Songs in play order with the breaks that are still to come placed where they fall: before the
 * first song predicted to start after the break begins.
 */
export function queueRows(view: EventPublicView): QueueRow[] {
  const start = new Map(view.preview.items.map((i) => [i.requestId, i.predictedStartMs]));
  const breaks = view.breaks
    .filter((b) => b.actualEnd === null && b.startsAt !== null)
    .sort((a, b) => a.startsAt! - b.startsAt!);
  const rows: QueueRow[] = [];
  let next = 0;
  for (const q of view.queue) {
    const s = start.get(q.requestId) ?? null;
    while (next < breaks.length && s !== null && s >= breaks[next]!.startsAt!) {
      rows.push({ kind: 'break', b: breaks[next++]! });
    }
    rows.push({ kind: 'song', q });
  }
  // A break after the last queued song (or when nothing is queued) still shows.
  while (next < breaks.length) rows.push({ kind: 'break', b: breaks[next++]! });
  const gap = radioGap(view);
  if (gap) {
    // Radio fills the gap after the last playable song, before any songs held past the end time.
    const at = rows.findLastIndex((r) => r.kind === 'song' && !r.q.overflow);
    rows.splice(at + 1, 0, { kind: 'radio', ...gap });
  }
  return rows;
}

export const breakMinutes = (b: BreakSpec) => Math.round(b.durationSec / 60);
