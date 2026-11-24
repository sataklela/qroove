import { useEffect, useRef } from 'react';
import { mountEmbed, type EmbedEvents, type Source } from './embed';
import type { SpotifyConnection } from './spotifySdk';

/**
 * Hosts one provider player for one song; a new song means a new player. With `armed` false the
 * song is only cued (the next song, made ready while the current one plays, ADR 0029); it starts
 * when `armed` turns true, in the same player, so there is no load time between songs.
 */
export function EmbedPlayer({
  source,
  spotify,
  armed = true,
  ...events
}: { source: Source; spotify: SpotifyConnection | null; armed?: boolean } & EmbedEvents) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(events);
  useEffect(() => {
    latest.current = events;
  });
  const arm = useRef<(() => void) | null>(null);
  const startArmed = useRef(armed);
  const { kind, id, expectedMs } = source;
  /** Read once, when the player is made: a resumed song's starting point. */
  const startMs = useRef(source.startMs);
  const sdk = spotify !== null && kind === 'spotify';
  useEffect(() => {
    if (!host.current || sdk) return;
    const ev: EmbedEvents = {
      onPlaying: (ms) => latest.current.onPlaying(ms),
      onEnded: () => latest.current.onEnded(),
      onFailed: (why) => latest.current.onFailed(why),
    };
    const hold = startArmed.current
      ? undefined
      : new Promise<void>((resolve) => {
          arm.current = resolve;
        });
    return mountEmbed(
      host.current,
      {
        kind,
        id,
        ...(expectedMs === undefined ? {} : { expectedMs }),
        ...(startMs.current ? { startMs: startMs.current } : {}),
      },
      ev,
      hold,
    );
  }, [kind, id, expectedMs, sdk]);
  // Signed in to Spotify: the page itself plays, so there is nothing to cue; it starts when armed.
  useEffect(() => {
    if (!sdk || !armed || !spotify) return;
    return spotify.play(id, {
      onPlaying: (ms) => latest.current.onPlaying(ms),
      onEnded: () => latest.current.onEnded(),
      onFailed: (why) => latest.current.onFailed(why),
    });
  }, [sdk, armed, spotify, id]);
  useEffect(() => {
    if (armed) arm.current?.();
  }, [armed]);
  return <div ref={host} hidden={!armed} className={sdk ? undefined : `embed-host ${kind}`} />;
}
