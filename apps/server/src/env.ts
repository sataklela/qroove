import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_BASE_URL: z.string().default('http://localhost:3000'),
  REPO_DRIVER: z.enum(['memory', 'firestore']).optional(),
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_B64: z.string().optional(),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  COOKIE_SECRET: z.string().optional(),
  /** Test rigs only (ignored in production): e2e and load runs share one IP. */
  RATE_LIMIT_OFF: z.enum(['1']).optional(),
  CRON_SECRET: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
  SPOTIFY_DEV_CLIENT_ID: z.string().optional(),
  /** Google OAuth client (Web application) for guests' own YouTube playlists; without it only public channels work. */
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  /** YouTube Data API v3 key (restricted to that API); without it songs play only via Spotify. */
  YOUTUBE_API_KEY: z.string().optional(),
  RAILWAY_GIT_COMMIT_SHA: z.string().optional(),
  WEB_DIST: z.string().optional(),
  DOCS_DIST: z.string().optional(),
});

export type Env = z.infer<typeof schema> & { REPO_DRIVER: 'memory' | 'firestore' };

const blank = (v: string | undefined) => (v === '' ? undefined : v);

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(Object.entries(source).map(([k, v]) => [k, blank(v)]));
  const parsed = schema.parse(cleaned);
  const hasCreds = Boolean(
    parsed.FIREBASE_SERVICE_ACCOUNT_B64 ||
    parsed.GOOGLE_APPLICATION_CREDENTIALS ||
    parsed.FIRESTORE_EMULATOR_HOST,
  );
  return { ...parsed, REPO_DRIVER: parsed.REPO_DRIVER ?? (hasCreds ? 'firestore' : 'memory') };
}
