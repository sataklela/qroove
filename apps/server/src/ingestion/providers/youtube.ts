import { DomainError } from '@qroove/contracts';
import { norm } from '../../domain/keys.js';
import type { Repository } from '../../db/ports.js';
import { fetchJson, type FetchLike } from '../fetch.js';

/**
 * Finds the YouTube video that is the same recording as a Spotify song, so the organiser's page
 * can play it in YouTube's own embedded player. Metadata stays Spotify's; only playback differs.
 */
export interface SongQuery {
  title: string;
  artist: string | null;
  durationMs: number | null;
}

export interface VideoCandidate {
  id: string;
  title: string;
  channel: string;
  durationMs: number;
}

const MAX_RESULTS = 3;
/** A candidate scoring below this is not trusted to be the same recording. */
const THRESHOLD = 40;
const REJECT_DIFF_MS = 15_000;
const CLOSE_DIFF_MS = 3_000;
/** Misses are kept for a week; found matches do not change. */
export const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const UNWANTED = [
  'live',
  'cover',
  'karaoke',
  'remix',
  'sped up',
  'slowed',
  'reverb',
  'instrumental',
];

const hasWord = (text: string, word: string) => ` ${text} `.includes(` ${word} `);

/** Pure: ranks candidates, best first, dropping any that are not convincingly the same song. */
export function rankCandidates(song: SongQuery, found: readonly VideoCandidate[]): string[] {
  const wantTitle = norm(song.title);
  const wantArtist = song.artist ? norm(song.artist) : '';
  const scored: Array<{ id: string; score: number }> = [];
  for (const v of found) {
    const title = norm(v.title);
    const channel = norm(v.channel);
    let score = 0;

    if (song.durationMs !== null) {
      const diff = Math.abs(v.durationMs - song.durationMs);
      if (diff > REJECT_DIFF_MS) continue;
      score += diff <= CLOSE_DIFF_MS ? 50 : 20;
    }
    if (wantTitle && title.includes(wantTitle)) score += 30;
    else continue;
    if (wantArtist && (title.includes(wantArtist) || channel.includes(wantArtist))) score += 20;
    if (/ - topic$/i.test(v.channel)) score += 15;
    if (/official audio/i.test(v.title)) score += 10;
    // A different recording (live, cover, remix...) is never an acceptable stand-in.
    if (UNWANTED.some((word) => hasWord(title, word) && !hasWord(wantTitle, word))) continue;
    if (score >= THRESHOLD) scored.push({ id: v.id, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map((s) => s.id);
}

/** "PT3M45S" → milliseconds. Live streams and malformed values give 0, which never matches. */
export function isoDurationMs(iso: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return 0;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

/** What a person typed to say whose playlists they want: a channel link, an @handle or a channel id. */
export type ChannelRef =
  | { kind: 'handle'; value: string }
  | { kind: 'id'; value: string }
  | { kind: 'user'; value: string };

/** Pure: turns a pasted channel link, "@handle" or "UC…" id into something the API can look up. */
export function parseChannelRef(input: string): ChannelRef | null {
  const text = input.trim();
  if (/^UC[\w-]{22}$/.test(text)) return { kind: 'id', value: text };
  if (/^@[\w.-]{3,30}$/.test(text)) return { kind: 'handle', value: text };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (!/^(www\.|m\.|music\.)?youtube\.com$/i.test(url.hostname)) return null;
  const [first, second] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (first?.startsWith('@') && /^@[\w.-]{3,30}$/.test(first))
    return { kind: 'handle', value: first };
  if (first === 'channel' && second && /^UC[\w-]{22}$/.test(second))
    return { kind: 'id', value: second };
  if (first === 'user' && second && /^[\w.-]{1,40}$/.test(second))
    return { kind: 'user', value: second };
  return null;
}

export interface ChannelPlaylist {
  id: string;
  name: string;
}

interface ChannelsResponse {
  items?: Array<{ id?: string }>;
}
interface PlaylistsResponse {
  items?: Array<{ id?: string; snippet?: { title?: string } }>;
}

interface SearchResponse {
  items?: Array<{ id?: { videoId?: string } }>;
}
interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: { title?: string; channelTitle?: string };
    contentDetails?: { duration?: string };
  }>;
}

export class YouTubeMatcher {
  constructor(
    private readonly doFetch: FetchLike,
    private readonly apiKey: string | undefined,
    private readonly repo: Pick<Repository, 'getYouTubeMatch' | 'putYouTubeMatch'>,
    private readonly now: () => number,
  ) {}

  /**
   * Ranked video ids for a Spotify track (empty when none fits, no key is set, or the daily quota
   * is spent). Cached by Spotify id, so a song costs API quota at most once a week.
   */
  async match(spotifyId: string, song: SongQuery): Promise<string[]> {
    if (!this.apiKey) return [];
    const cached = await this.repo.getYouTubeMatch(spotifyId);
    if (cached && (cached.videoIds.length > 0 || this.now() - cached.checkedAt < MISS_TTL_MS)) {
      return cached.videoIds;
    }
    let ids: string[];
    try {
      ids = rankCandidates(song, await this.lookup(song));
    } catch (e) {
      // Quota or an outage is not a verdict on the song, so nothing is cached.
      if (e instanceof DomainError) return [];
      throw e;
    }
    await this.repo.putYouTubeMatch(spotifyId, { videoIds: ids, checkedAt: this.now() });
    return ids;
  }

  private async lookup(song: SongQuery): Promise<VideoCandidate[]> {
    const q = [song.artist, song.title].filter(Boolean).join(' ');
    const search = new URLSearchParams({
      part: 'id',
      type: 'video',
      q,
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      maxResults: '5',
      key: this.apiKey!,
    });
    const found = (await fetchJson(
      this.doFetch,
      `https://www.googleapis.com/youtube/v3/search?${search}`,
    )) as SearchResponse;
    const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((x): x is string => !!x);
    if (ids.length === 0) return [];
    const details = new URLSearchParams({
      part: 'snippet,contentDetails',
      id: ids.join(','),
      key: this.apiKey!,
    });
    const videos = (await fetchJson(
      this.doFetch,
      `https://www.googleapis.com/youtube/v3/videos?${details}`,
    )) as VideosResponse;
    return (videos.items ?? []).map((v) => ({
      id: v.id,
      title: v.snippet?.title ?? '',
      channel: v.snippet?.channelTitle ?? '',
      durationMs: isoDurationMs(v.contentDetails?.duration ?? ''),
    }));
  }

  /**
   * The public playlists of a YouTube channel (a person's own, if they paste their channel link).
   * Needs no sign-in, so private playlists and the "Liked music" list are not available; both
   * calls cost one quota unit each. Returns null when no key is set.
   */
  async channelPlaylists(ref: ChannelRef): Promise<ChannelPlaylist[] | null> {
    if (!this.apiKey) return null;
    const lookup = new URLSearchParams({ part: 'id', key: this.apiKey });
    lookup.set(
      ref.kind === 'handle' ? 'forHandle' : ref.kind === 'user' ? 'forUsername' : 'id',
      ref.value,
    );
    const channel = (await fetchJson(
      this.doFetch,
      `https://www.googleapis.com/youtube/v3/channels?${lookup}`,
    )) as ChannelsResponse;
    const channelId = channel.items?.[0]?.id;
    if (!channelId) return [];
    const list = new URLSearchParams({
      part: 'snippet',
      channelId,
      maxResults: '50',
      key: this.apiKey,
    });
    const found = (await fetchJson(
      this.doFetch,
      `https://www.googleapis.com/youtube/v3/playlists?${list}`,
    )) as PlaylistsResponse;
    return (found.items ?? []).flatMap((p) =>
      p.id && p.snippet?.title ? [{ id: p.id, name: p.snippet.title }] : [],
    );
  }
}
