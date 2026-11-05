import type { EventPublicView } from '@qroove/contracts';
import { GenreSwatch, shortGenreLabel, styleName } from '../shared/Genre';
import { genreOf, type StyleId } from '@qroove/config';

/** The genre as dot and words, then the artist: colour is never the only clue. */
export function TrackMeta({ style, artist }: { style: string; artist: string | null }) {
  let genre = style;
  try {
    genre = shortGenreLabel(genreOf(style as StyleId));
  } catch {
    /* an unknown style keeps its raw name */
  }
  return (
    <p className="track-meta">
      <GenreSwatch style={style} size={10} label={false} />
      <span title={styleName(style)}>{genre}</span>
      {artist ? <span className="track-artist-name">· {artist}</span> : null}
    </p>
  );
}

export function NowPlaying({ view }: { view: EventPublicView }) {
  const np = view.nowPlaying;
  return (
    <section className="card status-now" aria-labelledby="np-h">
      <h2 id="np-h" className="deck-title">
        Now playing
      </h2>
      {np ? (
        // Keyed by the song, so the slide-in plays when the real track changes and not otherwise.
        <div key={np.track.requestId} className="swap-in">
          <p className="now-title" title={np.track.title}>
            {np.track.title}
          </p>
          <TrackMeta style={np.track.style} artist={np.track.artist} />
        </div>
      ) : view.radio ? (
        // Radio fallback (ADR 0023): the room is hearing a station because no guest song is due.
        <div key={`${view.radio.stationName}:${view.radio.startedAt}`} className="swap-in">
          <p className="now-title" title={view.radio.title ?? undefined}>
            {view.radio.title ?? 'Live radio'}
          </p>
          <p className="track-meta">
            <GenreSwatch style={view.radio.genre} size={10} label={false} />
            <span>Radio fallback · {view.radio.stationName}</span>
          </p>
        </div>
      ) : (
        <p className="muted">
          {view.state === 'PAUSED' || view.state === 'TRANSFERRING'
            ? 'Session paused'
            : (view.waitingReason ?? 'Nothing is playing right now.')}
        </p>
      )}
      {view.runIndicator && view.state === 'ACTIVE' ? (
        <p className="muted small">
          <GenreSwatch style={view.runIndicator.style} size={14} /> {view.runIndicator.runLength}/
          {view.runIndicator.cap}
        </p>
      ) : null}
    </section>
  );
}
