/* eslint-disable @typescript-eslint/no-explicit-any -- HTTP response bodies are untyped JSON in tests */
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client, createAndStart, mockFetch, ORIGIN, testApp } from './api-helpers.js';

const SP = '4uLU6hMCjMI75M1A2tKUQC';
const SP2 = '5uLU6hMCjMI75M1A2tKUQD';
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});
async function setup(opts: Parameters<typeof testApp>[0] = {}) {
  const t = await testApp(opts);
  apps.push(t.app);
  const { created } = await createAndStart(t.api);
  const id: string = created.eventId;
  const join = async (nickname?: string) => {
    const r = await t.api.call('POST', `/api/events/${id}/join`, {
      body: { nickname: nickname ?? 'Guest' },
    });
    expect(r.status).toBe(200);
    return { participantId: r.json.participantId as string, token: r.json.token as string };
  };
  const manual = (
    g: { participantId: string; token: string },
    title: string,
    style = 'salsa',
    extra: object = {},
    headers = {},
  ) =>
    t.api.call('POST', `/api/events/${id}/requests`, {
      auth: g,
      body: { style, manual: { title, artist: 'Band', ...extra } },
      headers,
    });
  return { ...t, created, id, join, manual };
}

describe('joining with the room code', () => {
  it('lets anyone with the permanent room code join, and the QR link is the same public link', async () => {
    const { api, id, created } = await setup();
    // Nothing to type: an empty body joins and comes back with a codename (a sent name is ignored).
    const ok = await api.call('POST', `/api/events/${id}/join`, { body: { nickname: 'Ana' } });
    expect(ok.status).toBe(200);
    expect(ok.json.nickname).not.toBe('Ana');
    const bare = await api.call('POST', `/api/events/${id}/join`, {});
    expect(bare.status).toBe(200);
    expect(bare.json.nickname).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(bare.json.nickname).not.toBe(ok.json.nickname);
    expect(created.name).toBe(`${created.slug.slice(0, 3)}-${created.slug.slice(3)}`);
    // The QR code is just a backup for the typed code: it opens the same public page.
    expect(created.joinUrl).toMatch(new RegExp(`/e/${created.slug}$`));
    const st = await api.admin('GET', id, '/admin/state');
    expect(st.json.joinUrl).toBe(created.joinUrl);
    const lookup = await api.call('GET', `/api/events/by-slug/${created.slug.toLowerCase()}`);
    expect(lookup.status).toBe(200);
  });
});

