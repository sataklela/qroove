import type { ReactNode } from 'react';
import type { TrackView } from '@qroove/contracts';
import { genreOf, type StyleId } from '@qroove/config';
import { GenreSwatch, shortGenreLabel, styleBoxVars, styleName } from './Genre';
import { useTick } from './useEventStream';

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

/**
 * Cover art URL for display. YouTube's default thumbnails are 4:3 with black bars around a 16:9
 * frame; its `mqdefault` is the bare 16:9 frame, which crops cleanly to a square.
 */
export const artSrc = (url: string): string =>
  url.replace(
    /^(https:\/\/i\.ytimg\.com\/vi\/[^/]+\/)(?:hq|sd|maxres)?default\.jpg$/,
    '$1mqdefault.jpg',
  );

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function genreVars(style: string) {
  try {
    genreOf(style as StyleId);
    return styleBoxVars(style as StyleId);
  } catch {
    return {};
  }
}

/**
 * The song that is playing, as the hero of the screen: large cover art with a soft glow of its own
 * colours behind it (a blurred copy of the cover: no pixel reading, so no CORS), the title in the
 * display face, and a slim progress bar. Shared by the guest page, the organiser console and TV.
 */
export function NowPlayingHero({
  track,
  startedAt,
  clockOffset = 0,
  eyebrow = 'Now playing',
  idle,
  children,
}: {
  track: TrackView | null;
  startedAt?: number | null;
  /** serverNow − Date.now(), so progress matches the server's clock. */
  clockOffset?: number;
  eyebrow?: string;
  /** Shown when nothing is playing. */
  idle?: ReactNode;
  children?: ReactNode;
}) {
  const now = useTick(1000) + clockOffset;
  const art = track?.artworkUrl ?? null;
  const dur = track?.durationMs ?? null;
  const elapsed = track && startedAt ? Math.min(now - startedAt, dur ?? Infinity) : null;
  const pct = dur && elapsed !== null ? Math.max(0, Math.min(100, (elapsed / dur) * 100)) : null;
  return (
    <section
      className={`hero${track ? '' : ' hero-idle'}`}
      aria-labelledby="hero-h"
      style={track ? genreVars(track.style) : undefined}
    >
      {art ? (
        <div
          className="hero-glow"
          aria-hidden
          style={{ backgroundImage: `url("${artSrc(art)}")` }}
        />
      ) : (
        <div className="hero-glow hero-glow-genre" aria-hidden />
      )}
      {/* Keyed by the song, so the change animates only when the track really changes. */}
      <div key={track?.requestId ?? 'idle'} className="hero-body song-in">
        <div className="hero-art" aria-hidden>
          {art ? (
            <img src={artSrc(art)} alt="" loading="eager" referrerPolicy="no-referrer" />
          ) : (
            <span />
          )}
        </div>
        <div className="hero-text">
          <h2 id="hero-h" className="eyebrow">
            {track ? <span className="live-dot" aria-hidden /> : null}
            {eyebrow}
          </h2>
          {track ? (
            <>
              <p className="hero-title" title={track.title}>
                {track.title}
              </p>
              <TrackMeta style={track.style} artist={track.artist} />
              {track.ownerNickname ? (
                <p className="hero-for muted small">for {track.ownerNickname}</p>
              ) : null}
              {pct !== null && elapsed !== null && dur ? (
                <div className="hero-progress">
                  <div
                    className="bar"
                    role="progressbar"
                    aria-label="Song progress"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(pct)}
                  >
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <span className="times">
                    {clock(elapsed)} <span className="muted">/ {clock(dur)}</span>
                  </span>
                </div>
              ) : null}
            </>
          ) : (
            <div className="hero-idle-text">{idle}</div>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}
