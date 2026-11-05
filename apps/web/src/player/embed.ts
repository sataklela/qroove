/**
 * The official Spotify and YouTube players, in their own iframes on the player device. They play
 * the provider's own stream under its terms; no audio is fetched, copied or sent through Qroove.
 */
export interface Source {
  kind: 'spotify' | 'youtube';
  id: string;
  /**
   * The song's real length when the video was matched to a Spotify song. With it the page keeps its
   * own output muted while anything else (an advert) is playing, and unmutes for the song.
   */
  expectedMs?: number;
}

export type EmbedFailure = 'blocked' | 'preview' | 'account';

export interface EmbedEvents {
  /** Audio has really started. The length is only passed when the player can be trusted for it. */
  onPlaying: (durationMs: number | null) => void;
  onEnded: () => void;
  onFailed: (why: EmbedFailure) => void;
  /** True while this page is holding its own output muted for an advert. */
  onAd?: (muted: boolean) => void;
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
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  getDuration(): number;
  getVideoData(): { video_id?: string };
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
function loadYouTube(): Promise<void> {
  youtubeApi ??= new Promise<void>((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    addScript('https://www.youtube.com/iframe_api', reject);
  });
  return youtubeApi;
}

const YT_PLAYING = 1;
const YT_ENDED = 0;
const AD_POLL_MS = 500;
/** Length tolerance between the matched video and the Spotify song. */
const AD_LENGTH_SLACK_MS = 5_000;
/** If the pattern never settles, stop guessing and play: silence in the room is worse than an advert. */
export const AD_MUTE_CAP_MS = 120_000;

export interface YtSample {
  videoId: string | undefined;
  durationMs: number;
}

/**
 * Pure. Is the song itself playing ('play') or something else, normally an advert ('mute')? Only
 * the player's own standard getters are read: an advert reports its own, much shorter, length.
 * After `AD_MUTE_CAP_MS` of continuous muting it gives up and plays.
 */
export function adGate(
  sample: YtSample | null,
  want: { id: string; expectedMs: number },
  mutedForMs: number,
): 'mute' | 'play' {
  if (mutedForMs >= AD_MUTE_CAP_MS) return 'play';
  if (!sample) return 'mute';
  const sameLength = Math.abs(sample.durationMs - want.expectedMs) <= AD_LENGTH_SLACK_MS;
  const sameVideo = sample.videoId === undefined || sample.videoId === want.id;
  return sameLength && sameVideo ? 'play' : 'mute';
}
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

/** Starts the song in `host`. Returns a function that removes the player. */
export function mountEmbed(host: HTMLElement, source: Source, ev: EmbedEvents): () => void {
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
        const gated = source.expectedMs !== undefined;
        const expectedMs = source.expectedMs ?? 0;
        let muted = false;
        let mutedSince = 0;
        let givenUp = false;
        let timer: ReturnType<typeof setInterval> | undefined;
        // Output is muted (never the advert itself: it plays out) until the song is what plays.
        const setMuted = (on: boolean) => {
          if (on === muted) return;
          muted = on;
          mutedSince = performance.now();
          if (on) player.mute();
          else {
            player.unMute();
            player.setVolume(100);
          }
          ev.onAd?.(on);
        };
        const check = () => {
          const verdict = givenUp
            ? 'play'
            : adGate(
                {
                  videoId: player.getVideoData().video_id,
                  durationMs: player.getDuration() * 1000,
                },
                { id: source.id, expectedMs },
                muted ? performance.now() - mutedSince : 0,
              );
          if (verdict === 'play' && muted && performance.now() - mutedSince >= AD_MUTE_CAP_MS) {
            givenUp = true;
          }
          setMuted(verdict === 'mute');
          if (verdict === 'play' && !started) {
            started = true;
            ev.onPlaying(expectedMs);
          }
        };
        const player: YtPlayer = new window.YT.Player(el, {
          videoId: source.id,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: () => {
              if (gated) {
                setMuted(true);
                timer = setInterval(check, AD_POLL_MS);
              }
              player.playVideo();
            },
            onStateChange: (e: { data: number }) => {
              if (gated) {
                // Adverts and the song share one player; only the gate says which is playing.
                if (e.data === YT_ENDED && started && !muted) ev.onEnded();
              } else if (e.data === YT_PLAYING && !started) {
                started = true;
                // Not the player's length: an advert would report its own.
                ev.onPlaying(null);
              } else if (e.data === YT_ENDED) ev.onEnded();
            },
            // Includes "the owner does not allow embedding", which is common for label videos.
            onError: fail,
          },
        });
        destroy = () => {
          clearInterval(timer);
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
        frame.contentWindow?.postMessage({ command: 'play' }, '*');
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
