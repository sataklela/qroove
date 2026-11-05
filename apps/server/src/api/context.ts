import type { Deps } from '../domain/context.js';
import type { Env } from '../env.js';
import type { Ingestion } from '../ingestion/index.js';
import type { YouTubeMatcher } from '../ingestion/providers/youtube.js';
import type { EventBus } from '../realtime/bus.js';
import type { RateLimiter } from '../security/rateLimit.js';
import type { Security } from '../security/tokens.js';

export interface ApiContext {
  deps: Deps;
  env: Env;
  ingestion: Ingestion;
  youtube: YouTubeMatcher;
  bus: EventBus;
  sec: Security;
  limiter: RateLimiter;
}
