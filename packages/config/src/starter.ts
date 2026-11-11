import type { GenreId } from './styles.js';

/**
 * House playlists: a new one-tap event starts with a few songs from each, so the music can begin
 * before anyone has asked for anything. Public Spotify, Apple Music or YouTube playlist links
 * (the same kinds the playlist importer reads). A genre without a link gets no starter songs.
 */
export const STARTER_PLAYLISTS: Partial<Record<GenreId, string>> = {
  // salsa: 'https://open.spotify.com/playlist/…',
  // bachata: 'https://open.spotify.com/playlist/…',
};

/** How many starter songs each genre gets. */
export const STARTER_PER_GENRE = 10;

/** "abc123" -> "ABC-123": the permanent room code, as two easy-to-say triplets. */
export const formatRoomCode = (slug: string): string => {
  const c = slug.toUpperCase();
  return `${c.slice(0, 3)}-${c.slice(3)}`;
};
