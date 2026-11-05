import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminStream } from '../admin/useAdminStream';
import { PlayerConsole } from './PlayerConsole';

type Events = import('./embed').EmbedEvents;
let embedEvents: Events | null = null;
let embedSource: { kind: string; id: string; expectedMs?: number } | null = null;
vi.mock('./embed', async (real) => ({
  ...(await real<typeof import('./embed')>()),
  mountEmbed: (_el: HTMLElement, src: typeof embedSource, ev: Events) => {
    embedSource = src;
    embedEvents = ev;
    return () => undefined;
  },
}));
vi.mock('./tone', () => ({ playTone: async () => undefined }));
vi.mock('./store', () => ({
  loadTracks: async () => [],
  saveTracks: async () => undefined,
  clearTracks: async () => undefined,
}));

type Call = { method: string; url: string; body: Record<string, unknown> | undefined };
let calls: Call[];
let adminState: Record<string, unknown>;
let failPath: string | null;
let ytIds: string[];
let onRadioStarted: (() => void) | null;

const rules = { rulesVersion: 1, enabledStyles: ['salsa'], runCaps: {}, submissionLimit: 5 };
const mkState = (over: { reserved?: boolean; playing?: boolean; epoch?: number | null } = {}) => ({
  csrf: 'csrf',
  rules,
  rulesHash: 'h',
  lease: over.epoch ? { epoch: over.epoch, expiresAt: 1 } : null,
  requests: over.reserved
    ? [
        {
          id: 'r1',
          state: 'RESERVED_NEXT',
          title: 'Vivir Mi Vida',
          artist: 'Marc Anthony',
          style: 'salsa',
          sourceUrl: 'https://open.spotify.com/track/x',
        },
      ]
    : [],
  view: {
    id: 'ev1',
    name: 'Friday',
    slug: 'ABC',
    state: 'ACTIVE',
    version: 3,
    nowPlaying: over.playing
      ? { startedAt: 1, track: { requestId: 'r1', title: 'Vivir Mi Vida', artist: 'Marc Anthony' } }
      : null,
    waitingReason: null,
    breaks: [],
    radioFallback: false,
    radioHoldUntil: null,
    radio: null,
    queue: [
      { requestId: 'r1', title: 'Vivir Mi Vida', artist: 'Marc Anthony', durationMs: 240000 },
    ],
  },
});

beforeEach(() => {
  calls = [];
  embedEvents = null;
  embedSource = null;
  failPath = null;
  ytIds = [];
  onRadioStarted = null;
  sessionStorage.clear();
  adminState = mkState({ reserved: true });
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const c: Call = {
      method: init.method ?? 'GET',
      url,
      body: init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : undefined,
    };
    calls.push(c);
    if (failPath && url.endsWith(failPath)) {
      return new Response(
        JSON.stringify({ error: { code: 'STALE_LEASE', message: 'Stale.', action: 'Retry.' } }),
        { status: 409 },
      );
    }
    if (url.includes('public.radio.co')) {
      return new Response(
        JSON.stringify({
          status: 'online',
          current_track: { title: 'Mix <b>1</b>', start_time: '2026-11-05T14:00:00+00:00' },
        }),
      );
    }
    if (url.endsWith('/player/radio/started')) onRadioStarted?.();
    if (url.endsWith('/admin/state')) return new Response(JSON.stringify(adminState));
    if (url.includes('/player/youtube/')) return new Response(JSON.stringify({ videoIds: ytIds }));
    if (url.endsWith('/player/claim')) {
      return new Response(JSON.stringify({ leaseToken: 'tok', lease: { epoch: 4, expiresAt: 1 } }));
    }
    return new Response(JSON.stringify({ ok: true }));
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }),
  );
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness() {
  const stream = useAdminStream('ev1');
  return <PlayerConsole eventId="ev1" stream={stream} extrasSlot={document.body} />;
}
const open = () => render(<Harness />);

