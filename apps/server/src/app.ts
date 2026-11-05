import { YouTubeMatcher } from './ingestion/providers/youtube.js';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { createRepository } from './db/index.js';
import type { Repository } from './db/ports.js';
import { systemClock, type Clock } from './domain/clock.js';
import { randomIds } from './domain/ids.js';
import { registerErrors } from './api/errors.js';
import { registerRoutes } from './api/routes.js';
import { registerSpotifyAuth } from './api/spotifyAuth.js';
import { parseEnv, type Env } from './env.js';
import { runPurge, schedulePurge, secretMatches } from './maintenance/purge.js';
import { createIngestion } from './ingestion/index.js';
import type { FetchLike } from './ingestion/fetch.js';
import { EventBus } from './realtime/bus.js';
import { RateLimiter } from './security/rateLimit.js';
import { createSecurity } from './security/tokens.js';
import { registerStatic } from './static.js';

export const VERSION = '0.3.0';

const here = dirname(fileURLToPath(import.meta.url));

export interface AppOverrides {
  repo?: Repository;
  clock?: Clock;
  fetch?: FetchLike;
  /** Run the retention purge now and every 6 h (the entry point turns this on). */
  schedulePurge?: boolean;
}

export async function buildApp(
  env: Env = parseEnv(),
  overrides: AppOverrides = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    bodyLimit: 16 * 1024,
    // Railway terminates TLS in front of us; trust it for the client IP used by rate limits.
    trustProxy: true,
    logger:
      env.NODE_ENV === 'test'
        ? false
        : {
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                '*.token',
                '*.secret',
              ],
              censor: '[redacted]',
            },
          },
  });

  await app.register(helmet, {
    // YouTube's embed refuses to play without a referrer. Only the origin is sent cross-origin.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: [
          "'self'",
          'data:',
          'https://i.scdn.co',
          'https://*.mzstatic.com',
          'https://i.ytimg.com',
        ],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'", 'https://api.spotify.com'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // Official players only (see ADR 0017); no audio ever passes through this server.
        scriptSrc: ["'self'", 'https://www.youtube.com', 'https://sdk.scdn.co'],
        frameSrc: ['https://www.youtube.com', 'https://open.spotify.com', 'https://sdk.scdn.co'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  });
  // VitePress emits small inline bootstrap scripts, so /docs needs 'unsafe-inline' for scripts.
  app.addHook('onSend', async (req, reply) => {
    const csp = reply.getHeader('content-security-policy');
    if (typeof csp === 'string' && (req.url === '/docs' || req.url.startsWith('/docs/'))) {
      reply.header(
        'content-security-policy',
        csp.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      );
    }
  });
  await app.register(compress);

  const clock = overrides.clock ?? systemClock;
  const repo = overrides.repo ?? (await createRepository(env));
  const limiter = new RateLimiter(() => clock.now());
  const spotify =
    (env.SPOTIFY_CLIENT_ID ?? env.SPOTIFY_DEV_CLIENT_ID) && env.SPOTIFY_CLIENT_SECRET
      ? {
          id: (env.SPOTIFY_CLIENT_ID ?? env.SPOTIFY_DEV_CLIENT_ID)!,
          secret: env.SPOTIFY_CLIENT_SECRET,
        }
      : undefined;
  const bus = new EventBus(repo);
  registerErrors(app);
  const sec = createSecurity({
    publicBaseUrl: env.PUBLIC_BASE_URL,
    production: env.NODE_ENV === 'production',
    cookieSecret: env.COOKIE_SECRET,
  });
  const doFetch: FetchLike = overrides.fetch ?? ((url, init) => fetch(url, init));
  registerSpotifyAuth(app, {
    base: env.PUBLIC_BASE_URL.replace(/\/$/, ''),
    creds: spotify,
    cookieSecret: env.COOKIE_SECRET,
    doFetch,
    sec,
    limit: (key, max, windowMs) =>
      env.RATE_LIMIT_OFF === '1' && env.NODE_ENV !== 'production'
        ? undefined
        : limiter.check(key, max, windowMs),
  });
  registerRoutes(app, {
    deps: { repo, clock, ids: randomIds },
    env,
    ingestion: createIngestion({
      fetch: doFetch,
      now: () => clock.now(),
      spotify,
    }),
    youtube: new YouTubeMatcher(doFetch, env.YOUTUBE_API_KEY, repo, () => clock.now()),
    bus,
    sec,
    limiter,
  });
  // Internal: external schedulers (or an operator) can trigger retention with the shared secret.
  app.post('/api/internal/purge', async (req, reply) => {
    const h = req.headers['x-cron-secret'];
    if (!env.CRON_SECRET) return reply.code(404).send({ error: { code: 'NOT_FOUND' } });
    if (!secretMatches(typeof h === 'string' ? h : undefined, env.CRON_SECRET)) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORISED', message: 'Not allowed.', action: '' } });
    }
    return runPurge(repo, clock);
  });
  let stopPurge: (() => void) | undefined;
  app.addHook('onReady', async () => {
    if (overrides.schedulePurge) stopPurge = schedulePurge(repo, clock, app.log);
  });
  app.addHook('onClose', async () => {
    stopPurge?.();
    bus.close();
    limiter.close();
    await repo.close();
  });

  app.get('/api/health', async () => ({
    ok: true,
    version: VERSION,
    commit: env.RAILWAY_GIT_COMMIT_SHA ?? null,
  }));

  await registerStatic(app, {
    web: env.WEB_DIST ?? resolve(here, '../../web/dist'),
    docs: env.DOCS_DIST ?? resolve(here, '../../../docs/.vitepress/dist'),
  });

  return app;
}
