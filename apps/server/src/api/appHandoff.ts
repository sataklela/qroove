import { randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BRAND } from '@qroove/config';
import { parse } from './errors.js';
import { requireSameOrigin, type Security } from '../security/tokens.js';

const TTL_MS = 60_000;
const MAX_PENDING = 500;

/**
 * Sign-in for the Android app (ADR 0029). Google refuses sign-in inside an app's WebView, so the
 * app opens Google/Spotify in a Chrome Custom Tab. Cookies set there stay in Chrome, so the
 * callback parks them here under a one-time code and sends the phone back into the app, which
 * redeems the code from its WebView to get the same cookies. Codes live 60 s in memory (one
 * server instance) and work once.
 */
export class AppHandoff {
  private readonly codes = new Map<string, { cookies: string[]; back: string; exp: number }>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  put(cookies: string[], back: string): string {
    this.sweep();
    if (this.codes.size >= MAX_PENDING) this.codes.delete(this.codes.keys().next().value!);
    const code = randomBytes(24).toString('base64url');
    this.codes.set(code, { cookies, back, exp: this.now() + TTL_MS });
    return code;
  }

  take(code: string): { cookies: string[]; back: string } | null {
    const v = this.codes.get(code);
    this.codes.delete(code);
    if (!v || v.exp < this.now()) return null;
    return { cookies: v.cookies, back: v.back };
  }

  private sweep() {
    const t = this.now();
    for (const [k, v] of this.codes) if (v.exp < t) this.codes.delete(k);
  }

  /**
   * Ends a Custom Tab sign-in: an Android intent link that opens the app with the code, falling
   * back to the same page on the site if the app is not installed.
   */
  send(reply: FastifyReply, base: string, back: string, cookies: string[], clear: string[]) {
    const code = this.put(cookies, back);
    const pkg = BRAND.android.packageId;
    const fallback = encodeURIComponent(`${base}${back}`);
    reply.header('set-cookie', clear);
    reply.header('cache-control', 'no-store');
    return reply.redirect(
      `intent://auth?code=${code}#Intent;scheme=${pkg};package=${pkg};S.browser_fallback_url=${fallback};end`,
    );
  }
}

/** The app's WebView swaps the code for the cookies (same origin only). */
export function registerAppHandoff(app: FastifyInstance, h: AppHandoff, sec: Security) {
  app.post('/api/app/redeem', async (req, reply) => {
    requireSameOrigin(sec, req);
    const { code } = parse(z.object({ code: z.string().min(16).max(64) }), req.body);
    const v = h.take(code);
    reply.header('cache-control', 'no-store');
    if (!v) return { ok: false as const, back: null };
    if (v.cookies.length > 0) reply.header('set-cookie', v.cookies);
    return { ok: true as const, back: v.back };
  });
}
