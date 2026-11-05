import { DomainError } from '@qroove/contracts';

/** Every host the server may ever contact. Anything else is refused before a socket opens. */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  'api.spotify.com',
  'accounts.spotify.com',
  'open.spotify.com',
  'itunes.apple.com',
  'www.youtube.com',
  'www.googleapis.com',
  'music.apple.com',
]);

export const TIMEOUT_MS = 3000;
export const MAX_BYTES = 256 * 1024;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * SSRF-safe JSON fetch: https only, fixed hosts, no redirects, 3 s timeout, 256 KB cap. Failures
 * are reported as METADATA_UNAVAILABLE so callers fall back to manual entry.
 */
export async function fetchJson(
  doFetch: FetchLike,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new DomainError('METADATA_UNAVAILABLE', 'Blocked host');
  }
  try {
    const res = await doFetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_BYTES) throw new Error('too large');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error('too large');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    if (e instanceof DomainError) throw e;
    throw new DomainError('METADATA_UNAVAILABLE');
  }
}
