import { spotifyTracker, type EmbedEvents } from './embed';

/** Spotify's Web Playback SDK: the page itself becomes a Spotify device (ADR 0019). */
interface SdkState {
  paused: boolean;
  loading: boolean;
  duration: number;
  position: number;
  track_window: { current_track: { id: string | null } };
}
interface SdkPlayer {
  addListener(event: string, cb: (e: never) => void): void;
  connect(): Promise<boolean>;
  disconnect(): void;
  activateElement(): Promise<void>;
  getCurrentState(): Promise<SdkState | null>;
  pause(): Promise<void>;
  togglePlay(): Promise<void>;
}
declare global {
  interface Window {
    Spotify?: {
      Player: new (o: {
        name: string;
        volume: number;
        getOAuthToken: (cb: (token: string) => void) => void;
      }) => SdkPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

export interface SpotifyConnection {
  /** Must be called inside a tap: this is what lets phones play sound later without one. */
  activate(): void;
  /** Starts the track. Returns a function that stops following it and pauses. */
  play(trackId: string, ev: EmbedEvents): () => void;
  togglePause(): void;
  disconnect(): void;
}

const READY_TIMEOUT_MS = 15_000;
const POLL_MS = 1000;
/** A song that has not started this long after it was asked for is given up (no silent hang). */
const START_TIMEOUT_MS = 20_000;

export async function fetchSpotifyToken(): Promise<string | null> {
  const res = await fetch('/api/spotify/token');
  if (!res.ok) return null;
  const body = (await res.json()) as { accessToken?: string | null };
  return body.accessToken ?? null;
}

let sdk: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  sdk ??= new Promise<void>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    s.async = true;
    s.onerror = () => reject(new Error('could not load the Spotify player'));
    document.head.append(s);
  });
  return sdk;
}

/** Rejects if this browser or account cannot play; the caller falls back to the embedded player. */
export async function connectSpotify(name: string): Promise<SpotifyConnection> {
  await loadSdk();
  let token: string | null = null;
  const player = new window.Spotify!.Player({
    name,
    volume: 1,
    getOAuthToken: (cb) => {
      void fetchSpotifyToken().then((t) => {
        token = t;
        if (t) cb(t);
      });
    },
  });
  let onState: ((s: SdkState) => void) | null = null;
  player.addListener('player_state_changed', (s: SdkState | null) => {
    if (s) onState?.(s);
  });

  const deviceId = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out')), READY_TIMEOUT_MS);
    const fail = (e: { message: string }) => {
      clearTimeout(timer);
      reject(new Error(e.message));
    };
    player.addListener('ready', (e: { device_id: string }) => {
      clearTimeout(timer);
      resolve(e.device_id);
    });
    player.addListener('initialization_error', fail);
    player.addListener('authentication_error', fail);
    player.addListener('account_error', fail);
    void player.connect();
  });

  const start = async (trackId: string): Promise<number> => {
    token ??= await fetchSpotifyToken();
    return (
      await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
      })
    ).status;
  };

  return {
    activate: () => void player.activateElement(),
    togglePause: () => void player.togglePlay(),
    disconnect: () => player.disconnect(),
    play(trackId, ev) {
      let gone = false;
      /** Spotify accepted the play request: states before that can still be the previous song. */
      let asked = false;
      let first: string | null = null;
      const track = spotifyTracker({
        ...ev,
        onPlaying: (ms) => {
          clearTimeout(stall);
          ev.onPlaying(ms);
        },
      });
      /** The song Spotify showed before this one was asked for (the one that just ended). */
      let stale: string | null = null;
      const follow = (s: SdkState) => {
        if (gone) return;
        const current = s.track_window.current_track.id;
        if (!asked) {
          stale = current;
          return;
        }
        // Spotify can still show the previous song for a moment after taking the request.
        if (first === null && current === stale && current !== trackId) return;
        first ??= current;
        // Compared with the first id seen, because Spotify may swap in a regional copy of the song.
        if (current !== first) {
          gone = true;
          ev.onEnded();
          return;
        }
        track({
          isPaused: s.paused,
          isBuffering: s.loading,
          duration: s.duration,
          position: s.position,
        });
      };
      onState = follow;
      // Change events alone can miss the song's progress, which marks its end.
      const poll = setInterval(() => {
        void player.getCurrentState().then((s) => {
          if (s) follow(s);
        });
      }, POLL_MS);
      const failed = (why: 'blocked' | 'account' | 'stalled') => {
        if (gone) return;
        gone = true;
        clearTimeout(stall);
        ev.onFailed(why);
      };
      const stall = setTimeout(() => failed('stalled'), START_TIMEOUT_MS);
      player.addListener('playback_error', () => failed('blocked'));
      void (async () => {
        let status = await start(trackId);
        if (status === 404) {
          // The device can take a moment to register with Spotify.
          await new Promise((r) => setTimeout(r, 1500));
          status = await start(trackId);
        }
        if (status === 401 || status === 403) failed('account');
        else if (status >= 400) failed('blocked');
        else asked = true;
      })().catch(() => failed('blocked'));
      return () => {
        gone = true;
        clearTimeout(stall);
        clearInterval(poll);
        onState = null;
        void player.pause().catch(() => undefined);
      };
    },
  };
}
