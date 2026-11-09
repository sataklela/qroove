import { DomainError } from '@qroove/contracts';
import { DEFAULT_DURATION_MS } from '@qroove/scheduler';
import { fingerprint } from '../domain/keys.js';
import { ALLOWED_HOSTS, type FetchLike } from './fetch.js';
import type { ParsedLink, Platform } from './parseLink.js';

export interface PlaylistTrack {
  title: string;
  artist: string | null;
  durationMs: number | null;
  sourceUrl: string | null;
}

export interface Playlist {
  platform: Platform;
  tracks: PlaylistTrack[];
}

interface Target {
  platform: Platform;
  /** Rebuilt from validated parts only, so tracking parameters and odd hosts never reach the network. */
  url: string;
}

const bad = (m?: string) => new DomainError('UNSUPPORTED_LINK', m);
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Pure. Accepts public playlist links from Spotify, YouTube / YouTube Music and Apple Music. */
export function parsePlaylistUrl(raw: string): Target {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw bad('That does not look like a playlist link.');
  }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) throw bad();
  const host = u.hostname.toLowerCase();

  if (host === 'open.spotify.com') {
    const m = /^\/(?:intl-[a-z]+\/)?playlist\/([A-Za-z0-9]{10,40})\/?$/.exec(u.pathname);
    if (!m) throw bad('Paste a Spotify playlist link (open.spotify.com/playlist/…).');
    return { platform: 'spotify', url: `https://open.spotify.com/embed/playlist/${m[1]}` };
  }
  if (['www.youtube.com', 'youtube.com', 'music.youtube.com', 'm.youtube.com'].includes(host)) {
    const list = u.searchParams.get('list');
    if (u.pathname !== '/playlist' && u.pathname !== '/watch') throw bad();
    if (!list || !ID.test(list))
      throw bad('Paste a Spotify playlist link (open.spotify.com/playlist/…).');
    // A song opened in YouTube Music carries its generated radio mix (RD…): the link means that song.
    if (u.searchParams.get('v') && list.startsWith('RD')) throw bad();
    // YouTube Music playlists are ordinary YouTube playlists underneath.
    return { platform: 'youtube', url: `https://www.youtube.com/playlist?list=${list}` };
  }
  if (host === 'music.apple.com') {
    const m = /^\/([a-z]{2})\/playlist\/([^/]{1,120})\/(pl\.[A-Za-z0-9]{8,64})\/?$/.exec(
      u.pathname,
    );
    if (!m) throw bad('Paste a Spotify playlist link (open.spotify.com/playlist/…).');
    return {
      platform: 'apple',
      url: `https://music.apple.com/${m[1]}/playlist/${encodeURIComponent(decodeURIComponent(m[2]!))}/${m[3]}`,
    };
  }
  throw bad('Paste a Spotify playlist link (open.spotify.com/playlist/…).');
}

const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 8000;
const UA = 'Mozilla/5.0 (compatible; QrooveBot/1.0; +https://qroove.sataklela.com/docs)';

