import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectSpotify } from './spotifySdk';

type State = {
  paused: boolean;
  loading: boolean;
  duration: number;
  position: number;
  track_window: { current_track: { id: string | null } };
};
const at = (id: string, o: Partial<State> = {}): State => ({
  paused: false,
  loading: false,
  duration: 200_000,
  position: 0,
  track_window: { current_track: { id } },
  ...o,
});

let state: State | null;
let playStatus: number;
let playDelayMs: number;

class FakePlayer {
  private on = new Map<string, (e: unknown) => void>();
  addListener(ev: string, cb: (e: unknown) => void) {
    this.on.set(ev, cb);
  }
  connect() {
    setTimeout(() => this.on.get('ready')?.({ device_id: 'dev' }), 0);
    return Promise.resolve(true);
  }
  disconnect() {}
  activateElement() {
    return Promise.resolve();
  }
  getCurrentState() {
    return Promise.resolve(state);
  }
  pause() {
    return Promise.resolve();
  }
  togglePlay() {
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  state = null;
  playStatus = 204;
  playDelayMs = 0;
  window.Spotify = { Player: FakePlayer as never };
  vi.stubGlobal('fetch', async (url: string) => {
    if (url === '/api/spotify/token') return new Response(JSON.stringify({ accessToken: 't' }));
    await new Promise((r) => setTimeout(r, playDelayMs));
    return new Response(null, { status: playStatus });
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connect() {
  const p = connectSpotify('Qroove');
  // The SDK script never loads in tests: say it is ready.
  window.onSpotifyWebPlaybackSDKReady?.();
  await vi.advanceTimersByTimeAsync(10);
  return p;
}

describe('connectSpotify().play', () => {
  it('ignores the previous song still showing before Spotify takes the request', async () => {
    const c = await connect();
    const ev = { onPlaying: vi.fn(), onEnded: vi.fn(), onFailed: vi.fn() };
    state = at('old', { paused: true }); // the song that just ended
    playDelayMs = 2500; // the play request is slow; polls run meanwhile
    c.play('new', ev);
    await vi.advanceTimersByTimeAsync(2000);
    expect(ev.onEnded).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    state = at('new', { position: 1000 });
    await vi.advanceTimersByTimeAsync(1100);
    expect(ev.onPlaying).toHaveBeenCalledWith(200_000);
    expect(ev.onEnded).not.toHaveBeenCalled();
    expect(ev.onFailed).not.toHaveBeenCalled();
  });

  it('gives up with "stalled" when the song never starts, instead of waiting forever', async () => {
    const c = await connect();
    const ev = { onPlaying: vi.fn(), onEnded: vi.fn(), onFailed: vi.fn() };
    state = at('new', { paused: true });
    c.play('new', ev);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(ev.onFailed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(ev.onFailed).toHaveBeenCalledWith('stalled');
  });

  it('does not report a stall once the song has started', async () => {
    const c = await connect();
    const ev = { onPlaying: vi.fn(), onEnded: vi.fn(), onFailed: vi.fn() };
    state = at('new');
    c.play('new', ev);
    await vi.advanceTimersByTimeAsync(1500);
    expect(ev.onPlaying).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(ev.onFailed).not.toHaveBeenCalled();
  });
});
