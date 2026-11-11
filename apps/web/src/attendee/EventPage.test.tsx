import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const SLUG = { body: { eventId: 'ev1', slug: 'ABC123' } };
const PASS = { participantId: 'p1', token: 'tok'.repeat(10) };
const stored = () => localStorage.setItem('qroove:p:ev1', JSON.stringify(PASS));
const req = (over: Record<string, unknown>) => ({
  id: 'r1',
  state: 'QUEUED',
  title: 'Mine',
  artist: 'Me',
  style: 'salsa',
  provider: 'manual',
  durationMs: 180000,
  artworkUrl: null,
  acceptedSeq: 3,
  position: 3,
  predictedStartMs: null,
  uncertain: false,
  statusText: null,
  ...over,
});
const row = (id: string, title: string, over: Record<string, unknown> = {}) => ({
  requestId: id,
  title,
  artist: 'X',
  style: 'salsa',
  durationMs: null,
  artworkUrl: null,
  ownerNickname: null,
  position: 1,
  overflow: false,
  ...over,
});

describe('EventPage', () => {
  it('joins by itself on opening: nothing to type or tap, and the codename is shown', async () => {
    const joined: unknown[] = [];
    handler = (url, init) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/join')) {
        joined.push(JSON.parse(init.body as string));
        return { body: { ...PASS, nickname: 'Carrot Octopus' } };
      }
      if (url.endsWith('/my-requests')) {
        return { body: { nickname: 'Carrot Octopus', accepted: 0, limit: 5, requests: [] } };
      }
      return { body: baseView };
    };
    const { container } = renderPage();
    expect(await screen.findByText('Carrot Octopus')).toBeInTheDocument();
    // One join, with no name sent, and the pass is kept for the next visit.
    expect(joined).toEqual([{}]);
    expect(JSON.parse(localStorage.getItem('qroove:p:ev1')!)).toEqual(PASS);
    expect(screen.queryByLabelText('Your name')).toBeNull();
    expect(await screen.findByRole('button', { name: /Add a song/ })).toBeEnabled();
    expect(screen.getByText('0 of 5')).toBeInTheDocument();
    // The room code is the event's name in the header.
    await waitFor(() =>
      expect(container.querySelector('.topbar .event-token')?.textContent).toContain('ABC-123'),
    );
  });

  it('offers one retry button when joining fails, and never joins an ended event', async () => {
    let fail = true;
    let joins = 0;
    handler = (url) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/join')) {
        joins += 1;
        return fail
          ? { status: 429, body: { error: { code: 'RATE_LIMITED', message: 'Slow', action: '' } } }
          : { body: { ...PASS, nickname: 'Leek Seal' } };
      }
      if (url.endsWith('/my-requests')) {
        return { body: { nickname: 'Leek Seal', accepted: 0, limit: 5, requests: [] } };
      }
      return { body: baseView };
    };
    const user = userEvent.setup();
    const first = renderPage();
    const retry = await screen.findByRole('button', { name: /Could not join/ });
    fail = false;
    await user.click(retry);
    expect(await screen.findByText('Leek Seal')).toBeInTheDocument();
    first.unmount();

    localStorage.clear();
    joins = 0;
    handler = (url) => (url.includes('by-slug') ? SLUG : { body: { ...baseView, state: 'ENDED' } });
    renderPage();
    expect(await screen.findByText('This event has ended.')).toBeInTheDocument();
    expect(joins).toBe(0);
    expect(screen.queryByRole('button', { name: /Add a song/ })).toBeNull();
  });

  it('shows one queue without other people’s names; my songs are marked, with a time when sure', async () => {
    stored();
    const soon = baseView.serverNow + 4 * 60_000;
    handler = (url) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/my-requests')) {
        return {
          body: {
            nickname: 'Carrot Octopus',
            accepted: 2,
            limit: 5,
            requests: [
              req({ id: 'q3' }),
              req({
                id: 'w1',
                title: 'Held Back',
                state: 'INELIGIBLE_TEMPORARILY',
                position: null,
                statusText: 'Waiting for a different genre',
              }),
            ],
          },
        };
      }
      return {
        body: {
          ...baseView,
          queue: [...baseView.queue, row('q3', 'Mine', { position: 3 })],
          preview: {
            ...baseView.preview,
            items: [
              {
                requestId: 'q3',
                position: 3,
                predictedStartMs: soon,
                uncertain: false,
                overflow: false,
              },
            ],
          },
        },
      };
    };
    renderPage();
    const list = within(await screen.findByRole('region', { name: 'Queue' }));
    expect(list.getByText('Someone Else')).toBeInTheDocument();
    expect(screen.queryByText(/Secret Name/)).toBeNull();
    expect(list.getByText('After end time')).toBeInTheDocument();
    expect(await list.findByText(/Yours · ~4 min/)).toBeInTheDocument();
    // A song of mine with no place in the projection yet is still listed, with its reason.
    expect(list.getByText('Yours · Waiting for a different genre')).toBeInTheDocument();
    // Only my own rows can be withdrawn.
    expect(list.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Withdraw Mine',
      'Withdraw Held Back',
    ]);
    // No second list, no tabs.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('withdraws my song from the queue itself: ✕ then Remove, or one swipe to the left', async () => {
    stored();
    const gone: string[] = [];
    handler = (url, init) => {
      if (url.includes('by-slug')) return SLUG;
      if (init.method === 'DELETE') {
        gone.push(url.split('/').pop()!);
        return { body: { ok: true } };
      }
      if (url.endsWith('/my-requests')) {
        return {
          body: {
            nickname: 'Carrot Octopus',
            accepted: 2,
            limit: 5,
            requests: [req({ id: 'q3' }), req({ id: 'q4', title: 'Other Mine' })],
          },
        };
      }
      return {
        body: {
          ...baseView,
          queue: [...baseView.queue, row('q3', 'Mine'), row('q4', 'Other Mine')],
        },
      };
    };
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(await screen.findByRole('button', { name: 'Withdraw Mine' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(gone).toEqual(['q3']));
    expect(await screen.findByText('Withdrew “Mine”.')).toBeInTheDocument();

    const fg = [...container.querySelectorAll<HTMLElement>('.qrow.mine .qrow-fg')].find((el) =>
      el.textContent?.includes('Other Mine'),
    )!;
    fg.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    // A short drag springs back; a long one withdraws.
    fireEvent.pointerDown(fg, { clientX: 250, clientY: 10 });
    fireEvent.pointerMove(fg, { clientX: 200, clientY: 10 });
    fireEvent.pointerUp(fg);
    expect(gone).toEqual(['q3']);
    fireEvent.pointerDown(fg, { clientX: 250, clientY: 10 });
    fireEvent.pointerMove(fg, { clientX: 230, clientY: 10 });
    fireEvent.pointerMove(fg, { clientX: 100, clientY: 12 });
    fireEvent.pointerUp(fg);
    await waitFor(() => expect(gone).toEqual(['q3', 'q4']));
  });

  it('adds from a link in one tap: the genre button is the add button', async () => {
    stored();
    const mine = { nickname: 'Carrot Octopus', accepted: 3, limit: 5, requests: [] as unknown[] };
    let batch: { style: string; songs: Array<{ title: string }> } | undefined;
    let key: string | undefined;
    handler = (url, init) => {
      if (url.includes('by-slug')) return SLUG;
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
        key = (init.headers as Record<string, string>)['idempotency-key'];
        return {
          body: {
            results: [
              { index: 0, status: 'ADDED' },
              { index: 1, status: 'DUPLICATE' },
            ],
            accepted: 1,
          },
        };
      }
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    // The form is not on the page until asked for.
    expect(screen.queryByLabelText('Search Spotify or paste a link')).toBeNull();
    await user.click(await screen.findByRole('button', { name: /Add a song/ }));
    const sheet = within(screen.getByRole('dialog', { name: 'Add a song' }));
    expect(sheet.getByRole('button', { name: 'Add as Salsa' })).toBeDisabled();
    await user.type(
      sheet.getByLabelText('Search Spotify or paste a link'),
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    );
    const list = await sheet.findByRole('list', { name: 'Songs to add' });
    const rows = within(list).getAllByRole('listitem');
    // 5 allowed - 3 already accepted = 2 left: the third and fourth are over the limit.
    expect(rows.map((r) => r.className.includes('over'))).toEqual([false, false, true, true]);
    await user.click(sheet.getByRole('button', { name: 'Move Song D to the top' }));
    // Only the event's genres are offered.
    expect(sheet.queryByRole('button', { name: 'Add as Cha-cha' })).toBeNull();
    await user.click(sheet.getByRole('button', { name: 'Add as Bachata' }));
    // The sheet closes by itself and the page says what happened.
    expect(await screen.findByText('1 added, 1 already queued.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(batch!.style).toBe('bachata');
    expect(batch!.songs.map((x) => x.title)).toEqual(['Song D', 'Song A']);
    expect(key).toBe('uuid-1');
  });

  it('keeps the songs and shows the server’s message when adding fails; Close leaves the sheet', async () => {
    stored();
    handler = (url) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/my-requests')) {
        return { body: { nickname: 'Carrot Octopus', accepted: 0, limit: 5, requests: [] } };
      }
      if (url.endsWith('/resolve-playlist')) {
        return {
          body: { tracks: [{ title: 'Song A', artist: null, durationMs: 1, sourceUrl: null }] },
        };
      }
      if (url.endsWith('/requests/batch')) {
        return {
          status: 409,
          body: { error: { code: 'EVENT_ENDED', message: 'The event is over.', action: 'Sorry.' } },
        };
      }
      return { body: baseView };
    };
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Add a song/ }));
    await user.type(screen.getByLabelText('Search Spotify or paste a link'), 'https://x.test/a');
    await screen.findByRole('list', { name: 'Songs to add' });
    await user.click(screen.getByRole('button', { name: 'Add as Salsa' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The event is over. Sorry.');
    expect(screen.getByRole('list', { name: 'Songs to add' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says in one line when a song of mine was removed, and asks for a new pass when mine is refused', async () => {
    stored();
    let refuse = false;
    handler = (url) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/join'))
        return { body: { participantId: 'p2', token: 'new'.repeat(10), nickname: 'Kale Whale' } };
      if (url.endsWith('/my-requests')) {
        return refuse
          ? { status: 401, body: { error: { code: 'UNAUTHORISED', message: 'No', action: '' } } }
          : {
              body: {
                nickname: 'Carrot Octopus',
                accepted: 0,
                limit: 5,
                requests: [
                  req({ state: 'REJECTED', title: 'Gone', statusText: 'Removed by the organiser' }),
                ],
              },
            };
      }
      return { body: baseView };
    };
    const first = renderPage();
    expect(await screen.findByText('“Gone”: Removed by the organiser.')).toBeInTheDocument();
    first.unmount();
    // A pass the server no longer knows is dropped, and the page joins again by itself.
    refuse = true;
    renderPage();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem('qroove:p:ev1')!).participantId).toBe('p2'),
    );
  });

  it('shows what is playing and breaks where they fall', async () => {
    stored();
    handler = (url) => {
      if (url.includes('by-slug')) return SLUG;
      if (url.endsWith('/my-requests')) {
        return { body: { nickname: 'Carrot Octopus', accepted: 0, limit: 5, requests: [] } };
      }
      return {
        body: {
          ...baseView,
          nowPlaying: {
            track: row('np', 'On Air', { artist: 'Band' }),
            startedAt: baseView.serverNow,
            durationMs: 200000,
          },
          breaks: [
            {
              id: 'b1',
              label: 'Break',
              durationSec: 600,
              startMin: 60,
              startsAt: baseView.serverNow + 3_600_000,
              actualStart: null,
              actualEnd: null,
            },
          ],
        },
      };
    };
    renderPage();
    expect(await screen.findByText('On Air')).toBeInTheDocument();
    expect(screen.getByText(/Break · 10 min/)).toBeInTheDocument();
  });
});