async function fetchPage(doFetch: FetchLike, t: Target): Promise<string> {
  const u = new URL(t.url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new DomainError('METADATA_UNAVAILABLE', 'Blocked host');
  }
  try {
    const res = await doFetch(t.url, {
      redirect: 'error',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      headers: {
        'user-agent': UA,
        'accept-language': 'en',
        // Public playlist pages only; SOCS=CAI is the "consent already given" marker that skips YouTube's EU consent redirect.
        ...(t.platform === 'youtube' ? { cookie: 'SOCS=CAI; CONSENT=YES+1' } : {}),
      },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_PAGE_BYTES) {
        await reader.cancel();
        throw new Error('too large');
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch {
    throw new DomainError(
      'METADATA_UNAVAILABLE',
      'We could not read that playlist. Make sure it is public, or try another link.',
    );
  }
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function walk(node: unknown, visit: (o: Json) => void): void {
  if (Array.isArray(node)) for (const v of node) walk(v, visit);
  else if (isObj(node)) {
    visit(node);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function jsonAfter(html: string, marker: string): unknown {
  const i = html.indexOf(marker);
  if (i < 0) return null;
  try {
    // `raw_decode`-style: parse the first complete JSON value after the marker.
    const rest = html.slice(i + marker.length);
    let depth = 0;
    let inStr = false;
    for (let k = 0; k < rest.length; k++) {
      const ch = rest[k]!;
      if (inStr) {
        if (ch === '\\') k++;
        else if (ch === '"') inStr = false;
      } else if (ch === '"') inStr = true;
      else if (ch === '{' || ch === '[') depth++;
      else if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) return JSON.parse(rest.slice(0, k + 1));
      }
    }
  } catch {
    /* fall through */
  }
  return null;
}

function scriptJson(html: string, openTag: RegExp): unknown {
  const m = openTag.exec(html);
  if (!m) return null;
  const end = html.indexOf('</script>', m.index + m[0].length);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(m.index + m[0].length, end));
  } catch {
    return null;
  }
}

/** Spotify's public embed page lists the tracks (title, artists, length) without an API key. */
export function parseSpotify(html: string): PlaylistTrack[] {
  const data = scriptJson(html, /<script id="__NEXT_DATA__"[^>]*>/);
  const out: PlaylistTrack[] = [];
  walk(data, (o) => {
    if (!Array.isArray(o.trackList)) return;
    for (const t of o.trackList) {
      if (!isObj(t) || t.entityType !== 'track') continue;
      const title = str(t.title);
      if (!title) continue;
      const id = /^spotify:track:([A-Za-z0-9]+)$/.exec(String(t.uri ?? ''))?.[1];
      out.push({
        title,
        artist: str(t.subtitle),
        durationMs:
          typeof t.duration === 'number' && t.duration > 0 ? Math.round(t.duration) : null,
        sourceUrl: id ? `https://open.spotify.com/track/${id}` : null,
      });
    }
  });
  return out;
}

/** Apple Music playlist pages embed their track list as JSON. */
export function parseApple(html: string): PlaylistTrack[] {
  const data = scriptJson(html, /<script[^>]*id="serialized-server-data"[^>]*>/);
  const out: PlaylistTrack[] = [];
  const seen = new Set<string>();
  walk(data, (o) => {
    if (typeof o.id !== 'string' || !o.id.startsWith('track-lockup')) return;
    const title = str(o.title);
    if (!title || seen.has(o.id)) return;
    seen.add(o.id);
    out.push({
      title,
      artist: str(o.artistName),
      durationMs: typeof o.duration === 'number' && o.duration > 0 ? Math.round(o.duration) : null,
      sourceUrl: null,
    });
  });
  return out;
}

const clock = (text: string): number | null => {
  const parts = text.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0) * 1000;
};

/** "Artist - Title (Official Video)" → artist/title, with the usual video decoration removed. */
export function cleanVideoTitle(
  raw: string,
  channel: string | null,
): { title: string; artist: string | null } {
  const stripped = raw
    .replace(
      /\s*[([](?:official|lyric|lyrics|audio|video|music video|visuali[sz]er|hd|4k)[^)\]]*[)\]]/gi,
      '',
    )
    .replace(/\s*-\s*topic$/i, '')
    .trim();
  const i = stripped.indexOf(' - ');
  if (i > 0) return { artist: stripped.slice(0, i).trim(), title: stripped.slice(i + 3).trim() };
  return { title: stripped, artist: channel?.replace(/\s*-\s*Topic$/i, '') ?? null };
}

/** Handles both YouTube page layouts: `playlistVideoRenderer` and the newer `lockupViewModel`. */
export function parseYouTube(html: string): PlaylistTrack[] {
  const data = jsonAfter(html, 'ytInitialData = ');
  const out: PlaylistTrack[] = [];
  const seen = new Set<string>();
  const push = (id: string, rawTitle: string | null, channel: string | null, ms: number | null) => {
    if (!rawTitle || seen.has(id)) return;
    seen.add(id);
    const { title, artist } = cleanVideoTitle(rawTitle, channel);
    if (title)
      out.push({
        title,
        artist,
        durationMs: ms,
        sourceUrl: `https://www.youtube.com/watch?v=${id}`,
      });
  };
  walk(data, (o) => {
    const r = o.playlistVideoRenderer;
    if (isObj(r) && typeof r.videoId === 'string') {
      const t =
        isObj(r.title) && Array.isArray(r.title.runs) ? str((r.title.runs[0] as Json)?.text) : null;
      const by =
        isObj(r.shortBylineText) && Array.isArray(r.shortBylineText.runs)
          ? str((r.shortBylineText.runs[0] as Json)?.text)
          : null;
      const secs = Number(r.lengthSeconds);
      push(r.videoId, t, by, Number.isFinite(secs) && secs > 0 ? secs * 1000 : null);
    }
    const l = o.lockupViewModel;
    if (
      isObj(l) &&
      l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' &&
      typeof l.contentId === 'string'
    ) {
      const meta =
        isObj(l.metadata) && isObj(l.metadata.lockupMetadataViewModel)
          ? l.metadata.lockupMetadataViewModel
          : null;
      const title = meta && isObj(meta.title) ? str(meta.title.content) : null;
      let channel: string | null = null;
      let ms: number | null = null;
      if (meta) {
        walk(meta.metadata, (m) => {
          if (channel === null && isObj(m.text)) channel = str(m.text.content);
        });
      }
      walk(l.contentImage, (b) => {
        if (ms === null && isObj(b.thumbnailBadgeViewModel)) {
          const text = str(b.thumbnailBadgeViewModel.text);
          if (text && /^\d+:\d{2}(:\d{2})?$/.test(text)) ms = clock(text);
        }
      });
      push(l.contentId, title, channel, ms);
    }
  });
  return out;
}

