import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminEntry from './AdminEntry';
import AdminPage from './AdminPage';
import CreateEvent from './CreateEvent';

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
let calls: Call[];
let respond: (c: Call) => { status?: number; body: unknown };

beforeEach(() => {
  calls = [];
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const c = {
      method: init.method ?? 'GET',
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rules = {
  rulesVersion: 3,
  segments: [
    {
      enabledStyles: ['salsa', 'bachata'],
      masterRunCap: 2,
      runCaps: { salsa: 2, bachata: 2 },
    },
  ],
  submissionLimit: 5,
  minStyleTransitions: 1,
  noSameRequesterAdjacent: true,
  recordingUniquePerEvent: true,
  admissionOrder: 'fifo',
};
const track = (id: string, title: string, over = {}) => ({
  requestId: id,
  title,
  artist: 'A',
  style: 'salsa',
  durationMs: null,
  artworkUrl: null,
  ownerNickname: null,
  position: 1,
  overflow: false,
  ...over,
});
const state = (over: Record<string, unknown> = {}, viewOver: Record<string, unknown> = {}) => ({
  csrf: 'csrf-token',
  rulesHash: 'abcdef0123456789',
  rules,
  plannedDurationMin: 120,
  joinUrl: 'http://x/e/ABC123',
  lease: null,
  requests: [
    {
      id: 'r1',
      state: 'RESERVED_NEXT',
      title: 'Next Song',
      artist: 'A',
      style: 'salsa',
      ownerNickname: 'Ana',
      ownerLabel: 'AB12',
      acceptedSeq: 1,
      possibleDuplicate: false,
      removedReason: null,
      sourceUrl: null,
    },
    {
      id: 'r2',
      state: 'PENDING_METADATA',
      title: 'Maybe Same',
      artist: 'B',
      style: 'bachata',
      ownerNickname: null,
      ownerLabel: 'CD34',
      acceptedSeq: 2,
      possibleDuplicate: true,
      removedReason: null,
      sourceUrl: null,
    },
    {
      id: 'r3',
      state: 'PLAYED',
      title: 'Old Song',
      artist: 'C',
      style: 'salsa',
      ownerNickname: null,
      ownerLabel: 'EF56',
      acceptedSeq: 0,
      possibleDuplicate: false,
      removedReason: null,
      sourceUrl: null,
    },
  ],
  view: {
    id: 'ev1',
    name: 'Friday Social',
    slug: 'ABC123',
    state: 'ACTIVE',
    timezone: 'UTC',
    endAt: null,
    serverNow: 0,
    version: 5,
    rules,
    nowPlaying: { track: track('p1', 'Playing Now'), startedAt: 1 },
    waitingReason: null,
    runIndicator: { style: 'salsa', runLength: 1, cap: 2 },
    breaks: [],
    preview: {
      revision: 1,
      items: [
        { requestId: 'r1', position: 1, predictedStartMs: 1, uncertain: false, overflow: false },
        { requestId: 'late', position: 2, predictedStartMs: null, uncertain: true, overflow: true },
      ],
      stoppedReason: 'EXHAUSTED',
      computedAt: 0,
    },
    queue: [track('r1', 'Next Song'), track('late', 'Late', { overflow: true, position: 2 })],
    ...viewOver,
  },
  ...over,
});

const page = (path = '/admin/ev1') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admin/:eventId" element={<AdminPage />} />
        <Route path="/a/:eventId" element={<AdminEntry mode="link" />} />
        <Route path="/new" element={<CreateEvent />} />
      </Routes>
    </MemoryRouter>,
  );

describe('CreateEvent', () => {
  const created = {
    status: 201,
    body: {
      eventId: 'ev1',
      slug: 'ABC123',
      name: 'Mango Octopus Rye',
      joinUrl: 'http://x/e/ABC123',
      adminUrl: 'http://x/a/ev1#k=SECRETSECRET',
      recoverySecret: 'RECOVERYRECOVERY',
      rules,
      seeded: 0,
    },
  };
  /** Create, then the entry route signs in, then the organiser page loads its state. */
  const flow = (c: Call) =>
    c.url === '/api/events'
      ? created
      : c.url.endsWith('/admin/session')
        ? { body: { ok: true, csrf: 'c' } }
        : { body: state() };
  const wheel = (name: string) => screen.getByRole('spinbutton', { name });
  const styleBox = (name: string) => screen.getByRole('checkbox', { name });

  it('has no event-name field, a 2:00 time drum, and the default styles', async () => {
    respond = flow;
    page('/new');
    expect(screen.queryByLabelText(/event name/i)).toBeNull();
    expect(wheel('Total duration')).toHaveAttribute('aria-valuetext', '2:00');
    expect(styleBox('Salsa')).toHaveAttribute('aria-checked', 'true');
    expect(styleBox('Non-Latin salsa-compatible')).toHaveAttribute('aria-checked', 'true');
    expect(styleBox('Bachata')).toHaveAttribute('aria-checked', 'true');
    expect(styleBox('Non-Latin bachata-compatible')).toHaveAttribute('aria-checked', 'true');
    expect(styleBox('Cha-cha')).toHaveAttribute('aria-checked', 'false');
    expect(styleBox('Other (Musicality Exercise)')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
  });

  it('sends the drum choices and a break tapped on the bar, and shows the generated name', async () => {
    respond = flow;
    Element.prototype.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 360,
        bottom: 52,
        width: 360,
        height: 52,
        x: 0,
        y: 0,
        toJSON() {},
      }) as DOMRect;
    const user = userEvent.setup();
    page('/new');
    await user.click(screen.getByRole('switch')); // independent: the time must not touch songs each
    wheel('Total duration').focus();
    await user.keyboard('{ArrowDown}'); // 2:00 -> 2:30
    expect(wheel('Total duration')).toHaveAttribute('aria-valuetext', '2:30');
    await user.click(styleBox('Cha-cha'));
    wheel('Songs per person').focus();
    await user.keyboard('{ArrowDown}{ArrowDown}'); // 20 -> 30, which 2:30 allows
    // Press and hold the part: the break goes to its middle (2:30 -> 75 min, centred on 10).
    fireEvent.keyDown(screen.getAllByRole('button', { name: /^Part/ })[0]!, { key: 'b' });
    expect(screen.getAllByRole('button', { name: /^Part/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Part 2 of 2/ })); // a plain tap selects it
    await user.click(styleBox('Bachata')); // part two drops bachata
    await user.click(screen.getByRole('button', { name: 'Create event' }));
    // Straight to the organiser page: no interstitial with a link or a recovery secret.
    expect(await screen.findByRole('heading', { name: 'Friday Social' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Save this link|RECOVERY|SECRETSECRET/);
    const session = calls.find((c) => c.url.endsWith('/admin/session'))!;
    expect(session.url).toBe('/api/events/ev1/admin/session');
    expect(session.body).toEqual({ secret: 'SECRETSECRET' });
    const body = calls[0]!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('name');
    expect(body).toMatchObject({
      plannedDurationMin: 150,
      submissionLimit: 30,
      breaks: [{ startMin: 70, durationSec: 600 }],
    });
    const segs = body.segments as Array<{ enabledStyles: string[] }>;
    expect(segs).toHaveLength(2);
    expect(segs[0]!.enabledStyles).toEqual([
      'salsa',
      'salsa_nl',
      'bachata',
      'bachata_nl',
      'chacha',
    ]);
    expect(segs[1]!.enabledStyles).toEqual(['salsa', 'salsa_nl', 'bachata_nl', 'chacha']);
  });

  it('defaults to 1:1, stops at 3, and scales songs per person with the planned time', async () => {
    respond = flow;
    const user = userEvent.setup();
    page('/new');
    await user.click(styleBox('Cha-cha')); // three genres
    await user.click(screen.getByLabelText('Ratio between genres'));
    for (const g of ['salsa', 'bachata', 'chacha']) {
      expect(wheel(`Ratio ${g}`)).toHaveAttribute('aria-valuenow', '1');
    }
    wheel('Ratio bachata').focus();
    await user.keyboard('{End}');
    expect(wheel('Ratio bachata')).toHaveAttribute('aria-valuenow', '3');
    const songs = wheel('Songs per person');
    expect(songs).toHaveAttribute('aria-valuenow', '20');
    songs.focus();
    await user.keyboard('{End}');
    expect(songs).toHaveAttribute('aria-valuenow', '40'); // the default 2 hours allow 40
  });

  it('needs at least one style in every part', async () => {
    respond = flow;
    const user = userEvent.setup();
    page('/new');
    for (const s of [
      'Salsa',
      'Non-Latin salsa-compatible',
      'Bachata',
      'Non-Latin bachata-compatible',
    ]) {
      await user.click(styleBox(s));
    }
    expect(await screen.findByText('Pick at least one style.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled();
  });

  describe('planner parameters and preview', () => {
    const DURATIONS = [
      '0:15',
      '0:30',
      '0:45',
      '1:00',
      '1:30',
      '2:00',
      '2:30',
      '3:00',
      '3:30',
      '4:00',
      '5:00',
      '6:00',
      '7:00',
      '8:00',
    ];

    it('offers the planned times 0:15 to 8:00, and sends the chosen one as minutes', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      wheel('Total duration').focus();
      await user.keyboard('{Home}');
      const seen: string[] = [wheel('Total duration').getAttribute('aria-valuetext')!];
      for (let i = 1; i < DURATIONS.length; i++) {
        await user.keyboard('{ArrowDown}');
        seen.push(wheel('Total duration').getAttribute('aria-valuetext')!);
      }
      expect(seen).toEqual(DURATIONS);
      await user.keyboard(
        '{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}{ArrowUp}',
      ); // 8:00 -> 1:30
      expect(wheel('Total duration')).toHaveAttribute('aria-valuetext', '1:30');
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      await screen.findByRole('heading', { name: 'Friday Social' });
      expect(calls.find((c) => c.url === '/api/events')!.body).toMatchObject({
        plannedDurationMin: 90,
        submissionLimit: 30, // synced: 5 songs per quarter hour
      });
    });

    it('sends the songs in a row and the songs per person that were chosen', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      await user.click(screen.getByRole('switch'));
      wheel('Songs in a row').focus();
      await user.keyboard('{ArrowDown}'); // 1 -> 2
      wheel('Songs per person').focus();
      await user.keyboard('{ArrowDown}'); // 20 -> 25
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      await screen.findByRole('heading', { name: 'Friday Social' });
      const body = calls.find((c) => c.url === '/api/events')!.body as {
        masterRunCap: number;
        submissionLimit: number;
        segments: Array<{ masterRunCap: number }>;
      };
      expect(body).toMatchObject({ masterRunCap: 2, submissionLimit: 25 });
      expect(body.segments[0]!.masterRunCap).toBe(2);
    });

    it('while synced, a new planned time sets songs per person: 5 for each quarter hour, 5 to 50', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      expect(screen.getByRole('switch')).toBeChecked();
      expect(screen.getByText('Synced parameters')).toBeInTheDocument();
      // Nothing is recalculated until the time is changed: the default stays as it is.
      expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', '20');
      wheel('Total duration').focus();
      for (const [key, mins, songs] of [
        ['{Home}', '0:15', '5'],
        ['{ArrowDown}', '0:30', '10'],
        ['{ArrowDown}{ArrowDown}', '1:00', '20'],
        ['{End}', '8:00', '50'],
      ] as const) {
        await user.keyboard(key);
        expect(wheel('Total duration')).toHaveAttribute('aria-valuetext', mins);
        expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', songs);
      }
    });

    it('in independent mode the time leaves a manual choice alone, and switching sync back on changes nothing by itself', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      await user.click(screen.getByRole('switch'));
      expect(screen.getByText('Independent control')).toBeInTheDocument();
      wheel('Songs per person').focus();
      await user.keyboard('{ArrowDown}'); // 20 -> 25
      wheel('Total duration').focus();
      await user.keyboard('{Home}');
      expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', '5'); // the 0:15 ceiling
      await user.keyboard('{End}');
      expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', '25'); // the manual choice returns
      wheel('Songs per person').focus();
      await user.keyboard('{End}');
      const manual = wheel('Songs per person').getAttribute('aria-valuenow');
      await user.click(screen.getByRole('switch')); // synced again
      expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', manual!);
      wheel('Total duration').focus();
      await user.keyboard('{ArrowUp}'); // 7:00 -> the next change recomputes
      expect(wheel('Songs per person')).toHaveAttribute('aria-valuenow', '50');
    });

    it('shows the ratio, an approximate song count, and a legend that follows the genres', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      expect(screen.getByTestId('ratio-badge')).toHaveTextContent('Ratio: 1 : 1');
      expect(screen.getByTestId('summary-badge')).toHaveTextContent(
        '2:00 total | about 24–35 songs',
      );
      const legend = screen.getByRole('list', { name: 'Legend' });
      expect(within(legend).getAllByRole('listitem')).toHaveLength(4);
      await user.click(styleBox('Cha-cha'));
      expect(screen.getByTestId('ratio-badge')).toHaveTextContent('Ratio: 1 : 1 : 1');
      expect(within(legend).getByText('Cha-cha')).toBeInTheDocument();
      // The same sequence is also written out, for anyone who cannot tell the colours apart.
      await user.click(screen.getByText('The rotation as text'));
      expect(screen.getByText(/^Salsa, Bachata, Cha-cha, Salsa/)).toBeInTheDocument();
    });

    it('draws the bar from the real rotation: runs follow songs in a row, and non-Latin follows its parent', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      await user.click(styleBox('Non-Latin salsa-compatible'));
      await user.click(styleBox('Non-Latin bachata-compatible'));
      wheel('Songs in a row').focus();
      await user.keyboard('{ArrowDown}'); // 2 in a row
      await user.click(screen.getByText('The rotation as text'));
      expect(screen.getByText(/^Salsa ×2, Bachata ×2, Salsa ×2/)).toBeInTheDocument();
      const bar = screen.getByRole('img', { name: /^Rotation preview/ });
      expect(bar.querySelectorAll('.flow-song').length).toBeGreaterThan(20);
      expect(bar.querySelectorAll('.flow-song.striped')).toHaveLength(0);
      await user.click(styleBox('Non-Latin salsa-compatible'));
      expect(bar.querySelectorAll('.flow-song.striped').length).toBeGreaterThan(0);
    });

    it('explains an empty selection and will not create the event', async () => {
      respond = flow;
      const user = userEvent.setup();
      page('/new');
      for (const s of [
        'Salsa',
        'Non-Latin salsa-compatible',
        'Bachata',
        'Non-Latin bachata-compatible',
      ]) {
        await user.click(styleBox(s));
      }
      expect(
        screen.getByText('Select at least one genre to see the rotation.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('ratio-badge')).toHaveTextContent('Ratio: none');
      expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled();
      expect(screen.getAllByText(/at least one style/i).length).toBeGreaterThan(0);
    });

    it('keeps everything and shows the real error when creating fails, and sends one request', async () => {
      respond = (c) =>
        c.url === '/api/events'
          ? {
              status: 500,
              body: {
                error: { code: 'INTERNAL', message: 'The server tripped.', action: 'Try again.' },
              },
            }
          : flow(c);
      const user = userEvent.setup();
      page('/new');
      wheel('Total duration').focus();
      await user.keyboard('{ArrowDown}');
      await user.click(styleBox('Cha-cha'));
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('The server tripped. Try again.');
      expect(calls.filter((c) => c.url === '/api/events')).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'Friday Social' })).toBeNull();
      expect(wheel('Total duration')).toHaveAttribute('aria-valuetext', '2:30');
      expect(styleBox('Cha-cha')).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
    });
  });

  describe('playlists', () => {
    const SPOT = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
    const APPLE = 'https://music.apple.com/us/playlist/hits/pl.f4d106fed2bd41149aaacabb233eb5eb';
    const link = (style: string) => screen.getByLabelText(`Playlist link for ${style}`);
    const tracks = (prefix: string, n: number, mins = 4) =>
      Array.from({ length: n }, (_, i) => ({
        title: `${prefix} ${i}`,
        artist: 'Band',
        durationMs: mins * 60_000,
        sourceUrl: null,
      }));
    /** The create flow, plus playlist resolution: Spotify links are salsa-ish, Apple ones the rest. */
    const withPlaylists = (c: Call) =>
      c.url === '/api/resolve-playlist'
        ? {
            body: {
              tracks: tracks(
                String(c.body && (c.body as { url: string }).url).includes('spotify') ? 'Sp' : 'Ap',
                6,
              ),
            },
          }
        : flow(c);

    it('lays the fields out like the style grid, one per active style', () => {
      respond = flow;
      page('/new#playlist');
      const labels = screen
        .getAllByLabelText(/Playlist link for/)
        .map((i) => i.getAttribute('aria-label')!.replace('Playlist link for ', ''));
      expect(labels).toEqual([
        'Salsa',
        'Non-Latin salsa-compatible',
        'Bachata',
        'Non-Latin bachata-compatible',
      ]);
      expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled(); // none is fine
    });

    it('loads a pasted link into a sortable list, and needs songs for every active genre', async () => {
      respond = withPlaylists;
      const user = userEvent.setup();
      page('/new#playlist');
      await user.type(link('Salsa'), SPOT);
      const list = await screen.findByRole('list', { name: 'Playlist songs' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(6);
      expect((await screen.findAllByText(/at least one playlist song/i)).length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled();
      // A non-Latin style's playlist covers the genre of its Latin counterpart and vice versa.
      await user.type(link('Non-Latin bachata-compatible'), APPLE);
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(12));
      await waitFor(() =>
        expect(screen.queryAllByText(/at least one playlist song/i)).toHaveLength(0),
      );
      expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      await screen.findByRole('heading', { name: 'Friday Social' });
      const body = calls.find((c) => c.url === '/api/events')!.body as {
        songs: Array<{ title: string; style: string }>;
        playlists?: unknown;
      };
      expect(body.playlists).toBeUndefined();
      expect(body.songs).toHaveLength(12); // 12 x 4 min = 48 min fits in 2 h
      expect(new Set(body.songs.map((x) => x.style))).toEqual(new Set(['salsa', 'bachata_nl']));
      // The two playlists are mixed, so neither is stuck behind the other.
      expect(body.songs.slice(0, 4).map((x) => x.style)).toEqual([
        'salsa',
        'bachata_nl',
        'salsa',
        'bachata_nl',
      ]);
    });

    it('greys out songs that do not fit the planned time minus a minute, and sends only the rest', async () => {
      respond = withPlaylists;
      const user = userEvent.setup();
      page('/new#playlist');
      screen.getByRole('spinbutton', { name: 'Total duration' }).focus();
      await user.keyboard('{Home}'); // 0:15, so 14 minutes of music: three four-minute songs
      await user.type(link('Salsa'), SPOT);
      await user.type(link('Bachata'), APPLE);
      const list = await screen.findByRole('list', { name: 'Playlist songs' });
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(12));
      const rows = within(list).getAllByRole('listitem');
      expect(rows.filter((r) => r.className.includes('over'))).toHaveLength(9);
      expect(rows[2]!.className).not.toContain('over');
      expect(rows[3]!.className).toContain('over');
      // 3 songs from two genres: one genre is missing from the first three? They alternate, so both are in.
      expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
      await user.click(screen.getByRole('button', { name: 'Create event' }));
      await screen.findByRole('heading', { name: 'Friday Social' });
      const body = calls.find((c) => c.url === '/api/events')!.body as { songs: unknown[] };
      expect(body.songs).toHaveLength(3);
    });

    it('asks for cha-cha songs too once it is selected', async () => {
      respond = withPlaylists;
      const user = userEvent.setup();
      page('/new#playlist');
      await user.type(link('Salsa'), SPOT);
      await user.type(link('Bachata'), APPLE);
      const list = await screen.findByRole('list', { name: 'Playlist songs' });
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(12));
      expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled();
      await user.click(styleBox('Cha-cha'));
      expect(screen.getByRole('button', { name: 'Create event' })).toBeDisabled();
      await user.type(link('Cha-cha'), APPLE);
      await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(18));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Create event' })).toBeEnabled(),
      );
    });
  });
});

