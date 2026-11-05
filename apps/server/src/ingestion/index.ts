import type { Provider, StyleId } from '@qroove/contracts';
import { DomainError } from '@qroove/contracts';
import { fingerprint, looseKey } from '../domain/keys.js';
import type { TrackInput } from '../domain/commands/requests.js';
import type { FetchLike } from './fetch.js';
import { parseLink, type ParsedLink, type Platform } from './parseLink.js';
import { ItunesProvider } from './providers/itunes.js';
import { OEmbedProvider } from './providers/oembed.js';
import { SpotifyApiProvider } from './providers/spotify.js';
import {
  fetchPlaylist,
  fetchSong,
  parsePlaylistUrl,
  type Playlist,
  type PlaylistTrack,
} from './playlist.js';
import { suggestStyle } from './style.js';
import type { MetadataProvider, TrackMetadata } from './types.js';

export interface ResolvedTrack {
  track: TrackInput;
  confidence: 'high' | 'medium' | 'low' | 'manual';
  suggestedStyle: StyleId | null;
}

export interface Ingestion {
  /**
   * A public playlist or song link → its tracks (one for a song), with metadata from the source.
   * Best effort: these pages are not a stable API.
   */
  resolvePlaylist(url: string): Promise<Playlist>;
  resolveUrl(url: string): Promise<ResolvedTrack>;
  searchSongs(q: string): Promise<PlaylistTrack[]>;
  resolveManual(m: {
    title: string;
    artist?: string | undefined;
    durationMs?: number | undefined;
  }): ResolvedTrack;
}

export interface IngestionOptions {
  fetch: FetchLike;
  now: () => number;
  spotify?: { id: string; secret: string } | undefined;
}

/** Key priority: ISRC → platform id → fingerprint. Every exact identity also blocks duplicates. */
export function toTrack(m: TrackMetadata, url: string): TrackInput {
  const artist = m.artists.length ? m.artists.join(', ') : null;
  const fp = fingerprint(m.title, m.artists[0] ?? null);
  const platformKey = `${m.source}:${m.externalId}`;
  const canonicalKey = m.isrc ? `isrc:${m.isrc}` : platformKey;
  const aliasKeys = [platformKey, fp].filter((k) => k !== canonicalKey);
  return {
    canonicalKey,
    aliasKeys,
    looseKey: looseKey(m.title, m.artists[0] ?? null),
    provider: m.source as Provider,
    title: m.title,
    artist,
    durationMs: m.durationMs,
    artworkUrl: m.artworkUrl,
    sourceUrl: url,
  };
}

export function createIngestion(opts: IngestionOptions): Ingestion {
  const oembed = new OEmbedProvider(opts.fetch);
  const itunes = new ItunesProvider(opts.fetch);
  const spotifyApi = opts.spotify
    ? new SpotifyApiProvider(opts.fetch, opts.spotify, opts.now)
    : null;
  const chains: Record<Platform, MetadataProvider[]> = {
    spotify: spotifyApi ? [spotifyApi, oembed] : [oembed],
    apple: [itunes],
    youtube: [oembed],
  };
  async function resolveUrl(url: string): Promise<ResolvedTrack> {
    const link = parseLink(url);
    let last: unknown;
    for (const p of chains[link.platform]) {
      try {
        const meta = await p.lookup(link);
        return {
          track: toTrack(meta, link.canonicalUrl),
          confidence: meta.confidence,
          suggestedStyle: suggestStyle(meta.title),
        };
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof DomainError ? last : new DomainError('METADATA_UNAVAILABLE');
  }
  return {
    async resolvePlaylist(url) {
      let isPlaylist = true;
      try {
        parsePlaylistUrl(url);
      } catch {
        isPlaylist = false;
      }
      if (isPlaylist) return fetchPlaylist(opts.fetch, url);
      let link: ParsedLink;
      try {
        link = parseLink(url);
      } catch {
        throw new DomainError('UNSUPPORTED_LINK', 'Paste a Spotify link to a playlist or a song.');
      }
      const song = await fetchSong(opts.fetch, link);
      if (song) return { platform: link.platform, tracks: [song] };
      const { track } = await resolveUrl(url);
      return {
        platform: link.platform,
        tracks: [
          {
            title: track.title,
            artist: track.artist,
            durationMs: track.durationMs,
            sourceUrl: track.sourceUrl,
          },
        ],
      };
    },
    resolveUrl,
    async searchSongs(q) {
      if (!spotifyApi) throw new DomainError('METADATA_UNAVAILABLE');
      return spotifyApi.search(q);
    },
    resolveManual(m) {
      const artist = m.artist?.trim() || null;
      const fp = fingerprint(m.title, artist);
      return {
        track: {
          canonicalKey: fp,
          aliasKeys: [],
          looseKey: looseKey(m.title, artist),
          provider: 'manual',
          title: m.title,
          artist,
          durationMs: m.durationMs ?? null,
          artworkUrl: null,
          sourceUrl: null,
        },
        confidence: 'manual',
        suggestedStyle: suggestStyle(m.title),
      };
    },
  };
}
