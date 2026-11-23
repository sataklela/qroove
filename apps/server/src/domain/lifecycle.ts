import { DomainError } from '@qroove/contracts';
import type { PlaybackOutcome } from '@qroove/contracts';
import type { PlaybackDoc } from '../db/types.js';
import { type Ctx, type Work } from './context.js';

/** Reads the playback record for the current track; call before any write. */
export async function readPlaying(c: Ctx): Promise<PlaybackDoc | null> {
  return c.event.nowPlaying ? c.tx.getPlayback(c.event.nowPlaying.playbackSeq) : null;
}

/**
 * Ends the current track. A started track always keeps its place in history (SPEC §3.4), so this
 * only moves the request to a terminal state and closes the playback record.
 */
export function closePlaying(
  c: Ctx,
  w: Work,
  pb: PlaybackDoc | null,
  requestState: 'PLAYED' | 'SKIPPED',
  outcome: PlaybackOutcome,
  endedAt: number = c.now,
): void {
  const np = w.event.nowPlaying;
  if (!np) return;
  const req = w.requests.get(np.requestId);
  if (req) w.setState(req, requestState, c.now);
  if (pb) c.tx.putPlayback({ ...pb, endedAt: Math.max(pb.startedAt, endedAt), outcome });
  w.event.nowPlaying = null;
}

export function requireLive(state: string) {
  if (state === 'ENDED' || state === 'ARCHIVED') throw new DomainError('EVENT_ENDED');
  if (state !== 'ACTIVE' && state !== 'PAUSED') throw new DomainError('EVENT_NOT_ACTIVE');
}
