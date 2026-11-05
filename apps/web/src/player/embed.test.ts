import { afterEach, describe, expect, it, vi } from 'vitest';
import { AD_MUTE_CAP_MS, adGate, mountEmbed, sourceOf, spotifyTracker } from './embed';

const events = () => ({ onPlaying: vi.fn(), onEnded: vi.fn(), onFailed: vi.fn() });
const update = (over: Partial<Parameters<ReturnType<typeof spotifyTracker>>[0]>) => ({
  isPaused: false,
  isBuffering: false,
  duration: 200_000,
  position: 0,
  ...over,
});

describe('sourceOf', () => {
  it('recognises stored Spotify and YouTube links only', () => {
    const spotify = 'a'.repeat(22);
    expect(sourceOf(`https://open.spotify.com/track/${spotify}`)).toEqual({
      kind: 'spotify',
      id: spotify,
    });
    expect(sourceOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      kind: 'youtube',
      id: 'dQw4w9WgXcQ',
    });
    expect(sourceOf('https://music.apple.com/song/123456')).toBeNull();
    expect(sourceOf(null)).toBeNull();
  });
});

describe('spotifyTracker', () => {
  it('reports a real start once and the end once', () => {
    const ev = events();
    const track = spotifyTracker(ev);
    track(update({ isPaused: true }));
    expect(ev.onPlaying).not.toHaveBeenCalled();
    track(update({ position: 500 }));
    track(update({ position: 1500 }));
    expect(ev.onPlaying).toHaveBeenCalledTimes(1);
    expect(ev.onPlaying).toHaveBeenCalledWith(200_000);
    track(update({ position: 199_500 }));
    track(update({ position: 0, isPaused: true }));
    expect(ev.onEnded).toHaveBeenCalledTimes(1);
  });

  it('does not treat a pause part-way through as the end', () => {
    const ev = events();
    const track = spotifyTracker(ev);
    track(update({ position: 5000 }));
    track(update({ position: 5000, isPaused: true }));
    expect(ev.onEnded).not.toHaveBeenCalled();
  });

  it('refuses a 30-second preview before it counts as started', () => {
    const ev = events();
    spotifyTracker(ev)(update({ duration: 30_000 }));
    expect(ev.onFailed).toHaveBeenCalledWith('preview');
    expect(ev.onPlaying).not.toHaveBeenCalled();
  });
});

describe('adGate', () => {
  const want = { id: 'song', expectedMs: 229_000 };
  it('mutes until the song itself is what plays', () => {
    expect(adGate(null, want, 0)).toBe('mute');
    expect(adGate({ videoId: 'song', durationMs: 15_000 }, want, 0)).toBe('mute');
    expect(adGate({ videoId: 'song', durationMs: 228_000 }, want, 0)).toBe('play');
  });
  it('mutes again for a mid-roll advert, and for a different video', () => {
    expect(adGate({ videoId: 'song', durationMs: 30_000 }, want, 0)).toBe('mute');
    expect(adGate({ videoId: 'other', durationMs: 229_000 }, want, 0)).toBe('mute');
  });
  it('tolerates a player that reports no video id', () => {
    expect(adGate({ videoId: undefined, durationMs: 229_500 }, want, 0)).toBe('play');
  });
  it('gives up and plays after two minutes of silence', () => {
    expect(adGate({ videoId: 'x', durationMs: 5_000 }, want, AD_MUTE_CAP_MS - 1)).toBe('mute');
    expect(adGate({ videoId: 'x', durationMs: 5_000 }, want, AD_MUTE_CAP_MS)).toBe('play');
  });
});

describe('mountEmbed for a matched YouTube video', () => {
  afterEach(() => vi.useRealTimers());

  it('stays muted through an advert, unmutes for the song and re-mutes for a mid-roll', async () => {
    vi.useFakeTimers();
    const log: string[] = [];
    let sample = { id: 'song', seconds: 20 }; // a 20 s advert
    let onReady = () => {};
    let onState: (e: { data: number }) => void = () => {};
    window.YT = {
      Player: class {
        constructor(
          _el: HTMLElement,
          opts: { events: { onReady: () => void; onStateChange: typeof onState } },
        ) {
          onReady = opts.events.onReady;
          onState = opts.events.onStateChange;
        }
        playVideo() {
          log.push('play');
        }
        mute() {
          log.push('mute');
        }
        unMute() {
          log.push('unmute');
        }
        setVolume() {}
        getDuration() {
          return sample.seconds;
        }
        getVideoData() {
          return { video_id: sample.id };
        }
        destroy() {}
      },
    } as unknown as NonNullable<Window['YT']>;
    const ev = { ...events(), onAd: vi.fn() };
    const host = document.createElement('div');
    const stop = mountEmbed(host, { kind: 'youtube', id: 'song', expectedMs: 229_000 }, ev);
    window.onYouTubeIframeAPIReady!();
    await vi.advanceTimersByTimeAsync(0);
    onReady();
    expect(log).toEqual(['mute', 'play']);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ev.onPlaying).not.toHaveBeenCalled(); // the advert is not the song

    sample = { id: 'song', seconds: 229 };
    await vi.advanceTimersByTimeAsync(600);
    expect(log).toContain('unmute');
    expect(ev.onPlaying).toHaveBeenCalledWith(229_000);

    sample = { id: 'song', seconds: 15 }; // a mid-roll
    await vi.advanceTimersByTimeAsync(600);
    expect(log.filter((x) => x === 'mute')).toHaveLength(2);
    onState({ data: 0 }); // an advert "ending" is not the song ending
    expect(ev.onEnded).not.toHaveBeenCalled();

    sample = { id: 'song', seconds: 229 };
    await vi.advanceTimersByTimeAsync(600);
    onState({ data: 0 });
    expect(ev.onEnded).toHaveBeenCalledTimes(1);
    stop();
  });
});
