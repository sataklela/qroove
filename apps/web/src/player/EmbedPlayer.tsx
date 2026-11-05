import { useEffect, useRef } from 'react';
import { mountEmbed, type EmbedEvents, type Source } from './embed';
import type { SpotifyConnection } from './spotifySdk';

/** Hosts one provider player for one song; a new song means a new player. */
export function EmbedPlayer({
  source,
  spotify,
  ...events
}: { source: Source; spotify: SpotifyConnection | null } & EmbedEvents) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });
  const { kind, id, expectedMs } = source;
  useEffect(() => {
    if (!host.current) return;
    const ev: EmbedEvents = {
      onPlaying: (ms) => latest.current.onPlaying(ms),
      onEnded: () => latest.current.onEnded(),
      onFailed: (why) => latest.current.onFailed(why),
      onAd: (muted) => latest.current.onAd?.(muted),
    };
    // Signed in: the page itself plays, so there is no provider box to show.
    if (spotify && kind === 'spotify') return spotify.play(id, ev);
    return mountEmbed(
      host.current,
      expectedMs === undefined ? { kind, id } : { kind, id, expectedMs },
      ev,
    );
  }, [kind, id, expectedMs, spotify]);
  return (
    <div ref={host} className={spotify && kind === 'spotify' ? undefined : `embed-host ${kind}`} />
  );
}
