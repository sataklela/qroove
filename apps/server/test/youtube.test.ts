import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createAndStart, mockFetch, testApp } from './api-helpers.js';
import { MemoryRepository } from '../src/db/memory/index.js';
import type { FetchLike } from '../src/ingestion/fetch.js';
import {
  isoDurationMs,
  MISS_TTL_MS,
  rankCandidates,
  YouTubeMatcher,
  type VideoCandidate,
} from '../src/ingestion/providers/youtube.js';

const song = { title: 'Despacito', artist: 'Luis Fonsi', durationMs: 229_000 };
const v = (id: string, title: string, channel: string, durationMs: number): VideoCandidate => ({
  id,
  title,
  channel,
  durationMs,
});

describe('rankCandidates', () => {
  it('prefers the Topic audio over an official video, and drops live, cover and wrong-length ones', () => {
    const ids = rankCandidates(song, [
      v('live', 'Luis Fonsi - Despacito (Live)', 'Luis Fonsi', 229_000),
      v('cover', 'Despacito cover by Sam', 'Sam', 229_000),
      v('long', 'Luis Fonsi - Despacito', 'Luis Fonsi', 300_000),
      v('video', 'Luis Fonsi - Despacito ft. Daddy Yankee', 'LuisFonsiVEVO', 228_000),
      v('topic', 'Despacito', 'Luis Fonsi - Topic', 229_000),
    ]);
    expect(ids).toEqual(['topic', 'video']);
  });

  it('returns nothing when no candidate is convincing', () => {
    expect(rankCandidates(song, [v('x', 'Something else', 'Someone', 229_000)])).toEqual([]);
  });

  it('keeps a version the song itself asks for', () => {
    const live = { title: 'Despacito (Live)', artist: 'Luis Fonsi', durationMs: 240_000 };
    expect(
      rankCandidates(live, [v('l', 'Luis Fonsi - Despacito (Live)', 'Luis Fonsi', 240_000)]),
    ).toEqual(['l']);
  });
});

describe('isoDurationMs', () => {
  it('reads ISO 8601 durations', () => {
    expect(isoDurationMs('PT3M49S')).toBe(229_000);
    expect(isoDurationMs('PT1H2M3S')).toBe(3_723_000);
    expect(isoDurationMs('P0D')).toBe(0);
  });
});

describe('YouTubeMatcher', () => {
  const respond =
    (calls: string[], quota = false): FetchLike =>
    async (url) => {
      calls.push(url);
      if (quota) return new Response('{}', { status: 403 });
      const body = url.includes('/search')
        ? { items: [{ id: { videoId: 'abc12345678' } }] }
        : {
            items: [
              {
                id: 'abc12345678',
                snippet: { title: 'Despacito', channelTitle: 'Luis Fonsi - Topic' },
                contentDetails: { duration: 'PT3M49S' },
              },
            ],
          };
      return new Response(JSON.stringify(body), {
        headers: { 'content-type': 'application/json' },
      });
    };

  it('finds a match once, then answers from the cache', async () => {
    const calls: string[] = [];
    const m = new YouTubeMatcher(respond(calls), 'key', new MemoryRepository(), () => 1000);
    expect(await m.match('sp1', song)).toEqual(['abc12345678']);
    expect(await m.match('sp1', song)).toEqual(['abc12345678']);
    expect(calls).toHaveLength(2);
  });

  it('caches a miss for a week, then looks again', async () => {
    const calls: string[] = [];
    let now = 0;
    const empty: FetchLike = async (url) => {
      calls.push(url);
      return new Response(JSON.stringify({ items: [] }));
    };
    const m = new YouTubeMatcher(empty, 'key', new MemoryRepository(), () => now);
    expect(await m.match('sp2', song)).toEqual([]);
    expect(await m.match('sp2', song)).toEqual([]);
    expect(calls).toHaveLength(1);
    now = MISS_TTL_MS + 1;
    await m.match('sp2', song);
    expect(calls).toHaveLength(2);
  });

  it('gives nothing, and caches nothing, without a key or when the quota is spent', async () => {
    const calls: string[] = [];
    const repo = new MemoryRepository();
    expect(
      await new YouTubeMatcher(respond(calls), undefined, repo, () => 0).match('a', song),
    ).toEqual([]);
    expect(calls).toHaveLength(0);
    const spent = new YouTubeMatcher(respond(calls, true), 'key', repo, () => 0);
    expect(await spent.match('b', song)).toEqual([]);
    expect(await repo.getYouTubeMatch('b')).toBeNull();
  });
});

describe('GET /api/events/:id/player/youtube/:rid', () => {
  const SP = '4uLU6hMCjMI75M1A2tKUQC';
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  async function setup(env: Record<string, string>) {
    const f = mockFetch({
      'https://open.spotify.com/oembed': () => ({ title: 'Despacito' }),
      'https://itunes.apple.com/lookup': () => ({
        results: [
          { trackId: 1, trackName: 'Despacito', artistName: 'Luis Fonsi', trackTimeMillis: 229000 },
        ],
      }),
      'https://www.googleapis.com/youtube/v3/search': () => ({
        items: [{ id: { videoId: 'abc12345678' } }],
      }),
      'https://www.googleapis.com/youtube/v3/videos': () => ({
        items: [
          {
            id: 'abc12345678',
            snippet: { title: 'Despacito', channelTitle: 'Luis Fonsi - Topic' },
            contentDetails: { duration: 'PT3M49S' },
          },
        ],
      }),
    });
    const t = await testApp({ fetch: f, env });
    apps.push(t.app);
    const { created } = await createAndStart(t.api);
    const id: string = created.eventId;
    const j = await t.api.call('POST', `/api/events/${id}/join`, { body: { nickname: 'Guest' } });
    const guest = { participantId: j.json.participantId as string, token: j.json.token as string };
    const sub = await t.api.call('POST', `/api/events/${id}/requests`, {
      auth: guest,
      body: { url: `https://open.spotify.com/track/${SP}`, style: 'salsa' },
    });
    return { ...t, id, rid: sub.json.request.id as string, guest, f };
  }

  it('needs the organiser, and answers an empty list without an API key', async () => {
    const t = await setup({});
    const path = `/api/events/${t.id}/player/youtube/${t.rid}`;
    const asGuest = await new Client(t.app).call('GET', path, { auth: t.guest });
    expect(asGuest.status).toBeGreaterThanOrEqual(400);
    const ok = await t.api.admin('GET', t.id, `/player/youtube/${t.rid}`);
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ videoIds: [] });
    expect(t.f.calls.some((u) => u.includes('googleapis'))).toBe(false);
  });

  it('returns the matched video ids when a key is set', async () => {
    const t = await setup({ YOUTUBE_API_KEY: 'k' });
    const r = await t.api.admin('GET', t.id, `/player/youtube/${t.rid}`);
    expect(r.status).toBe(200);
    expect(r.json.videoIds.length).toBeLessThanOrEqual(3);
  });
});
