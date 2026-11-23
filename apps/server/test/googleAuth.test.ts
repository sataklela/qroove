import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { parseEnv } from '../src/env.js';

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

const json = (body: unknown) => new Response(JSON.stringify(body));

async function setup(configured = true) {
  const calls: Array<{ url: string; body: string; auth: string }> = [];
  const app = await buildApp(
    parseEnv({
      NODE_ENV: 'test',
      COOKIE_SECRET: 'x'.repeat(32),
      ...(configured ? { GOOGLE_OAUTH_CLIENT_ID: 'gid', GOOGLE_OAUTH_CLIENT_SECRET: 'gsecret' } : {}),
    }),
    {
      fetch: async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url,
          body: String(init?.body ?? ''),
          auth: headers.get('authorization') ?? '',
        });
        if (url.startsWith('https://oauth2.googleapis.com/token')) {
          return json({ access_token: 'access', expires_in: 3600, refresh_token: 'refresh-me' });
        }
        if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('');
        if (url.includes('/playlists?')) {
          return json({ items: [{ id: 'PLabc', snippet: { title: 'Salsa night' } }] });
        }
        if (url.includes('/playlistItems?')) {
          return json({ items: [{ contentDetails: { videoId: 'vid1' } }] });
        }
        if (url.includes('/videos?')) {
          return json({
            items: [
              {
                id: 'vid1',
                snippet: {
                  title: 'Marc Anthony - Vivir Mi Vida (Official Video)',
                  channelTitle: 'X',
                },
                contentDetails: { duration: 'PT4M10S' },
              },
            ],
          });
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    },
  );
  apps.push(app);
  return { app, calls };
}
const cookiesOf = (res: { headers: Record<string, unknown> }) =>
  ([res.headers['set-cookie']].flat() as string[]).map((c) => c.split(';')[0]!).join('; ');

describe('Google sign-in', () => {
  it('logs in, keeps the refresh token out of the page, and lists playlists and songs', async () => {
    const { app, calls } = await setup();
    const login = await app.inject('/api/google/login?return=/e/ev1');
    const to = new URL(login.headers.location as string);
    expect(to.hostname).toBe('accounts.google.com');
    expect(to.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/youtube.readonly');
    expect(to.searchParams.get('access_type')).toBe('offline');
    const state = to.searchParams.get('state')!;

    const cb = await app.inject({
      url: `/api/google/callback?code=c&state=${state}`,
      headers: { cookie: cookiesOf(login) },
    });
    expect(cb.headers.location).toBe('/e/ev1');
    const jar = cookiesOf(cb);
    expect(jar).not.toContain('refresh-me');

    const mine = await app.inject({ url: '/api/google/me/playlists', headers: { cookie: jar } });
    expect(mine.json()).toMatchObject({
      available: true,
      signedIn: true,
      playlists: [
        { id: 'LL', name: 'Liked music' },
        { id: 'PLabc', name: 'Salsa night' },
      ],
    });
    expect(mine.body).not.toContain('access');
    expect(calls.find((c) => c.url.includes('/playlists?'))?.auth).toBe('Bearer access');

    const songs = await app.inject({
      url: '/api/google/me/playlists/PLabc',
      headers: { cookie: jar },
    });
    expect(songs.json()).toEqual({
      tracks: [
        {
          title: 'Vivir Mi Vida',
          artist: 'Marc Anthony',
          durationMs: 250_000,
          sourceUrl: 'https://www.youtube.com/watch?v=vid1',
        },
      ],
    });
    const out = await app.inject({
      method: 'POST',
      url: '/api/google/logout',
      headers: { cookie: jar, origin: 'http://localhost:3000' },
    });
    expect(out.statusCode).toBe(200);
    expect(calls.find((c) => c.url.includes('/revoke'))?.body).toBe('token=refresh-me');
    expect(String(out.headers['set-cookie'])).toContain('qg_session=; ');
  });

  it('signs the Android app in through a Custom Tab with a one-time code (ADR 0029)', async () => {
    const { app } = await setup();
    const login = await app.inject('/api/google/login?return=/e/ev1&app=1');
    const state = new URL(login.headers.location as string).searchParams.get('state')!;
    const cb = await app.inject({
      url: `/api/google/callback?code=c&state=${state}`,
      headers: { cookie: cookiesOf(login) },
    });
    // The Custom Tab gets no session cookie; it is sent back into the app with a code.
    const to = cb.headers.location as string;
    expect(to).toMatch(/^intent:\/\/auth\?code=[\w-]+#Intent;scheme=com\.sataklela\.qroove;/);
    expect(String(cb.headers['set-cookie'])).not.toMatch(/qg_session=[^;]/);
    const code = /code=([\w-]+)/.exec(to)![1]!;
    const redeem = (c: string) =>
      app.inject({
        method: 'POST',
        url: '/api/app/redeem',
        headers: { origin: 'http://localhost:3000' },
        payload: { code: c },
      });
    const r = await redeem(code);
    expect(r.json()).toEqual({ ok: true, back: '/e/ev1' });
    const jar = cookiesOf(r);
    expect(jar).toMatch(/qg_session=./);
    const mine = await app.inject({ url: '/api/google/me/playlists', headers: { cookie: jar } });
    expect(mine.json()).toMatchObject({ signedIn: true });
    expect((await redeem(code)).json()).toEqual({ ok: false, back: null }); // once only
    const cross = await app.inject({
      method: 'POST',
      url: '/api/app/redeem',
      headers: { origin: 'https://evil.example' },
      payload: { code },
    });
    expect(cross.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('ignores a callback it did not start and refuses songs when signed out', async () => {
    const { app } = await setup();
    const cb = await app.inject('/api/google/callback?code=c&state=forged');
    expect(cb.headers.location).toBe('/');
    expect(cb.headers['set-cookie']).not.toContain('qg_session=');
    const songs = await app.inject('/api/google/me/playlists/PLabc');
    expect(songs.statusCode).toBe(401);
    const mine = await app.inject('/api/google/me/playlists');
    expect(mine.json()).toMatchObject({ available: true, signedIn: false });
  });

  it('reports itself unavailable, and does not redirect, without a client', async () => {
    const { app } = await setup(false);
    const mine = await app.inject('/api/google/me/playlists');
    expect(mine.json()).toEqual({ available: false, signedIn: false, playlists: [] });
    expect((await app.inject('/api/google/login?return=/e/ev1')).statusCode).toBe(502);
  });

  it('refuses a return path outside an event page', async () => {
    const { app } = await setup();
    expect((await app.inject('/api/google/login?return=//evil.example')).statusCode).toBe(400);
  });
});
