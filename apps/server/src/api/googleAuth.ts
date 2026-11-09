import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { DomainError } from '@qroove/contracts';
import { parse } from './errors.js';
import { fetchJson, type FetchLike } from '../ingestion/fetch.js';
import { cleanVideoTitle } from '../ingestion/playlist.js';
import { isoDurationMs } from '../ingestion/providers/youtube.js';
import { parseCookies, requireSameOrigin, type Security } from '../security/tokens.js';

// Read-only access to the guest's YouTube account: playlists and the songs in them, nothing else.
const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
const STATE_COOKIE = 'qg_state';
const SESSION_COOKIE = 'qg_session';
const SESSION_MAX_AGE = 180 * 86400;
const RETURN_PATH = /^\/e\/[A-Za-z0-9_-]{1,64}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{2,64}$/;
const API = 'https://www.googleapis.com/youtube/v3';
const NOT_ALLOWED =
  'Google would not share this account’s playlists. It may not be on the test-user list yet. You can still paste a playlist link.';

const TokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
});
const MyPlaylists = z.object({
  items: z
    .array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) }))
    .default([]),
});
const Items = z.object({
  items: z.array(z.object({ contentDetails: z.object({ videoId: z.string() }) })).default([]),
});
const Videos = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string(), channelTitle: z.string().optional() }),
        contentDetails: z.object({ duration: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

export interface GoogleAuthOptions {
  base: string;
  creds: { id: string; secret: string } | undefined;
  cookieSecret: string | undefined;
  doFetch: FetchLike;
  sec: Security;
  limit: (key: string, max: number, windowMs: number) => void;
}

/**
 * Google sign-in for guests who want to add their own YouTube playlists, the same shape as the
 * Spotify guest login (ADR 0020): the refresh token lives in an encrypted HttpOnly cookie on the
 * guest's device and nothing is stored here; the page never receives a Google token.
 */
export function registerGoogleAuth(app: FastifyInstance, o: GoogleAuthOptions) {
  const key = createHash('sha256')
    .update(o.cookieSecret ?? randomBytes(32))
    .update('google-session')
    .digest();
  const seal = (text: string) => {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
  };
  const open = (sealed: string | undefined): string | null => {
    if (!sealed) return null;
    try {
      const raw = Buffer.from(sealed, 'base64url');
      const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      d.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
    } catch {
      return null;
    }
  };
  const cookie = (name: string, value: string, maxAge: number) =>
    // Lax: the state cookie must come back on the redirect from Google.
    `${name}=${encodeURIComponent(value)}; HttpOnly; Path=/api/google; SameSite=Lax${
      o.sec.secure ? '; Secure' : ''
    }; Max-Age=${maxAge}`;
  const redirectUri = `${o.base}/api/google/callback`;
  const backTo = (reply: FastifyReply, path: string, cookies: string[]) => {
    reply.header('set-cookie', cookies);
    reply.header('cache-control', 'no-store');
    return reply.redirect(path);
  };

  const tokenRequest = async (params: Record<string, string>) => {
    const t = TokenResponse.safeParse(
      await fetchJson(o.doFetch, 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: o.creds!.id,
          client_secret: o.creds!.secret,
          ...params,
        }).toString(),
      }),
    );
    if (!t.success) throw new DomainError('METADATA_UNAVAILABLE');
    return t.data;
  };
  const accessToken = async (cookieHeader: string | undefined) => {
    const refresh = open(parseCookies(cookieHeader)[SESSION_COOKIE]);
    if (!refresh || !o.creds) return null;
    return (await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh }))
      .access_token;
  };

  app.get('/api/google/login', async (req, reply) => {
    o.limit(`google-login:${req.ip}`, 10, 60_000);
    const { return: back } = parse(z.object({ return: z.string().regex(RETURN_PATH) }), req.query);
    if (!o.creds) throw new DomainError('METADATA_UNAVAILABLE');
    const state = randomBytes(16).toString('hex');
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: o.creds.id,
      scope: SCOPE,
      redirect_uri: redirectUri,
      state,
      // offline + consent make Google issue a refresh token every time, not only on first consent.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
    });
    return backTo(reply, `https://accounts.google.com/o/oauth2/v2/auth?${q}`, [
      cookie(STATE_COOKIE, `${state}|${back}`, 600),
    ]);
  });

  app.get('/api/google/callback', async (req, reply) => {
    const q = z
      .object({
        state: z.string().optional(),
        code: z.string().optional(),
        error: z.string().optional(),
      })
      .parse(req.query);
    const [state, back] = (parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '').split('|');
    const clear = cookie(STATE_COOKIE, '', 0);
    // A callback we did not start must not sign anyone in or choose where they land.
    if (!state || !back || !RETURN_PATH.test(back) || q.state !== state || !o.creds) {
      return backTo(reply, '/', [clear]);
    }
    if (!q.code) return backTo(reply, `${back}?google=denied`, [clear]);
    try {
      const t = await tokenRequest({
        grant_type: 'authorization_code',
        code: q.code,
        redirect_uri: redirectUri,
      });
      if (!t.refresh_token) throw new Error('no refresh token');
      return backTo(reply, back, [
        clear,
        cookie(SESSION_COOKIE, seal(t.refresh_token), SESSION_MAX_AGE),
      ]);
    } catch {
      return backTo(reply, `${back}?google=failed`, [clear]);
    }
  });

  // `available` says whether the login button should be shown at all; signed-out is a normal state.
  app.get('/api/google/me/playlists', async (req, reply) => {
    o.limit(`google-me:${req.ip}`, 30, 60_000);
    reply.header('cache-control', 'no-store');
    if (!o.creds) return { available: false, signedIn: false, playlists: [] };
    const token = await accessToken(req.headers.cookie).catch(() => null);
    if (!token) return { available: true, signedIn: false, playlists: [] };
    try {
      const r = MyPlaylists.parse(
        await fetchJson(o.doFetch, `${API}/playlists?part=snippet&mine=true&maxResults=50`, {
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      return {
        available: true,
        signedIn: true,
        // "Liked music" is the special playlist id LL; it is not returned by the list call.
        playlists: [
          { id: 'LL', name: 'Liked music' },
          ...r.items.map((p) => ({ id: p.id, name: p.snippet.title })),
        ],
      };
    } catch {
      throw new DomainError('METADATA_UNAVAILABLE', NOT_ALLOWED);
    }
  });

  app.get('/api/google/me/playlists/:id', async (req, reply) => {
    o.limit(`google-me:${req.ip}`, 30, 60_000);
    reply.header('cache-control', 'no-store');
    const { id } = parse(z.object({ id: z.string().regex(PLAYLIST_ID) }), req.params);
    const token = await accessToken(req.headers.cookie).catch(() => null);
    if (!token) throw new DomainError('UNAUTHORISED');
    const headers = { authorization: `Bearer ${token}` };
    const fail = () =>
      new DomainError('METADATA_UNAVAILABLE', 'We could not load that playlist from YouTube.');
    try {
      const items = Items.parse(
        await fetchJson(
          o.doFetch,
          `${API}/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(id)}&maxResults=50`,
          { headers },
        ),
      );
      const ids = [...new Set(items.items.map((i) => i.contentDetails.videoId))];
      if (ids.length === 0) throw fail();
      // Titles and lengths come from the videos themselves (playlist rows can hold stale titles).
      const videos = Videos.parse(
        await fetchJson(
          o.doFetch,
          `${API}/videos?part=snippet,contentDetails&id=${ids.join(',')}&maxResults=50`,
          { headers },
        ),
      );
      const byId = new Map(videos.items.map((v) => [v.id, v]));
      const tracks = ids.flatMap((vid) => {
        const v = byId.get(vid);
        if (!v) return [];
        const { title, artist } = cleanVideoTitle(v.snippet.title, v.snippet.channelTitle ?? null);
        const ms = isoDurationMs(v.contentDetails?.duration ?? '');
        return title
          ? [
              {
                title: title.slice(0, 200),
                artist: artist?.slice(0, 200) ?? null,
                durationMs: ms > 0 ? ms : null,
                sourceUrl: `https://www.youtube.com/watch?v=${vid}`,
              },
            ]
          : [];
      });
      if (tracks.length === 0) throw fail();
      return { tracks };
    } catch (e) {
      throw e instanceof DomainError ? e : fail();
    }
  });

  app.post('/api/google/logout', async (req, reply) => {
    requireSameOrigin(o.sec, req);
    reply.header('set-cookie', [cookie(SESSION_COOKIE, '', 0)]);
    return { ok: true };
  });
}
