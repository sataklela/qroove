import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Layout } from '../shared/Layout';
import { MenuProvider } from '../shared/menu';
import { EventPage } from './EventPage';

const baseView = {
  id: 'ev1',
  name: 'Friday Social',
  slug: 'ABC123',
  state: 'ACTIVE',
  timezone: 'UTC',
  endAt: null,
  serverNow: Date.now(),
  version: 1,
  rules: {
    rulesVersion: 3,
    segments: [
      { enabledStyles: ['salsa', 'bachata'], masterRunCap: 2, runCaps: { salsa: 2, bachata: 2 } },
    ],
    submissionLimit: 5,
  },
  nowPlaying: null,
  waitingReason: null,
  runIndicator: null,
  breaks: [],
  preview: { revision: 1, items: [], stoppedReason: 'EXHAUSTED', computedAt: 0 },
  queue: [
    {
      requestId: 'q1',
      title: 'Someone Else',
      artist: 'X',
      style: 'salsa',
      durationMs: null,
      artworkUrl: null,
      ownerNickname: 'Secret Name',
      position: 1,
      overflow: false,
    },
    {
      requestId: 'q2',
      title: 'Late Song',
      artist: null,
      style: 'bachata',
      durationMs: null,
      artworkUrl: null,
      ownerNickname: null,
      position: 2,
      overflow: true,
    },
  ],
};

type Handler = (url: string, init: RequestInit) => { status?: number; body: unknown };
let handler: Handler;
const calls: Array<{ url: string; init: RequestInit }> = [];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  calls.length = 0;
  vi.stubGlobal('EventSource', undefined);
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/e/ABC123']}>
      <MenuProvider>
        <Layout>
          <Routes>
            <Route path="/e/:slug" element={<EventPage />} />
          </Routes>
        </Layout>
      </MenuProvider>
    </MemoryRouter>,
  );