describe('AdminEntry', () => {
  it('exchanges the fragment secret and then removes it from the address bar', async () => {
    respond = (c) =>
      c.url.endsWith('/admin/session') ? { body: { ok: true, csrf: 'c' } } : { body: state() };
    const replace = vi.spyOn(history, 'replaceState');
    page('/a/ev1#k=' + 'S'.repeat(32));
    expect(await screen.findByRole('heading', { name: 'Friday Social' })).toBeInTheDocument();
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/events/ev1/admin/session',
      body: { secret: 'S'.repeat(32) },
    });
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls[0]![2])).not.toContain('S'.repeat(32));
  });
  it('explains an incomplete link', async () => {
    respond = () => ({ body: {} });
    page('/a/ev1');
    expect(await screen.findByText(/must include everything after the “#”/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });
});

describe('AdminPage', () => {
  const ok = (extra?: (c: Call) => { status?: number; body: unknown } | undefined) => {
    respond = (c) =>
      extra?.(c) ?? (c.method === 'GET' ? { body: state() } : { body: { ok: true, version: 6 } });
  };

  it('starts a draft event by itself when the organiser page opens, once', async () => {
    ok((c) =>
      c.method === 'GET' ? { body: state({}, { state: 'DRAFT' }) } : { body: { ok: true } },
    );
    page();
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/start'))).toBe(true));
    expect(calls.filter((c) => c.url.endsWith('/start'))).toHaveLength(1);
  });

  it('does not start an event that is already running', async () => {
    ok();
    page();
    await screen.findByRole('region', { name: 'Playback' });
    expect(calls.some((c) => c.url.endsWith('/start'))).toBe(false);
  });

  it('has three pages: the invite page shows the room code and a backup QR', async () => {
    ok();
    const user = userEvent.setup();
    page();
    expect(await screen.findByRole('region', { name: 'Playback' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Salsa' }).length).toBeGreaterThan(0); // the run, as a swatch
    expect(screen.getByText(/1\/2/)).toBeInTheDocument();
    expect(screen.getByText(/1 song would run past the end/)).toBeInTheDocument();
    expect(screen.getAllByText(/Next Song/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Invite' }));
    expect(screen.getByRole('img', { name: /QR code to join Friday Social/ })).toBeInTheDocument();
    // The permanent room code is shown as two triplets, with the QR as a backup.
    expect(screen.getByText('ABC-123')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Rules' }));
    expect(screen.getByText(/abcdef012345/)).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Bachata' })[0]).toBeInTheDocument(); // rules show swatches
    expect(screen.getByText(/songs each/)).toHaveTextContent('5');
    expect(document.body.textContent).not.toContain('csrf-token');
  });

  it('keeps playing + queue on one page, the QR on another, and the rest on a third', async () => {
    ok();
    page();
    await screen.findByRole('region', { name: 'Playback' });
    const pages = screen.getAllByRole('tabpanel');
    expect(pages.map((p) => p.getAttribute('aria-label'))).toEqual(['Playing', 'Invite', 'More']);
    expect(within(pages[0]!).getByRole('region', { name: 'Playback' })).toBeInTheDocument();
    expect(within(pages[0]!).getByRole('region', { name: 'Queue' }).className).toContain('queue');
    expect(within(pages[1]!).getByRole('img', { name: /QR code/ })).toBeInTheDocument();
    expect(within(pages[1]!).queryByRole('region', { name: 'Playback' })).toBeNull(); // swiping shows the QR instead
    const pause = screen.getByRole('button', { name: 'Pause At End of Current Song' });
    expect(pause).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.getAttribute('aria-label'))).toEqual([
      'Playing',
      'Invite',
      'More',
    ]);
  });

  it('sends the CSRF header on commands, and confirms before skipping', async () => {
    ok();
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: 'Pause At End of Current Song' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/pause'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/admin/pause'))!.headers['x-qroove-csrf']).toBe(
      'csrf-token',
    );
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(calls.some((c) => c.url.endsWith('/admin/skip'))).toBe(false);
    expect(screen.getByRole('alert')).toHaveTextContent(/song will be lost/);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Yes, skip' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/skip'))).toBe(true));
  });

  it('removes with confirmation, and resolves a possible duplicate', async () => {
    ok();
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('button', { name: 'Remove Next Song' }));
    expect(calls.some((c) => c.url.includes('/admin/remove/'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/remove/r1'))).toBe(true));
    await user.click(screen.getByRole('button', { name: 'Distinct' }));
    await waitFor(() =>
      expect(calls.find((c) => c.url.endsWith('/admin/duplicate/r2'))?.body).toEqual({
        decision: 'approve',
      }),
    );
    expect(screen.queryByRole('button', { name: /Remove Old Song/ })).toBeNull(); // played songs stay
  });

  it('ends the event with two distinct clicks and no typing', async () => {
    ok();
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('tab', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'End the event' })); // opens the section
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'End event' })); // click 1
    expect(calls.some((c) => c.url.endsWith('/admin/end'))).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, end the event now' })); // click 2
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/end'))).toBe(true));
  });

  it('shows a handover link once, and rejects past or non-extending end times', async () => {
    ok((c) =>
      c.url.endsWith('/admin/handover')
        ? { body: { code: 'ABCD1234EFGH5678', expiresAt: 600_000 } }
        : undefined,
    );
    const user = userEvent.setup();
    page();
    await user.click(await screen.findByRole('tab', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Hand over' }));
    await user.click(screen.getByRole('button', { name: 'Hand over admin' }));
    await user.click(screen.getByRole('button', { name: 'Yes, create a handover link' }));
    expect(await screen.findByText(/\/claim\/ev1#c=ABCD1234EFGH5678/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Time' }));
    const input = screen.getByLabelText('Set an end time');
    await user.type(input, '2001-01-01T10:00');
    expect(screen.getByText(/Pick a real time later than now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set' })).toBeDisabled();
  });

  it('runs breaks and shows the carry-over list after the event ends', async () => {
    const brk = {
      id: 'b1',
      label: '10-minute break',
      durationSec: 600,
      startsAt: null,
      actualStart: null,
      actualEnd: null,
    };
    ok((c) => {
      if (c.url.endsWith('/admin/carry-over'))
        return {
          body: {
            formatVersion: 1,
            name: 'Friday Social',
            rules,
            recommendations: [
              {
                title: 'Left Over',
                artist: null,
                style: 'salsa',
                durationMs: null,
                sourceUrl: null,
              },
            ],
          },
        };
      if (c.method === 'GET') return { body: state({}, { breaks: [brk], state: 'ENDED' }) };
      return undefined;
    });
    page();
    expect(await screen.findByText('Left Over')).toBeInTheDocument();
    expect(screen.getByLabelText('Shuffle within each style')).toBeChecked();
    expect(screen.queryByRole('button', { name: 'Start break' })).toBeNull(); // ended: no break controls
    expect(screen.queryByRole('button', { name: 'End event' })).toBeNull();
    const user = userEvent.setup();
    respond = (c) =>
      c.url.endsWith('/events/import')
        ? {
            status: 201,
            body: {
              eventId: 'ev2',
              slug: 'ZZZ999',
              joinUrl: 'j',
              adminUrl: 'http://x/a/ev2#k=NEWSECRETNEWSECRET',
              recoverySecret: 'r'.repeat(20),
              seeded: 1,
            },
          }
        : c.url.endsWith('/carry-over')
          ? {
              body: {
                formatVersion: 1,
                name: 'Friday Social',
                rules,
                recommendations: [
                  {
                    title: 'Left Over',
                    artist: null,
                    style: 'salsa',
                    durationMs: null,
                    sourceUrl: null,
                  },
                ],
              },
            }
          : { body: state({}, { state: 'ENDED' }) };
    await user.click(screen.getByRole('button', { name: 'Create event from these' }));
    const imp = calls.find((c) => c.url.endsWith('/events/import'))!;
    expect(imp.body).toMatchObject({
      shuffle: true,
      selectedIndexes: [0],
      name: 'Friday Social (next)',
      plannedDurationMin: 120,
    });
    expect(await screen.findByRole('heading', { name: 'Friday Social' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Save this link|RECOVERY/);
    void within;
  });

  it('explains lost access plainly, with no recovery form', async () => {
    respond = () => ({
      status: 401,
      body: {
        error: {
          code: 'UNAUTHORISED',
          message: 'You do not have permission to do that.',
          action: 'Open the link you were given, or ask the organiser.',
        },
      },
    });
    page();
    expect(await screen.findByText(/You do not have organiser access/)).toBeInTheDocument();
    expect(
      screen.getByText(/ask the current organiser to hand the event over/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/recovery/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /recover/i })).toBeNull();
  });
});
