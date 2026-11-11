import { GENRES, STARTER_PER_GENRE, STARTER_PLAYLISTS, type GenreId } from '@qroove/config';
import type { StyleId } from '@qroove/contracts';
import type { SeedSong } from '../domain/draft.js';
import { safeSourceUrl } from './parseLink.js';
import { capPlaytime, interleave, type Playlist } from './playlist.js';

const TTL_MS = 6 * 60 * 60_000;

export interface StarterSource {
  /** Starter songs for a new event: a random few from each house playlist, genres in turn. */
  pick(styles: readonly StyleId[], rand: () => number, maxMs: number): Promise<SeedSong[]>;
}

/**
 * House playlists (ADR 0027). Each list is read through the ordinary playlist importer and kept
 * in memory for six hours; if a later read fails the last good copy is used. A playlist that
 * cannot be read at all simply gives no songs: creating an event never fails because of it.
 */
export function createStarter(opts: {
  resolvePlaylist: (url: string) => Promise<Playlist>;
  now: () => number;
  playlists?: Partial<Record<GenreId, string>>;
  perGenre?: number;
}): StarterSource {
  const links = opts.playlists ?? STARTER_PLAYLISTS;
  const perGenre = opts.perGenre ?? STARTER_PER_GENRE;
  const cache = new Map<string, { at: number; tracks: Playlist['tracks'] }>();

  async function load(url: string): Promise<Playlist['tracks']> {
    const hit = cache.get(url);
    if (hit && opts.now() - hit.at < TTL_MS) return hit.tracks;
    try {
      const { tracks } = await opts.resolvePlaylist(url);
      cache.set(url, { at: opts.now(), tracks });
      return tracks;
    } catch {
      return hit?.tracks ?? [];
    }
  }

  return {
    async pick(styles, rand, maxMs) {
      const lists: SeedSong[][] = [];
      for (const g of GENRES) {
        const url = links[g.id];
        // The genre's own (Latin) style carries the id of the genre.
        const style = styles.find((s) => s === g.id);
        if (!url || !style) continue;
        const tracks = [...(await load(url))];
        // Fisher–Yates, so each event starts with a different few.
        for (let i = tracks.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [tracks[i], tracks[j]] = [tracks[j]!, tracks[i]!];
        }
        lists.push(
          capPlaytime(tracks, Infinity, perGenre).map((t) => ({
            title: t.title,
            artist: t.artist,
            durationMs: t.durationMs,
            sourceUrl: safeSourceUrl(t.sourceUrl),
            style,
          })),
        );
      }
      return capPlaytime(interleave(lists), maxMs);
    },
  };
}