/** A Spotify song's public embed page has its title, artists and length. */
export function parseSpotifySong(html: string, sourceUrl: string): PlaylistTrack | null {
  let song: PlaylistTrack | null = null;
  walk(scriptJson(html, /<script id="__NEXT_DATA__"[^>]*>/), (o) => {
    const e = o.entity;
    if (song || !isObj(e) || e.type !== 'track') return;
    const title = str(e.title) ?? str(e.name);
    if (!title) return;
    const artists = Array.isArray(e.artists)
      ? e.artists.map((a) => (isObj(a) ? str(a.name) : null)).filter(Boolean)
      : [];
    song = {
      title,
      artist: artists.length ? artists.join(', ') : null,
      durationMs: typeof e.duration === 'number' && e.duration > 0 ? Math.round(e.duration) : null,
      sourceUrl,
    };
  });
  return song;
}

/** A YouTube watch page has the video's title, channel and length. */
export function parseYouTubeSong(html: string, sourceUrl: string): PlaylistTrack | null {
  const data = jsonAfter(html, 'ytInitialPlayerResponse = ');
  const d = isObj(data) && isObj(data.videoDetails) ? data.videoDetails : null;
  const raw = d ? str(d.title) : null;
  if (!d || !raw) return null;
  const { title, artist } = cleanVideoTitle(raw, str(d.author));
  const secs = Number(d.lengthSeconds);
  return {
    title,
    artist,
    durationMs: Number.isFinite(secs) && secs > 0 ? secs * 1000 : null,
    sourceUrl,
  };
}

/** Best effort: null when the page cannot be read or parsed, so the caller can try other sources. */
export async function fetchSong(
  doFetch: FetchLike,
  link: ParsedLink,
): Promise<PlaylistTrack | null> {
  try {
    if (link.platform === 'spotify') {
      const url = `https://open.spotify.com/embed/track/${link.id}`;
      return parseSpotifySong(
        await fetchPage(doFetch, { platform: 'spotify', url }),
        link.canonicalUrl,
      );
    }
    if (link.platform === 'youtube') {
      const html = await fetchPage(doFetch, { platform: 'youtube', url: link.canonicalUrl });
      return parseYouTubeSong(html, link.canonicalUrl);
    }
  } catch {
    /* fall through */
  }
  return null;
}

export async function fetchPlaylist(doFetch: FetchLike, rawUrl: string): Promise<Playlist> {
  const target = parsePlaylistUrl(rawUrl);
  const html = await fetchPage(doFetch, target);
  const parse = { spotify: parseSpotify, apple: parseApple, youtube: parseYouTube }[
    target.platform
  ];
  const tracks = parse(html);
  if (tracks.length === 0) {
    throw new DomainError(
      'METADATA_UNAVAILABLE',
      'We found no songs in that playlist. Make sure it is public and not empty.',
    );
  }
  return { platform: target.platform, tracks };
}

/**
 * Keeps playlist order and adds songs while the total stays within `maxMs`. A song that does not
 * fit is skipped so shorter ones after it can still use the remaining time. Unknown lengths count
 * as the scheduler's default, so the cap is never exceeded by guesswork.
 */
export function capPlaytime<
  T extends { durationMs: number | null; title: string; artist: string | null },
>(songs: readonly T[], maxMs: number, maxSongs = Infinity): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const s of songs) {
    if (out.length >= maxSongs) break;
    const fp = fingerprint(s.title, s.artist);
    if (seen.has(fp)) continue;
    const d = s.durationMs ?? DEFAULT_DURATION_MS;
    if (total + d > maxMs) continue;
    seen.add(fp);
    total += d;
    out.push(s);
  }
  return out;
}

/** Takes one song from each list in turn, so every playlist (and so every genre) is represented. */
export function interleave<T>(lists: ReadonlyArray<readonly T[]>): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]!);
  return out;
}