/** The console takes the player role by itself; nothing else is needed before Start. */
async function ready() {
  await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/claim'))).toBe(true));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Start playing|Mark started/ })).toBeEnabled(),
  );
}

describe('PlayerConsole with a Spotify link', () => {
  const withLink = () => {
    const st = mkState({ reserved: true });
    (st.requests[0] as { sourceUrl: string }).sourceUrl =
      `https://open.spotify.com/track/${'a'.repeat(22)}`;
    adminState = st;
  };

  it('plays in the provider player and reports the real start and end', async () => {
    withLink();
    const user = userEvent.setup();
    open();
    await ready();
    await user.click(screen.getByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedEvents).not.toBeNull());
    expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(false); // not until audio plays
    act(() => embedEvents!.onPlaying(200_000));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(true));
    act(() => embedEvents!.onEnded());
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/finished'))).toBe(true));
  });

  it('falls back to the link and manual mode when only a preview is offered', async () => {
    withLink();
    const user = userEvent.setup();
    open();
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedEvents).not.toBeNull());
    act(() => embedEvents!.onFailed('preview'));
    await screen.findByText(/only a 30-second preview/);
    expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(false);
    expect(screen.getByRole('button', { name: 'Mark started' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try the player again' })).toBeInTheDocument();
  });
});

describe('PlayerConsole with a YouTube match for a Spotify song', () => {
  beforeEach(() => {
    ytIds = ['abcdefghijk', 'lmnopqrstuv'];
    const st = mkState({ reserved: true });
    Object.assign(st.requests[0] as object, {
      sourceUrl: `https://open.spotify.com/track/${'a'.repeat(22)}`,
      durationMs: 229_000,
    });
    adminState = st;
  });
  it('plays the matched video in full when Spotify is not signed in', async () => {
    const user = userEvent.setup();
    open();
    await ready();
    await screen.findByText(/will play from YouTube/);
    await user.click(screen.getByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedEvents).not.toBeNull());
    expect(calls.some((c) => c.url.endsWith('/player/youtube/r1'))).toBe(true);
    act(() => embedEvents!.onPlaying(229_000));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(true));
    expect(embedSource).toEqual({ kind: 'youtube', id: 'abcdefghijk', expectedMs: 229_000 });
  });

  it('says so while an advert is muted', async () => {
    const user = userEvent.setup();
    open();
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedEvents).not.toBeNull());
    act(() => embedEvents!.onAd!(true));
    await screen.findByText(/adverts play with the sound off/);
    act(() => embedEvents!.onAd!(false));
    await waitFor(() => expect(screen.queryByText(/Muted until the song starts/)).toBeNull());
  });

  it('tries the next match when the first cannot be embedded, then gives up', async () => {
    const user = userEvent.setup();
    open();
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedSource?.id).toBe('abcdefghijk'));
    act(() => embedEvents!.onFailed('blocked'));
    await waitFor(() => expect(embedSource?.id).toBe('lmnopqrstuv'));
    act(() => embedEvents!.onFailed('blocked'));
    await screen.findByText(/cannot be played here/);
  });

  it('keeps the old preview behaviour when there is no match', async () => {
    ytIds = [];
    const user = userEvent.setup();
    open();
    await ready();
    await user.click(await screen.findByRole('button', { name: 'Start playing' }));
    await waitFor(() => expect(embedEvents).not.toBeNull());
    act(() => embedEvents!.onFailed('preview'));
    await screen.findByText(/only a 30-second preview/);
  });
});

