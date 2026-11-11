import type { StyleId } from './styles.js';

/**
 * House playlists: a new one-tap event starts with a few songs from each, so the music can begin
 * before anyone has asked for anything. Public Spotify, Apple Music or YouTube playlist links
 * (the same kinds the playlist importer reads). Links are per style; a genre's styles are mixed together. A style without a link adds nothing.
 */
export const STARTER_PLAYLISTS: Partial<Record<StyleId, readonly string[]>> = {
  salsa: [
    'https://open.spotify.com/playlist/12k0ligO1ZLpetaTRLQC12', // salsa, 100 bpm
    'https://open.spotify.com/playlist/4wWhwtnZIPIcxAifhXU0cI', // salsa, 120 bpm
  ],
  salsa_nl: ['https://open.spotify.com/playlist/78nRKh3WcwPwR6QMmlg6zR'],
  bachata: ['https://open.spotify.com/playlist/3PbBzYXzpMey4k2WoH3JYr'],
  bachata_nl: ['https://open.spotify.com/playlist/0mJA7Z7agM34BpbAJXckhJ'],
  chacha: ['https://open.spotify.com/playlist/3VsLjjAEeZg6imwlYtpLf2'],
};

/** How many starter songs each genre gets. */
export const STARTER_PER_GENRE = 10;

/** "abc123" -> "ABC-123": the permanent room code, as two easy-to-say triplets. */
export const formatRoomCode = (slug: string): string => {
  const c = slug.toUpperCase();
  return `${c.slice(0, 3)}-${c.slice(3)}`;
};
