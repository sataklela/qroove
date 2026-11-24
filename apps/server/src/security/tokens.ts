import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DomainError } from '@qroove/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const adminCookieName = (eventId: string) => `qa_${eventId}`;
export const csrfCookieName = (eventId: string) => `qc_${eventId}`;
export const CSRF_HEADER = 'x-qroove-csrf';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    // Other sites on the domain (or extensions) may set cookies that are not URI-encoded: one bad
    // cookie must not turn every request into a 500. Ours are always encoded, so skip the rest.
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      /* not ours */
    }
  }
  return out;
}

export interface Security {
  secure: boolean;
  /** Allowed `Origin` values for state-changing cookie-authenticated requests. */
  origins: ReadonlySet<string>;
  csrfFor(adminSecret: string): string;
}

export function createSecurity(opts: {
  publicBaseUrl: string;
  production: boolean;
  cookieSecret?: string | undefined;
}): Security {
  const key = opts.cookieSecret ?? randomBytes(32).toString('hex');
  const origins = new Set([new URL(opts.publicBaseUrl).origin]);
  if (!opts.production) {
    for (const o of ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'])
      origins.add(o);
  }
  return {
    secure: opts.production,
    origins,
    // Bound to the admin secret, so a CSRF token cannot be used for another admin session.
    csrfFor: (secret) => createHmac('sha256', key).update(secret).digest('base64url'),
  };
}

export function setAdminSession(
  sec: Security,
  reply: FastifyReply,
  eventId: string,
  adminSecret: string,
): string {
  const csrf = sec.csrfFor(adminSecret);
  const flags = `Path=/api/events/${eventId}; SameSite=Strict${sec.secure ? '; Secure' : ''}; Max-Age=${7 * 86400}`;
  reply.header('set-cookie', [
    `${adminCookieName(eventId)}=${encodeURIComponent(adminSecret)}; HttpOnly; ${flags}`,
    `${csrfCookieName(eventId)}=${encodeURIComponent(csrf)}; ${flags}`,
  ]);
  return csrf;
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function requireSameOrigin(sec: Security, req: FastifyRequest) {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !sec.origins.has(origin)) throw new DomainError('UNAUTHORISED');
}

/** Reads the admin capability from its cookie; mutating requests also need origin + CSRF. */
export function adminFromRequest(sec: Security, req: FastifyRequest, eventId: string): string {
  const jar = parseCookies(req.headers.cookie);
  const secret = jar[adminCookieName(eventId)];
  if (!secret) throw new DomainError('UNAUTHORISED');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    requireSameOrigin(sec, req);
    const header = req.headers[CSRF_HEADER];
    const cookie = jar[csrfCookieName(eventId)];
    if (
      typeof header !== 'string' ||
      !cookie ||
      !same(header, cookie) ||
      !same(header, sec.csrfFor(secret))
    ) {
      throw new DomainError('UNAUTHORISED');
    }
  }
  return secret;
}

/** `Authorization: Bearer <participantId>:<token>` */
export function participantFromRequest(req: FastifyRequest): {
  participantId: string;
  token: string;
} {
  const m = /^Bearer ([A-Za-z0-9]{1,64}):([A-Za-z0-9_-]{20,100})$/.exec(
    req.headers.authorization ?? '',
  );
  if (!m) throw new DomainError('UNAUTHORISED');
  return { participantId: m[1]!, token: m[2]! };
}
