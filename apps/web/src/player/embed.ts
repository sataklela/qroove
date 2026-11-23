/**
 * The official Spotify and YouTube players, in their own iframes on the player device. They play
 * the provider's own stream under its terms; no audio is fetched, copied or sent through Qroove.
 */
export interface Source {
  kind: 'spotify' | 'youtube';
  id: string;
  /**
   * The song's real length when the video was matched to a Spotify song. Reported as the length
   * once it plays; YouTube's own player and everything it shows (adverts included) are untouched.
   */
  expectedMs?: number;
}

export type EmbedFailure = 'blocked' | 'preview' | 'account';

export interface EmbedEvents {
  /** Audio has really started. The length is only passed when the player can be trusted for it. */
  onPlaying: (durationMs: number | null) => void;
  onEnded: () => void;
  onFailed: (why: EmbedFailure) => void;
}

/** Stored source links are canonical (see `safeSourceUrl`), so only those shapes are recognised. */
export function sourceOf(url: string | null | undefined): Source | null {
  if (!url) return null;
  const spotify = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})$/.exec(url);
  if (spotify) return { kind: 'spotify', id: spotify[1]! };
  const youtube = /^https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})$/.exec(url);
  if (youtube) return { kind: 'youtube', id: youtube[1]! };
  return null;
}

interface YtPlayer {
  playVideo(): void;
  destroy(): void;
}
interface SpotifyUpdate {
  isPaused: boolean;
  isBuffering: boolean;
  duration: number;
  position: number;
}
declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YtPlayer };
    onYouTubeIframeAPIReady?: () => void;
  }
}

function addScript(src: string, reject: (e: Error) => void) {
  const s = document.createElement('script');
  s.src = src;
  s.async = true;
  s.onerror = () => reject(new Error(`could not load ${src}`));
  document.head.append(s);
}

let youtubeApi: Promise<void> | null = null;
/** Loads YouTube's player script early, so the first song does not wait for it. */
export function loadYouTube(): Promise<void> {
  youtubeApi ??= new Promise<void>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    addScript('https://www.youtube.com/iframe_api', reject);
  });
  return youtubeApi;
}

const YT_PLAYING = 1;
const YT_ENDED = 0;
/** Without a signed-in Premium session Spotify's embed offers only this much of a song. */
const PREVIEW_MS = 31_000;

/** Exported for tests: turns Spotify's position updates into start, end and preview signals. */
export function spotifyTracker(ev: EmbedEvents) {
  let started = false;
  let finished = false;
  let moved = false;
  return (u: SpotifyUpdate) => {
    if (finished || u.duration <= 0) return;
    if (u.duration <= PREVIEW_MS) {
      finished = true;
      ev.onFailed('preview');
      return;
    }
    if (!started && !u.isPaused && !u.isBuffering) {
      started = true;
      ev.onPlaying(u.duration);
    }
    if (u.position > 0) moved = true;
    // At the end it either reports the full position or rewinds to 0 and pauses.
    if (started && moved && (u.position >= u.duration - 1000 || (u.isPaused && u.position === 0))) {
      finished = true;
      ev.onEnded();
    }
  };
}

/**
 * Starts the song in `host`. Returns a function that removes the player.
 *
 * With `hold`, the player is loaded and the song cued but not started until `hold` resolves: the
 * next song is ready in its own player before the current one ends (ADR 0029). Nothing plays or
 * buffers audio before then; it is the provider's normal cued state.
 */
export function mountEmbed(
  host: HTMLElement,
  source: Source,
  ev: EmbedEvents,
  hold?: Promise<void>,
): () => void {
  let gone = false;
  let destroy = () => {};
  const el = document.createElement('div');
  host.append(el);
  const fail = () => {
    if (!gone) ev.onFailed('blocked');
  };

  if (source.kind === 'youtube') {
    loadYouTube()
      .then(() => {
        if (gone || !window.YT) return;
        let started = false;
        const player: YtPlayer = new window.YT.Player(el, {
          videoId: source.id,
          playerVars: {
            autoplay: hold ? 0 : 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (!hold) player.playVideo();
              else void hold.then(() => !gone && player.playVideo());
            },
            onStateChange: (e: { data: number }) => {
              if (e.data === YT_PLAYING && !started) {
                started = true;
                // The matched Spotify length when known; never read from the player.
                ev.onPlaying(source.expectedMs ?? null);
              } else if (e.data === YT_ENDED && started) ev.onEnded();
            },
            // Includes "the owner does not allow embedding", which is common for label videos.
            onError: fail,
          },
        });
        destroy = () => {
          player.destroy();
        };
      })
      .catch(fail);
  } else {
    // Spotify's iframe API script needs eval, which our CSP refuses, so this speaks its message
    // protocol to the embed directly. That protocol is not a published contract.
    const frame = document.createElement('iframe');
    frame.src = `https://open.spotify.com/embed/track/${source.id}`;
    frame.title = 'Spotify player';
    frame.allow = 'autoplay; encrypted-media';
    const track = spotifyTracker(ev);
    const onMessage = (e: MessageEvent<{ type?: string; payload?: SpotifyUpdate }>) => {
      if (e.source !== frame.contentWindow) return;
      if (e.data?.type === 'ready') {
        frame.contentWindow?.postMessage({ command: 'load_complete_ack' }, '*');
        const play = () => frame.contentWindow?.postMessage({ command: 'play' }, '*');
        if (!hold) play();
        else void hold.then(() => !gone && play());
      } else if (e.data?.type === 'playback_update' && e.data.payload) track(e.data.payload);
    };
    window.addEventListener('message', onMessage);
    destroy = () => window.removeEventListener('message', onMessage);
    el.append(frame);
  }

  return () => {
    gone = true;
    destroy();
    host.replaceChildren();
  };
}
