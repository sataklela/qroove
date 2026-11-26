import type { EventPublicView } from '@qroove/contracts';
import { GenreSwatch } from '../shared/Genre';
import { NowPlayingHero } from '../shared/NowPlayingHero';

export { TrackMeta } from '../shared/NowPlayingHero';

export function NowPlaying({
  view,
  clockOffset = 0,
  showRun = true,
}: {
  view: EventPublicView;
  clockOffset?: number;
  /** The organiser's playback bar already shows the genre run. */
  showRun?: boolean;
}) {
  const np = view.nowPlaying;
  const idle = view.radio ? (
    // Radio fallback (ADR 0023): the room is hearing a station because no guest song is due.
    <>
      <p className="hero-title" title={view.radio.title ?? undefined}>
        {view.radio.title ?? 'Live radio'}
      </p>
      <p className="track-meta">
        <GenreSwatch style={view.radio.genre} size={10} label={false} />
        <span>Radio fallback · {view.radio.stationName}</span>
      </p>
    </>
  ) : (
    <p className="muted">
      {view.state === 'PAUSED' || view.state === 'TRANSFERRING'
        ? 'Session paused'
        : (view.waitingReason ?? 'Nothing is playing right now.')}
    </p>
  );
  return (
    <NowPlayingHero
      track={np?.track ?? null}
      startedAt={np?.startedAt ?? null}
      clockOffset={clockOffset}
      eyebrow={!np && view.radio ? 'On the radio' : 'Now playing'}
      idle={idle}
    >
      {showRun && view.runIndicator && view.state === 'ACTIVE' ? (
        <p className="muted small">
          <GenreSwatch style={view.runIndicator.style} size={14} /> {view.runIndicator.runLength}/
          {view.runIndicator.cap}
        </p>
      ) : null}
    </NowPlayingHero>
  );
}