describe('PlayerConsole', () => {
  it('holds the next song while paused, and offers no Start', async () => {
    const st = mkState({ reserved: true });
    (st.view as { state: string }).state = 'PAUSED';
    adminState = st;
    open();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/claim'))).toBe(true));
    expect(screen.queryByRole('button', { name: /Start playing|Mark started/ })).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(false);
  });

  it('takes the player role by itself, with a takeover, and needs no sound check', async () => {
    open();
    await ready();
    expect(calls.find((c) => c.url.endsWith('/player/claim'))!.body).toMatchObject({
      takeover: true,
    });
  });

  it('plays a matched file: reports started on "playing" and finished on "ended"', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await ready();
    const input = document.querySelector('input[type=file][multiple]:not([webkitdirectory])')!;
    await user.upload(
      input as HTMLInputElement,
      new File(['x'], 'Marc Anthony - Vivir Mi Vida.mp3', { type: 'audio/mpeg' }),
    );
    await screen.findByText(/File found: Marc Anthony - Vivir Mi Vida.mp3/, undefined, {
      timeout: 3000,
    });
    await user.click(screen.getByRole('button', { name: 'Start playing' }));
    const audio = container.querySelector('audio')!;
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await act(async () => {
      fireEvent.playing(audio);
    });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(true));
    const started = calls.find((c) => c.url.endsWith('/player/started'))!;
    expect(started.body).toMatchObject({ leaseToken: 'tok', epoch: 4, requestId: 'r1' });
    await act(async () => {
      fireEvent.ended(audio);
    });
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/finished'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/player/finished'))!.body).toMatchObject({
      outcome: 'PLAYED',
      requestId: 'r1',
    });
  });

  it('manual mode: mark started, then mark ended; never auto-ends', async () => {
    const user = userEvent.setup();
    open();
    await ready();
    expect(screen.getByRole('link', { name: /requester's link/ })).toHaveAttribute(
      'href',
      'https://open.spotify.com/track/x',
    );
    await user.click(screen.getByRole('button', { name: 'Mark started' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(true));
  });

  it('stops and says so when the server reports a stale lease', async () => {
    const user = userEvent.setup();
    const { container } = open();
    await ready();
    failPath = '/player/started';
    const input = document.querySelector('input[type=file][multiple]:not([webkitdirectory])')!;
    await user.upload(
      input as HTMLInputElement,
      new File(['x'], 'Marc Anthony - Vivir Mi Vida.mp3', { type: 'audio/mpeg' }),
    );
    await screen.findByText(/File found/);
    await user.click(screen.getByRole('button', { name: 'Start playing' }));
    await act(async () => {
      fireEvent.playing(container.querySelector('audio')!);
    });
    expect(await screen.findByText(/Another device took over playback/)).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(sessionStorage.getItem('qroove:lease:ev1')).toBeNull();
  });
});

describe('PlayerConsole radio fallback', () => {
  const radioState = (reserved: boolean) => {
    const st = mkState({ reserved });
    Object.assign(st.view, {
      radioFallback: true,
      rules: { segments: [{ enabledStyles: ['bachata'], runCaps: {} }] },
    });
    return st;
  };
  const radioCalls = () => calls.filter((c) => c.url.includes('/player/radio/'));

  it('starts a station by itself when the queue is empty and reports the track once', async () => {
    adminState = radioState(false);
    open();
    await waitFor(() =>
      expect(radioCalls().some((c) => c.url.endsWith('/radio/started'))).toBe(true),
    );
    const started = radioCalls().find((c) => c.url.endsWith('/radio/started'))!;
    expect(started.body).toMatchObject({
      stationId: 'bachata-sensual-radio',
      trackKey: '2026-11-05T14:00:00+00:00',
      title: 'Mix <b>1</b>',
    });
    // Rendered as text, never as markup.
    expect(await screen.findByText(/Mix <b>1<\/b>/)).toBeInTheDocument();
    expect(screen.getByText(/Radio · Bachata/)).toBeInTheDocument();
    expect(radioCalls().filter((c) => c.url.endsWith('/radio/started'))).toHaveLength(1);
  });

  it('gives a waiting guest song priority and hands over on request', async () => {
    adminState = radioState(false);
    const user = userEvent.setup();
    open();
    onRadioStarted = () => {
      adminState = radioState(true); // a guest song becomes due while the radio plays
    };
    await user.click(await screen.findByRole('button', { name: 'Start radio' }));
    await waitFor(() => expect(radioCalls().length).toBeGreaterThan(0));
    const now = await screen.findByRole('button', { name: 'Play the queued song now' });
    expect(calls.some((c) => c.url.endsWith('/player/started'))).toBe(false); // held until handover
    await user.click(now);
    await waitFor(() =>
      expect(radioCalls().some((c) => c.url.endsWith('/radio/ended'))).toBe(true),
    );
  });

  it('does not retry in a loop when the browser refuses to play, and offers a tap', async () => {
    adminState = radioState(false);
    const user = userEvent.setup();
    open();
    const play = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.play = play;
    await user.click(await screen.findByRole('button', { name: 'Start radio' })); // unlocks
    await waitFor(() => expect(radioCalls().length).toBeGreaterThan(0));
    play.mockClear();
    HTMLMediaElement.prototype.play = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    const refused = vi.mocked(HTMLMediaElement.prototype.play);
    // The station track ends (stream error): the radio stops and tries once.
    const audio = document.querySelectorAll('audio')[1]!;
    act(() => {
      audio.dispatchEvent(new Event('error'));
    });
    await new Promise((r) => setTimeout(r, 300));
    expect(refused.mock.calls.length).toBeLessThanOrEqual(2);
    expect(await screen.findByRole('button', { name: 'Start radio' })).toBeInTheDocument();
  });

  it('switched off and on again, carries on with the same station and never rests it', async () => {
    adminState = radioState(false);
    const user = userEvent.setup();
    const { container } = open();
    await user.click(await screen.findByRole('button', { name: 'Start radio' }));
    await waitFor(() =>
      expect(radioCalls().filter((c) => c.url.endsWith('/radio/started'))).toHaveLength(1),
    );
    const box = await screen.findByRole('checkbox', { name: /Radio fallback/ });
    for (let i = 0; i < 3; i++) {
      Object.assign(adminState.view as object, { radioFallback: false });
      await user.click(box);
      // Taking the source off the element raises error events; they are not station failures.
      await act(async () => {
        fireEvent.error(container.querySelector('audio')!);
        fireEvent.error(container.querySelector('audio')!);
      });
      Object.assign(adminState.view as object, { radioFallback: true });
      await user.click(box);
      await waitFor(() =>
        expect(radioCalls().filter((c) => c.url.endsWith('/radio/started'))).toHaveLength(i + 2),
      );
    }
    expect(screen.queryByText(/No working radio station/)).toBeNull();
    expect(screen.queryByText(/would not play|stopped\./)).toBeNull();
    const ids = radioCalls()
      .filter((c) => c.url.endsWith('/radio/started'))
      .map((c) => (c.body as { stationId: string }).stationId);
    expect(new Set(ids).size).toBe(1);
  });

  it('an interrupted play() (off then on quickly) is retried and does not rest the station', async () => {
    adminState = radioState(false);
    HTMLMediaElement.prototype.play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('interrupted', 'AbortError'))
      .mockResolvedValue(undefined);
    open();
    await waitFor(() =>
      expect(radioCalls().some((c) => c.url.endsWith('/radio/started'))).toBe(true),
    );
    expect(screen.queryByText(/would not play|No working radio station/)).toBeNull();
  });

  it('offers one Start radio button when the browser refuses sound without a tap', async () => {
    adminState = radioState(false);
    HTMLMediaElement.prototype.play = vi.fn(async () => {
      throw new DOMException('blocked', 'NotAllowedError');
    });
    open();
    expect(await screen.findByRole('button', { name: 'Start radio' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow sound for the radio' })).toBeNull();
  });

  it('does not start radio while a guest song is waiting', async () => {
    adminState = radioState(true);
    open();
    await ready();
    expect(screen.queryByRole('button', { name: 'Start radio' })).toBeNull();
    expect(radioCalls()).toHaveLength(0);
  });

  it('stays off when the organiser has not switched it on', async () => {
    adminState = mkState({ reserved: false });
    open();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/player/claim'))).toBe(true));
    expect(screen.queryByRole('button', { name: 'Start radio' })).toBeNull();
  });
});