describe('events and admin session', () => {
  it('creates an event whose admin URL keeps the secret in the fragment', async () => {
    const { created } = await setup();
    expect(created.joinUrl).toMatch(/\/e\/[0-9A-Z]{6}$/);
    expect(created.adminUrl).toMatch(/\/a\/\w+#k=/);
    expect(created.adminUrl.split('#')[0]).not.toContain(new URL(created.adminUrl).hash.slice(3));
    expect(created.recoverySecret).toBeTruthy();
  });

  it('starts the event with cookie + origin + CSRF, and serves admin state', async () => {
    const { api, id } = await setup();
    const st = await api.admin('GET', id, '/admin/state');
    expect(st.status).toBe(200);
    expect(st.json.view.state).toBe('ACTIVE');
    expect(st.json.rulesHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects admin calls without cookie, CSRF, matching origin, or with a stale CSRF', async () => {
    const { app, api, id, created } = await setup();
    const anon = new Client(app);
    expect((await anon.call('POST', `/api/events/${id}/admin/pause`, { body: {} })).status).toBe(
      401,
    );
    // cookie but no CSRF header
    expect((await api.call('POST', `/api/events/${id}/admin/pause`, { body: {} })).status).toBe(
      401,
    );
    const csrf = api.cookies.get(`qc_${id}`)!;
    // wrong origin
    const evil = await api.call('POST', `/api/events/${id}/admin/pause`, {
      body: {},
      headers: { 'x-qroove-csrf': csrf, origin: 'https://evil.example' },
    });
    expect(evil.status).toBe(401);
    // missing origin entirely
    const noOrigin = await app.inject({
      method: 'POST',
      url: `/api/events/${id}/admin/pause`,
      payload: {},
      headers: {
        cookie: [...api.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        'x-qroove-csrf': csrf,
      },
    });
    expect(noOrigin.statusCode).toBe(401);
    // CSRF from another event's session
    const other = await createAndStart(api);
    const bad = await api.call('POST', `/api/events/${id}/admin/pause`, {
      body: {},
      headers: { 'x-qroove-csrf': api.cookies.get(`qc_${other.created.eventId}`)! },
    });
    expect(bad.status).toBe(401);
    expect(created.eventId).toBe(id);
    expect((await api.admin('POST', id, '/admin/pause', {})).status).toBe(200);
  });

  it('refuses a wrong admin secret at session exchange and sets hardened cookies', async () => {
    const { app } = await setup();
    const api = new Client(app);
    const c = await api.call('POST', '/api/events', { body: { timezone: 'UTC' } });
    const bad = await api.call('POST', `/api/events/${c.json.eventId}/admin/session`, {
      body: { secret: 'x'.repeat(40) },
    });
    expect(bad.status).toBe(401);
    const secret = new URL(c.json.adminUrl).hash.slice(3);
    const res = await app.inject({
      method: 'POST',
      url: `/api/events/${c.json.eventId}/admin/session`,
      payload: { secret },
      headers: { origin: ORIGIN },
    });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] as string[]);
    const adminCookie = cookies.find((x) => x.startsWith('qa_'))!;
    expect(adminCookie).toMatch(/HttpOnly/);
    expect(adminCookie).toMatch(/SameSite=Strict/);
    expect(adminCookie).toContain(`Path=/api/events/${c.json.eventId}`);
    expect(cookies.find((x) => x.startsWith('qc_'))).not.toMatch(/HttpOnly/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('sets Secure cookies in production', async () => {
    const t = await testApp({
      env: { NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://q.example' },
    });
    apps.push(t.app);
    const c = await t.api.call('POST', '/api/events', {
      headers: { origin: 'https://q.example' },
      body: { timezone: 'UTC' },
    });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/events/${c.json.eventId}/admin/session`,
      payload: { secret: new URL(c.json.adminUrl).hash.slice(3) },
      headers: { origin: 'https://q.example' },
    });
    expect(
      ([] as string[])
        .concat(res.headers['set-cookie'] as string[])
        .every((x) => x.includes('Secure')),
    ).toBe(true);
    // and the dev localhost origins are not accepted
    const dev = await t.app.inject({
      method: 'POST',
      url: `/api/events/${c.json.eventId}/admin/session`,
      payload: { secret: 'x'.repeat(40) },
      headers: { origin: ORIGIN },
    });
    expect(dev.statusCode).toBe(401);
  });
});

describe('attendees', () => {
  it('joins, submits manually, sees "Up next", and the public view leaks no ids', async () => {
    const { api, id, join, manual, created } = await setup();
    const g = await join('Ana');
    const r = await manual(g, 'Mi Bachata', 'bachata');
    expect(r.status).toBe(200);
    expect(r.json.request).toMatchObject({
      state: 'RESERVED_NEXT',
      statusText: 'Up next',
      position: 1,
      provider: 'manual',
    });
    const mine = await api.call('GET', `/api/events/${id}/my-requests`, { auth: g });
    expect(mine.json).toMatchObject({ accepted: 1, limit: 5 });
    expect(mine.json.nickname).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    const pub = await api.call('GET', `/api/events/${created.slug.toLowerCase()}/public`);
    expect(pub.status).toBe(200);
    expect(pub.json.queue[0]).toMatchObject({
      title: 'Mi Bachata',
      ownerNickname: mine.json.nickname,
      position: 1,
    });
    expect(pub.headers['cache-control']).toBe('no-store');
    expect(pub.text).not.toContain(g.participantId);
    expect(pub.text).not.toContain(g.token);
  });

  it('requires a valid participant token', async () => {
    const { api, id, join, manual } = await setup();
    const g = await join();
    expect((await manual({ ...g, token: 'a'.repeat(43) }, 'x')).status).toBe(401);
    expect(
      (
        await api.call('POST', `/api/events/${id}/requests`, {
          body: { style: 'salsa', manual: { title: 'x' } },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api.call('GET', `/api/events/${id}/my-requests`, {
          auth: { ...g, token: 'b'.repeat(43) },
        })
      ).status,
    ).toBe(401);
  });

  it('maps domain errors to JSON with a practical next action', async () => {
    const { join, manual, api } = await setup();
    const g = await join();
    for (let i = 1; i <= 5; i++) expect((await manual(g, `Song ${i}`)).status).toBe(200);
    const full = await manual(g, 'Song 6');
    expect(full.status).toBe(409);
    expect(full.json.error).toMatchObject({
      code: 'QUOTA_FULL',
      action: expect.stringContaining('Remove'),
    });
    const dup = await manual(await join(), 'song 1'); // same fingerprint, different case
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('DUPLICATE');
    expect(dup.json.error.message).toContain('Song 1');
    expect((await api.call('GET', '/api/events/by-slug/ZZZZZZ')).status).toBe(404);
    expect((await manual(await join(), 'x', 'tango')).status).toBe(400);
    expect(
      (await api.call('POST', `/api/events/nope/join`, { body: { nickname: 'Ana' } })).json.error
        .code,
    ).toBe('NOT_FOUND');
  });

  it('withdraws a request and frees the slot', async () => {
    const { api, id, join, manual } = await setup();
    const g = await join();
    const r = await manual(g, 'A');
    const del = await api.call('DELETE', `/api/events/${id}/requests/${r.json.request.id}`, {
      auth: g,
    });
    expect(del.status).toBe(200);
    const mine = await api.call('GET', `/api/events/${id}/my-requests`, { auth: g });
    expect(mine.json.accepted).toBe(0);
    const other = await api.call('DELETE', `/api/events/${id}/requests/${r.json.request.id}`, {
      auth: await join(),
    });
    expect(other.status).toBe(403);
  });

  it('replays an Idempotency-Key without a second slot', async () => {
    const { join, manual, api, id } = await setup();
    const g = await join();
    const a = await manual(g, 'A', 'salsa', {}, { 'idempotency-key': 'k1' });
    const b = await manual(g, 'A', 'salsa', {}, { 'idempotency-key': 'k1' });
    expect(b.json.request.id).toBe(a.json.request.id);
    expect(
      (await api.call('GET', `/api/events/${id}/my-requests`, { auth: g })).json.accepted,
    ).toBe(1);
  });

  it('rejects oversized bodies and unknown fields types', async () => {
    const { join, manual, api, id } = await setup();
    const g = await join();
    const big = await manual(g, 'x'.repeat(20_000));
    expect(big.status).toBe(400);
    expect(
      (await api.call('POST', `/api/events/${id}/requests`, { auth: g, body: { style: 'salsa' } }))
        .status,
    ).toBe(400);
  });
});

describe('link intake', () => {
  const net = () =>
    mockFetch({
      'https://open.spotify.com/oembed': () => ({ title: 'Obsesión' }),
      'https://itunes.apple.com/lookup': () => ({
        results: [
          { trackId: 9999999, trackName: 'Obsesión', artistName: '', trackTimeMillis: 200000 },
        ],
      }),
      'https://www.youtube.com/oembed': () => ({ title: 'Aventura - Obsesión', author_name: 'x' }),
    });
  const submit = (
    c: Awaited<ReturnType<typeof setup>>,
    g: { participantId: string; token: string },
    url: string,
    style = 'bachata',
  ) => c.api.call('POST', `/api/events/${c.id}/requests`, { auth: g, body: { url, style } });

  it('resolves a link without side effects and suggests a style only from the title', async () => {
    const f = mockFetch({
      'https://www.youtube.com/oembed': () => ({
        title: 'Aventura - Mi Bachata',
        author_name: 'x',
      }),
    });
    const c = await setup({ fetch: f });
    const r = await c.api.call('POST', '/api/resolve-link', {
      body: { url: 'https://youtu.be/dQw4w9WgXcQ?si=zz' },
    });
    expect(r.json).toMatchObject({
      title: 'Mi Bachata',
      artist: 'Aventura',
      suggestedStyle: 'bachata',
      confidence: 'low',
    });
    expect(f.calls[0]).not.toContain('si=');
    expect((await c.repo.getEventPublic(c.id))!.requests).toHaveLength(0);
  });

  it('submits from a link', async () => {
    const c = await setup({ fetch: net() });
    const g = await c.join();
    const r = await submit(c, g, `https://open.spotify.com/track/${SP}?si=1`);
    expect(r.status).toBe(200);
    expect(r.json.request).toMatchObject({ title: 'Obsesión', provider: 'spotify' });
  });

  it('answers unsupported links in plain language with a 422', async () => {
    const c = await setup({ fetch: net() });
    const g = await c.join();
    for (const url of [
      'https://example.com/song',
      'https://spotify.link/x',
      'https://open.spotify.com/album/' + SP,
    ]) {
      const r = await submit(c, g, url);
      expect(r.status).toBe(422);
      expect(r.json.error.code).toBe('UNSUPPORTED_LINK');
    }
    expect(net().calls).toEqual([]);
  });

  it('reports a provider outage as METADATA_UNAVAILABLE so the client can go manual', async () => {
    const c = await setup({
      fetch: mockFetch({
        'https://open.spotify.com/oembed': () => new Response('x', { status: 503 }),
      }),
    });
    const r = await submit(c, await c.join(), `https://open.spotify.com/track/${SP}`);
    expect(r.status).toBe(502);
    expect(r.json.error.code).toBe('METADATA_UNAVAILABLE');
  });

  it('catches the same song from another platform by fingerprint, and holds a remix for review', async () => {
    const f = mockFetch({
      'https://open.spotify.com/oembed': (u) => ({
        title: u.searchParams.get('url')!.includes(SP2) ? 'Obsesión (Remix)' : 'Obsesión',
      }),
    });
    const c = await setup({ fetch: f });
    // Spotify oEmbed has no artist, so use manual entry with artist for the base song.
    const a = await c.join();
    expect((await c.manual(a, 'Obsesión', 'bachata', { artist: undefined })).status).toBe(200);
    // Manual entry normalised to "" artist; the Spotify link has the same (empty) artist → exact fingerprint hit.
    const dup = await submit(c, await c.join(), `https://open.spotify.com/track/${SP}`);
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe('DUPLICATE');
    const remix = await submit(c, await c.join(), `https://open.spotify.com/track/${SP2}`);
    expect(remix.status).toBe(200);
    expect(remix.json.request).toMatchObject({
      state: 'PENDING_METADATA',
      statusText: 'Possible duplicate — needs review',
    });
    const st = await c.api.admin('GET', c.id, '/admin/state');
    const held = st.json.requests.find((r: any) => r.possibleDuplicate);
    expect(held).toBeTruthy();
    expect(st.json.view.queue.map((q: any) => q.requestId)).not.toContain(held.id);
    const ok = await c.api.admin('POST', c.id, `/admin/duplicate/${held.id}`, {
      decision: 'approve',
    });
    expect(ok.status).toBe(200);
    const after = await c.api.admin('GET', c.id, '/admin/state');
    expect(after.json.requests.find((r: any) => r.id === held.id).state).toBe('QUEUED');
  });

  it('rate-limits resolve-link at 20/min/IP and submit at 10/min/participant', async () => {
    const c = await setup({
      fetch: mockFetch({ 'https://www.youtube.com/oembed': () => ({ title: 'A - B' }) }),
    });
    const body = { url: 'https://youtu.be/dQw4w9WgXcQ' };
    for (let i = 0; i < 20; i++)
      expect((await c.api.call('POST', '/api/resolve-link', { body })).status).toBe(200);
    const limited = await c.api.call('POST', '/api/resolve-link', { body });
    expect(limited.status).toBe(429);
    expect(limited.json.error.code).toBe('RATE_LIMITED');
    // a different IP is unaffected
    expect((await c.api.call('POST', '/api/resolve-link', { body, ip: '10.0.0.9' })).status).toBe(
      200,
    );
  });

  it('limits one participant to 10 submit attempts a minute, and event creation to 5 an hour', async () => {
    const c = await setup();
    const g = await c.join();
    for (let i = 0; i < 10; i++) await c.manual(g, `S${i}`);
    expect((await c.manual(g, 'again')).status).toBe(429);
    // window slides
    c.clock.advance(61_000);
    expect((await c.manual(g, 'later')).status).not.toBe(429);
    const ip = '10.9.9.9';
    for (let i = 0; i < 5; i++)
      expect(
        (await c.api.call('POST', '/api/events', { ip, body: { timezone: 'UTC' } })).status,
      ).toBe(201);
    expect(
      (await c.api.call('POST', '/api/events', { ip, body: { timezone: 'UTC' } })).status,
    ).toBe(429);
  });
});

describe('player and handover over HTTP', () => {
  it('claims, starts, finishes, and fences a stale player', async () => {
    const { api, id, join, manual } = await setup();
    const g = await join();
    const a = (await manual(g, 'A')).json.request.id as string;
    const claim = await api.admin('POST', id, '/player/claim', {});
    expect(claim.status).toBe(200);
    const lease = { leaseToken: claim.json.leaseToken, epoch: claim.json.lease.epoch };
    expect(
      (await api.call('POST', `/api/events/${id}/player/heartbeat`, { body: lease })).status,
    ).toBe(200);
    expect(
      (
        await api.call('POST', `/api/events/${id}/player/started`, {
          body: { ...lease, requestId: a },
        })
      ).status,
    ).toBe(200);
    const pub = await api.admin('GET', id, '/admin/state');
    expect(pub.json.view.nowPlaying.track.title).toBe('A');
    expect(
      (
        await api.call('POST', `/api/events/${id}/player/finished`, {
          body: { ...lease, requestId: a, outcome: 'PLAYED' },
        })
      ).status,
    ).toBe(200);
    expect((await api.admin('POST', id, '/player/claim', {})).json.error.code).toBe('STALE_LEASE');
    const take = await api.admin('POST', id, '/player/claim', { takeover: true });
    expect(take.status).toBe(200);
    const stale = await api.call('POST', `/api/events/${id}/player/heartbeat`, { body: lease });
    expect(stale.status).toBe(409);
    expect(stale.json.error.code).toBe('STALE_LEASE');
  });

  it('hands over admin: new cookie works, the old session does not', async () => {
    const { app, api, id } = await setup();
    const offer = await api.admin('POST', id, '/admin/handover', {});
    expect(offer.status).toBe(200);
    const next = new Client(app);
    const claim = await next.call('POST', `/api/events/${id}/admin/handover/claim`, {
      body: { code: offer.json.code },
    });
    expect(claim.status).toBe(200);
    expect((await next.admin('POST', id, '/admin/resume', {})).status).toBe(200);
    const old = await api.admin('POST', id, '/admin/pause', {});
    expect(old.status).toBe(401);
    expect(
      (
        await next.call('POST', `/api/events/${id}/admin/handover/claim`, {
          body: { code: offer.json.code },
        })
      ).status,
    ).toBe(401);
  });

  it('recovers admin access with the recovery secret', async () => {
    const { app, id, created } = await setup();
    const fresh = new Client(app);
    const r = await fresh.call('POST', `/api/events/${id}/admin/recover`, {
      body: { recoverySecret: created.recoverySecret },
    });
    expect(r.status).toBe(200);
    expect((await fresh.admin('GET', id, '/admin/state')).status).toBe(200);
    // the recovery secret is not an admin cookie value
    const forged = new Client(app);
    forged.cookies.set(`qa_${id}`, created.recoverySecret);
    expect((await forged.admin('GET', id, '/admin/state')).status).toBe(401);
  });
});

describe('admin state and carry-over', () => {
  it('echoes the CSRF token on state only, and lists unplayed songs for carry-over', async () => {
    const { app, api, id, join, manual } = await setup();
    const a = await join();
    await manual(a, 'One');
    await manual(await join(), 'Two', 'bachata');
    const st = await api.admin('GET', id, '/admin/state');
    expect(st.json.csrf).toBe(api.cookies.get(`qc_${id}`));
    expect(
      JSON.stringify((await api.call('GET', `/api/events/${id}/public`)).json ?? {}),
    ).not.toContain(st.json.csrf);
    const co = await api.admin('GET', id, '/admin/carry-over');
    expect(co.status).toBe(200);
    expect(co.json.recommendations.map((r: any) => r.title)).toEqual(['One', 'Two']);
    expect((await new Client(app).call('GET', `/api/events/${id}/admin/carry-over`)).status).toBe(
      401,
    );
  });
});

describe('misc routes', () => {
  it('exports a snapshot and imports it into a new draft with a new admin', async () => {
    const { api, id, join, manual, app } = await setup();
    await manual(await join(), 'One');
    await manual(await join(), 'Two', 'bachata');
    const snap = await api.call('GET', `/api/events/${id}/export`);
    expect(snap.status).toBe(200);
    expect(snap.json.recommendations).toHaveLength(2);
    expect(JSON.stringify(snap.json)).not.toMatch(/participant|token/i);
    const other = new Client(app);
    const imp = await other.call('POST', '/api/events/import', {
      body: { snapshot: snap.json, timezone: 'UTC', shuffle: true, plannedDurationMin: 120 },
    });
    expect(imp.status).toBe(201);
    expect(imp.json.seeded).toBe(2);
    expect(imp.json.eventId).not.toBe(id);
  });

  it('updates a draft, then freezes rules', async () => {
    const t = await testApp();
    apps.push(t.app);
    const c = await t.api.call('POST', '/api/events', { body: { timezone: 'UTC' } });
    const id = c.json.eventId;
    await t.api.call('POST', `/api/events/${id}/admin/session`, {
      body: { secret: new URL(c.json.adminUrl).hash.slice(3) },
    });
    expect((await t.api.admin('PATCH', id, '/admin/draft', { submissionLimit: 3 })).status).toBe(
      200,
    );
    expect((await t.api.admin('POST', id, '/start')).status).toBe(200);
    const late = await t.api.admin('PATCH', id, '/admin/draft', { submissionLimit: 9 });
    expect(late.status).toBe(409);
    expect(late.json.error.code).toBe('RULES_FROZEN');
  });

  it('keeps the SPA/docs 404 handler out of /api', async () => {
    const { api } = await setup();
    expect((await api.call('GET', '/api/nope')).status).toBe(404);
  });
});

describe('SSE stream', () => {
  async function readEvents(
    res: Response,
    n: number,
  ): Promise<Array<{ event: string; data: any }>> {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const out: Array<{ event: string; data: any }> = [];
    while (out.length < n) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.+)$/m.exec(block);
        const data = /^data: (.+)$/m.exec(block);
        if (ev && data) out.push({ event: ev[1]!, data: JSON.parse(data[1]!) });
      }
    }
    await reader.cancel();
    return out;
  }

  it('sends the state on connect and again after a change', async () => {
    const { app, api, id, join, manual, created } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/events/${id}/stream`);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const pending = readEvents(res, 2);
    await new Promise((r) => setTimeout(r, 50));
    await manual(await join('Zed'), 'Streamed');
    const [first, second] = await pending;
    expect(first).toMatchObject({ event: 'state', data: { slug: created.slug, state: 'ACTIVE' } });
    expect(second!.event).toBe('state');
    expect(second!.data.version).toBeGreaterThan(first!.data.version);
    expect(second!.data.queue[0].title).toBe('Streamed');
    expect(JSON.stringify(second)).not.toMatch(/token/);
    void api;
  });

  it('serves the admin stream only to admins', async () => {
    const { app, api, id } = await setup();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const port = (app.server.address() as { port: number }).port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/events/${id}/admin/stream`);
    expect(denied.status).toBe(401);
    const cookie = [...api.cookies].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
    const ok = await fetch(`http://127.0.0.1:${port}/api/events/${id}/admin/stream`, {
      headers: { cookie },
    });
    const [first] = await readEvents(ok, 1);
    expect(first!.data).toHaveProperty('requests');
    expect(first!.data).toHaveProperty('rulesHash');
  });
});

describe('one-tap event', () => {
  const page = (prefix: string) =>
    new Response(
      `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
        props: {
          pageProps: {
            state: {
              data: {
                entity: {
                  trackList: Array.from({ length: 14 }, (_, i) => ({
                    uri: `spotify:track:${prefix}${String(i).padStart(21, '0')}`,
                    title: `${prefix} ${i}`,
                    subtitle: 'House Band',
                    duration: 200000,
                    entityType: 'track',
                  })),
                },
              },
            },
          },
        },
      })}</script></html>`,
      { headers: { 'content-type': 'text/html' } },
    );
  const env = {
    STARTER_PLAYLIST_SALSA: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
    STARTER_PLAYLIST_BACHATA: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5N',
  };

  it('starts with ten songs of each genre from the house playlists and edits settings live', async () => {
    const f = mockFetch({
      'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M': () => page('S'),
      'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5N': () => page('B'),
    });
    const t = await testApp({ fetch: f, env });
    apps.push(t.app);
    const made = await t.api.call('POST', '/api/events', {
      body: { timezone: 'UTC', starter: true },
    });
    expect(made.status).toBe(201);
    expect(made.json.seeded).toBe(20);
    const id = made.json.eventId as string;
    await t.api.call('POST', `/api/events/${id}/admin/session`, {
      body: { secret: new URL(made.json.adminUrl).hash.slice(3) },
    });
    await t.api.admin('POST', id, '/start', {});
    let st = await t.api.admin('GET', id, '/admin/state');
    expect(st.json.plannedDurationMin).toBe(120);
    expect(st.json.guestsFirst).toBe(true);
    const styles = st.json.requests.map((r: any) => r.style);
    expect(styles.filter((s: string) => s === 'salsa')).toHaveLength(10);
    expect(styles.filter((s: string) => s === 'bachata')).toHaveLength(10);
    expect(st.json.requests.every((r: any) => r.starter && r.sourceUrl)).toBe(true);
    // A second event reuses the cached playlists.
    const again = await t.api.call('POST', '/api/events', {
      body: { timezone: 'UTC', starter: true },
    });
    expect(again.json.seeded).toBe(20);
    expect(f.calls).toHaveLength(2);

    const ok = await t.api.admin('POST', id, '/admin/settings', {
      plannedDurationMin: 180,
      submissionLimit: 30,
      guestsFirst: false,
    });
    expect(ok.status).toBe(200);
    st = await t.api.admin('GET', id, '/admin/state');
    expect(st.json).toMatchObject({ plannedDurationMin: 180, guestsFirst: false });
    expect(st.json.rules.submissionLimit).toBe(30);
    const bad = await t.api.admin('POST', id, '/admin/settings', { name: 'x' });
    expect(bad.status).toBe(400);
  });

  it('still creates the event when a house playlist cannot be read', async () => {
    const f = mockFetch({
      'https://open.spotify.com/embed/playlist/': () => new Response('nope', { status: 500 }),
    });
    const t = await testApp({ fetch: f, env });
    apps.push(t.app);
    const made = await t.api.call('POST', '/api/events', {
      body: { timezone: 'UTC', starter: true },
    });
    expect(made.status).toBe(201);
    expect(made.json.seeded).toBe(0);
  });
});