describe('EventPage', () => {
  it('shows the live queue without other attendees’ names, and the overflow label', async () => {
    handler = (url) =>
      url.includes('by-slug') ? { body: { eventId: 'ev1', slug: 'ABC123' } } : { body: baseView };
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Friday Social' })).toBeInTheDocument();
    // The queue lists it, and so does the Next up card.
    expect(screen.getAllByText('Someone Else').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Secret Name/)).toBeNull();
    expect(screen.getByText('After end time')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join this event' })).toBeInTheDocument();
  });

  it('shows the event name in the header: tiny, lower-case, hyphenated, and not selectable', async () => {
    handler = (url) =>
      url.includes('by-slug')
        ? { body: { eventId: 'ev1', slug: 'ABC123' } }
        : { body: { ...baseView, name: 'Mango Octopus Rye' } };
    const { container } = renderPage();
    await screen.findAllByText('Someone Else');
    // The header is filled from an effect, which can land just after the page's own content.
    await waitFor(() => expect(container.querySelector('.topbar .event-token')).not.toBeNull());
    const token = container.querySelector('.topbar .event-token')!;
    const label = token.querySelector('[aria-hidden]')!;
    expect(label.textContent).toBe('mango-octopus-rye');
    expect(label.getAttribute('aria-hidden')).toBe('true'); // decorative; the heading carries the name
    expect(screen.getByRole('heading', { name: 'Mango Octopus Rye' })).toBeInTheDocument();
    expect(token.closest('a,button')).toBeNull(); // nothing to tap
  });

  it('lets anyone who opened the page join: no secret needed', async () => {
    const joined: unknown[] = [];
    handler = (url, init) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/join')) {
        joined.push(JSON.parse(init.body as string));
        return { body: { participantId: 'p1', token: 'tok'.repeat(10) } };
      }
      if (url.endsWith('/my-requests')) return { body: { accepted: 0, limit: 5, requests: [] } };
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    const join = await screen.findByRole('button', { name: 'Join this event' });
    expect(join).toBeDisabled(); // a name is required
    await user.type(screen.getByLabelText('Your name'), ' Ana ');
    await user.click(join);
    await waitFor(() => expect(joined).toEqual([{ nickname: 'Ana' }]));
  });

  it('adds a whole playlist: only as many as are left can be added, the rest are greyed out', async () => {
    localStorage.setItem(
      'qroove:p:ev1',
      JSON.stringify({ participantId: 'p1', token: 'tok'.repeat(10) }),
    );
    const mine = { accepted: 3, limit: 5, requests: [] as unknown[] };
    let batch: { style: string; songs: Array<{ title: string }> } | undefined;
    handler = (url, init) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/my-requests')) return { body: mine };
      if (url.endsWith('/resolve-playlist')) {
        return {
          body: {
            tracks: ['A', 'B', 'C', 'D'].map((t) => ({
              title: `Song ${t}`,
              artist: null,
              durationMs: 180000,
              sourceUrl: null,
            })),
          },
        };
      }
      if (url.endsWith('/requests/batch')) {
        batch = JSON.parse(init.body as string);
        return {
          body: {
            results: [
              { index: 0, status: 'ADDED' },
              { index: 1, status: 'ADDED' },
            ],
            accepted: 2,
          },
        };
      }
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText('Someone Else');
    await user.type(
      screen.getByLabelText('Search Spotify or paste a link'),
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    );
    const list = await screen.findByRole('list', { name: 'Songs to add' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    // 5 allowed - 3 already accepted = 2 left: the third and fourth are over the limit.
    expect(rows.map((r) => r.className.includes('over'))).toEqual([false, false, true, true]);
    // Send the last song to the top: it becomes active and pushes Song B past the limit.
    await user.click(screen.getByRole('button', { name: 'Move Song D to the top' }));
    const after = within(list).getAllByRole('listitem');
    expect(after[0]).toHaveAccessibleName(/^Song D/);
    expect(after.map((r) => r.className.includes('over'))).toEqual([false, false, true, true]);
    expect(screen.getByRole('button', { name: 'Choose a genre first' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: 'Bachata' }));
    expect(
      screen.getByText('You selected BACHATA. Remove all SALSA, CHA-CHA, OTHER songs.'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add 2 songs to queue' }));
    await screen.findByText(/2 added/);
    expect(batch!.style).toBe('bachata');
    expect(batch!.songs.map((x) => x.title)).toEqual(['Song D', 'Song A']);
  });

  it('shows a break in the queue where it falls', async () => {
    handler = (url) =>
      url.includes('by-slug')
        ? { body: { eventId: 'ev1', slug: 'ABC123' } }
        : {
            body: {
              ...baseView,
              breaks: [
                {
                  id: 'b1',
                  label: 'Break',
                  durationSec: 600,
                  startsAt: 5_000,
                  actualStart: null,
                  actualEnd: null,
                },
              ],
              preview: {
                revision: 1,
                items: [
                  {
                    requestId: 'q1',
                    position: 1,
                    predictedStartMs: 1_000,
                    uncertain: false,
                    overflow: false,
                  },
                  {
                    requestId: 'q2',
                    position: 2,
                    predictedStartMs: 9_000,
                    uncertain: false,
                    overflow: false,
                  },
                ],
                stoppedReason: 'EXHAUSTED',
                computedAt: 0,
              },
            },
          };
    renderPage();
    await screen.findAllByText('Someone Else');
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '');
    const at = items.findIndex((t) => /Break · 10 min/.test(t));
    expect(at).toBeGreaterThan(items.findIndex((t) => t.includes('Someone Else')));
    expect(at).toBeLessThan(items.findIndex((t) => t.includes('Late Song')));
  });

  it('shows a clear message for an unknown event', async () => {
    handler = () => ({
      status: 404,
      body: {
        error: {
          code: 'NOT_FOUND',
          message: 'We could not find that.',
          action: 'Check the link or code and try again.',
        },
      },
    });
    renderPage();
    expect(await screen.findByText(/We could not find that event/)).toBeInTheDocument();
    expect(screen.getByText(/Check the link or code/)).toBeInTheDocument();
  });

  it('joins, adds a song by link with an idempotency key, and withdraws it', async () => {
    const mine = { accepted: 0, limit: 5, requests: [] as unknown[] };
    handler = (url, init) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/join')) return { body: { participantId: 'p1', token: 'tok'.repeat(10) } };
      if (url.endsWith('/my-requests')) return { body: mine };
      if (url.endsWith('/resolve-playlist'))
        return {
          body: {
            tracks: [{ title: 'Mi Bachata', artist: 'Band', durationMs: 200000, sourceUrl: null }],
          },
        };
      if (url.endsWith('/requests/batch')) {
        mine.requests.push({
          id: 'r1',
          state: 'RESERVED_NEXT',
          title: 'Mi Bachata',
          artist: 'Band',
          style: 'bachata',
          provider: 'manual',
          durationMs: 200000,
          artworkUrl: null,
          acceptedSeq: 1,
          position: 1,
          predictedStartMs: Date.now() + 5000,
          uncertain: false,
          statusText: 'Up next',
        });
        mine.accepted = 1;
        return { body: { results: [{ index: 0, status: 'ADDED' }], accepted: 1 } };
      }
      if (init.method === 'DELETE') {
        mine.requests.length = 0;
        mine.accepted = 0;
        return { body: { ok: true } };
      }
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    await user.type(await screen.findByLabelText('Your name'), 'Ana');
    await user.click(screen.getByRole('button', { name: 'Join this event' }));
    // No artist or length fields, and only one place to add music.
    await user.type(
      await screen.findByLabelText('Search Spotify or paste a link'),
      `Listen https://open.spotify.com/track/${'a'.repeat(22)}`,
    );
    await screen.findByRole('list', { name: 'Songs to add' });
    expect(screen.queryByLabelText(/Artist/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Length/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'Bachata' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 song to queue' }));
    expect(await screen.findByText(/1 added/)).toBeInTheDocument();
    const post = calls.find((c) => c.url.endsWith('/requests/batch'))!;
    expect((post.init.headers as Record<string, string>)['idempotency-key']).toBe('uuid-1');
    expect(JSON.parse(post.init.body as string)).toEqual({
      style: 'bachata',
      songs: [{ title: 'Mi Bachata', artist: 'Band', durationMs: 200000, sourceUrl: null }],
    });
    expect(await screen.findByText(/You’re up next: Mi Bachata/)).toBeInTheDocument();
    await user.click(await screen.findByRole('tab', { name: /My songs/ }));
    const list = screen.getByRole('heading', { name: 'My songs' }).closest('section')!;
    expect(
      within(list).getByText('1 of 5 accepted songs this event', { exact: false }),
    ).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Withdraw Mi Bachata' }));
    await user.click(within(list).getByRole('button', { name: 'Yes, remove' }));
    await waitFor(() =>
      expect(within(list).getByText('You have not added any songs yet.')).toBeInTheDocument(),
    );
  });

  it('shows the server’s message and next action when a link is refused', async () => {
    localStorage.setItem(
      'qroove:p:ev1',
      JSON.stringify({ participantId: 'p1', token: 'tok'.repeat(10) }),
    );
    handler = (url, init) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/my-requests')) return { body: { accepted: 1, limit: 5, requests: [] } };
      if (init.method === 'POST')
        return {
          status: 400,
          body: {
            error: {
              code: 'UNSUPPORTED_LINK',
              message: 'We could not read that link.',
              action: 'Try another.',
            },
          },
        };
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByLabelText('Search Spotify or paste a link'),
      'https://example.com/x',
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not read that link. Try another.',
    );
  });

  it('drops a rejected stored pass and offers to join again', async () => {
    localStorage.setItem(
      'qroove:p:ev1',
      JSON.stringify({ participantId: 'p1', token: 'tok'.repeat(10) }),
    );
    handler = (url) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/my-requests'))
        return {
          status: 401,
          body: { error: { code: 'UNAUTHORISED', message: 'x', action: 'y' } },
        };
      return { body: baseView };
    };
    renderPage();
    expect(await screen.findByRole('button', { name: 'Join this event' })).toBeInTheDocument();
    expect(localStorage.getItem('qroove:p:ev1')).toBeNull();
  });
});

describe('live deck', () => {
  const login = () =>
    localStorage.setItem(
      'qroove:p:ev1',
      JSON.stringify({ participantId: 'p1', token: 'tok'.repeat(10) }),
    );
  const track = (requestId: string, title: string, style = 'salsa') => ({
    requestId,
    title,
    artist: 'Band',
    style,
    durationMs: 200000,
    artworkUrl: null,
    ownerNickname: null,
  });
  const req = (id: string, state: string, title: string, over: Record<string, unknown> = {}) => ({
    id,
    state,
    title,
    artist: 'Band',
    style: 'salsa',
    provider: 'manual',
    durationMs: 200000,
    artworkUrl: null,
    acceptedSeq: Number(id.slice(1)),
    position: null,
    predictedStartMs: null,
    uncertain: false,
    statusText: null,
    ...over,
  });
  /** A stream that reports the event as live, and lets a test push the next state. */
  let emit: (v: unknown) => void = () => {};
  const stream = () => {
    vi.stubGlobal(
      'EventSource',
      class {
        handlers: Array<(m: MessageEvent<string>) => void> = [];
        onerror: (() => void) | null = null;
        constructor() {
          emit = (v) => {
            for (const h of this.handlers) h({ data: JSON.stringify(v) } as MessageEvent<string>);
          };
          setTimeout(() => emit(viewNow), 0);
        }
        addEventListener(_: string, h: (m: MessageEvent<string>) => void) {
          this.handlers.push(h);
        }
        close() {}
      },
    );
  };
  let viewNow: unknown = baseView;
  const serve = (view: unknown, mine?: unknown) => {
    viewNow = view;
    handler = (url) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/my-requests'))
        return { body: mine ?? { accepted: 0, limit: 5, requests: [] } };
      return { body: view };
    };
  };

  it('shows the real now playing and next up, with a time only when the queue is sure of it', async () => {
    const now = Date.now();
    serve({
      ...baseView,
      serverNow: now,
      nowPlaying: { track: track('p0', 'Playing Now', 'bachata'), startedAt: now },
      preview: {
        revision: 1,
        items: [
          {
            requestId: 'q1',
            position: 1,
            predictedStartMs: now + 4 * 60_000,
            uncertain: false,
            overflow: false,
          },
        ],
        stoppedReason: 'EXHAUSTED',
        computedAt: 0,
      },
    });
    stream();
    renderPage();
    const nowCard = (await screen.findByRole('heading', { name: 'Now playing' })).closest(
      'section',
    )!;
    expect(within(nowCard).getByText('Playing Now')).toBeInTheDocument();
    expect(within(nowCard).getByText('Bachata')).toBeInTheDocument();
    const next = screen.getByRole('heading', { name: 'Next up' }).closest('section')!;
    expect(within(next).getByText('Someone Else')).toBeInTheDocument();
    expect(within(next).getByText(/^~[34] min$/)).toBeInTheDocument();
    expect(await screen.findByText('Live')).toBeInTheDocument();
    // Advancing the track belongs to the organiser's console, never to a guest.
    expect(screen.queryByRole('button', { name: /switchover|skip|next track/i })).toBeNull();
    // A new state from the stream replaces both cards: there is no second, local queue.
    act(() =>
      emit({
        ...(viewNow as typeof baseView),
        version: 2,
        nowPlaying: { track: track('q1', 'Someone Else'), startedAt: now },
        queue: [{ ...baseView.queue[1]!, overflow: false }],
        preview: { revision: 2, items: [], stoppedReason: 'EXHAUSTED', computedAt: 0 },
      }),
    );
    expect(await within(nowCard).findByText('Someone Else')).toBeInTheDocument();
    expect(within(next).getByText('Late Song')).toBeInTheDocument();
    expect(within(next).queryByText(/min$/)).toBeNull();
  });

  it('does not invent a time for an uncertain prediction, and handles empty and paused states', async () => {
    const now = Date.now();
    serve({
      ...baseView,
      state: 'PAUSED',
      serverNow: now,
      queue: [],
      preview: { revision: 1, items: [], stoppedReason: 'EXHAUSTED', computedAt: 0 },
    });
    stream();
    renderPage();
    const next = (await screen.findByRole('heading', { name: 'Next up' })).closest('section')!;
    expect(within(next).getByText('No upcoming song.')).toBeInTheDocument();
    expect(screen.getByText('Session paused')).toBeInTheDocument();
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    cleanup();
    serve({
      ...baseView,
      serverNow: now,
      preview: {
        revision: 1,
        items: [
          {
            requestId: 'q1',
            position: 1,
            predictedStartMs: now + 240_000,
            uncertain: true,
            overflow: false,
          },
        ],
        stoppedReason: 'EXHAUSTED',
        computedAt: 0,
      },
    });
    renderPage();
    const next2 = (await screen.findByRole('heading', { name: 'Next up' })).closest('section')!;
    await within(next2).findByText('Someone Else');
    expect(within(next2).queryByText(/min$/)).toBeNull();
  });

  it('says so when the event has ended, or the stream is not delivering', async () => {
    serve({ ...baseView, state: 'ENDED' });
    stream();
    renderPage();
    expect(await screen.findByText('Ended')).toBeInTheDocument();
    cleanup();
    serve(baseView);
    vi.stubGlobal('EventSource', undefined); // polling only: the header must not claim "Live"
    renderPage();
    expect(await screen.findByText('Reconnecting')).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
  });

  it('lists my songs in play order with the playing one first, and keeps played ones in a disclosure', async () => {
    login();
    const now = Date.now();
    serve(
      { ...baseView, serverNow: now },
      {
        accepted: 4,
        limit: 5,
        requests: [
          req('r4', 'PLAYED', 'Old Song'),
          req('r3', 'QUEUED', 'Third', { position: 9, predictedStartMs: now + 20 * 60_000 }),
          req('r2', 'QUEUED', 'Second', { position: 4, predictedStartMs: now + 8 * 60_000 }),
          req('r1', 'PLAYING', 'First'),
          req('r5', 'SKIPPED', 'Skipped Song'),
          req('r6', 'REJECTED', 'Bad Link'),
        ],
      },
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('tab', { name: /My songs/ }));
    const mine = (await screen.findByRole('heading', { name: 'My songs' })).closest('section')!;
    await within(mine).findByText('First');
    const titles = within(mine)
      .getAllByRole('listitem')
      .map((li) => li.querySelector('.title')?.textContent);
    // Playing, then the queue's own order, then the song that needs attention; history comes last.
    expect(titles).toEqual(['First', 'Second', 'Third', 'Bad Link']);
    expect(within(mine).getByText('Playing')).toBeInTheDocument();
    expect(within(mine).getByText('Removed')).toBeInTheDocument();
    expect(within(mine).getByText('Est. in ~8 min')).toBeInTheDocument();
    const toggle = within(mine).getByRole('button', { name: /Played songs \(2\)/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(mine).getByText('Old Song').closest('ul')).toHaveAttribute('hidden');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(mine).getByText('Old Song').closest('ul')).not.toHaveAttribute('hidden');
    expect(
      within(within(mine).getByText('Old Song').closest('ul')!)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('.title')?.textContent),
    ).toEqual(['Skipped Song', 'Old Song']); // newest first, still visible but secondary
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the real quota beside Add music', async () => {
    login();
    serve(baseView, { accepted: 2, limit: 5, requests: [] });
    renderPage();
    expect(await screen.findByText('2 of 5 accepted songs')).toBeInTheDocument();
  });

  it('pastes from the clipboard, and says so when it cannot', async () => {
    login();
    serve(baseView);
    handler = (
      (inner: Handler): Handler =>
      (url, init) =>
        url.endsWith('/resolve-playlist') ? { body: { tracks: [] } } : inner(url, init)
    )(handler);
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText('Search Spotify or paste a link');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: () => Promise.reject(new Error('denied')) },
    });
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('We could not read your clipboard.');
    await user.type(input, 'abc'); // still usable
    expect(input).toHaveValue('abc');
    await user.clear(input);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: () => Promise.resolve('  rumba  ') },
    });
    await user.click(screen.getByRole('button', { name: 'Paste' }));
    await waitFor(() => expect(input).toHaveValue('rumba'));
  });

  it('keeps the songs, the genre and the quota when adding fails, and shows the real error', async () => {
    login();
    const mine = { accepted: 1, limit: 5, requests: [] as unknown[] };
    handler = (url) => {
      if (url.includes('by-slug')) return { body: { eventId: 'ev1', slug: 'ABC123' } };
      if (url.endsWith('/my-requests')) return { body: mine };
      if (url.endsWith('/resolve-playlist'))
        return {
          body: {
            tracks: [{ title: 'Mi Bachata', artist: 'Band', durationMs: 200000, sourceUrl: null }],
          },
        };
      if (url.endsWith('/requests/batch'))
        return {
          status: 429,
          body: {
            error: {
              code: 'RATE_LIMITED',
              message: 'Slow down a little.',
              action: 'Try again in a minute.',
            },
          },
        };
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    await user.type(
      await screen.findByLabelText('Search Spotify or paste a link'),
      `https://open.spotify.com/track/${'a'.repeat(22)}`,
    );
    await screen.findByRole('list', { name: 'Songs to add' });
    await user.click(screen.getByRole('radio', { name: 'Bachata' }));
    await user.click(screen.getByRole('button', { name: 'Add 1 song to queue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Slow down a little. Try again in a minute.',
    );
    expect(screen.getByRole('list', { name: 'Songs to add' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Bachata' })).toBeChecked();
    expect(screen.getByText('1 of 5 accepted songs')).toBeInTheDocument();
    expect(screen.queryByText(/\d added/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add 1 song to queue' })).toBeEnabled();
  });
});
