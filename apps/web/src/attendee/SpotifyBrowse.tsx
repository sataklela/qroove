import { useEffect, useState } from 'react';
import { api, ApiError, type PlaylistSong } from '../shared/api';

const hasLink = (text: string) => /https?:\/\//i.test(text);

/**
 * Finding music inside Qroove: Spotify search for everyone, and the person's own playlists if they
 * log in (Spotify limits that to the accounts on the pilot list).
 */
export function SpotifyBrowse({
  slug,
  text,
  onPick,
  onPlaylist,
  addedIds = [],
}: {
  slug: string;
  /** What is typed in the shared field: words search, links are handled by the field itself. */
  text: string;
  onPick: (song: PlaylistSong) => void;
  onPlaylist: (tracks: PlaylistSong[], playlistId: string) => void;
  /** Playlists this person has already added to this event (shown first, disabled). */
  addedIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  // A confirmed add collapses the list so the success message is what the person sees.
  const addedCount = addedIds.length;
  const [seen, setSeen] = useState(addedCount);
  if (addedCount !== seen) {
    setSeen(addedCount);
    setOpen(false);
  }
  const q = text.trim();
  const searchable = q.length >= 2 && !hasLink(q);
  const [found, setFound] = useState<{
    q: string;
    tracks: PlaylistSong[];
    error: ApiError | null;
  } | null>(null);
  const [mine, setMine] = useState<Array<{ id: string; name: string }> | null>(null);
  const [problem, setProblem] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has('spotify')
      ? 'The Spotify login did not finish. You can still search or paste links.'
      : null,
  );
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    if (!searchable) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      api
        .searchSpotify(q, ctl.signal)
        .then((r) => setFound({ q, tracks: r.tracks ?? [], error: null }))
        .catch((e: unknown) => {
          if (e instanceof ApiError) setFound({ q, tracks: [], error: e });
        });
    }, 400);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, searchable]);

  useEffect(() => {
    let live = true;
    api
      .myPlaylists()
      .then((r) => {
        if (live && r.signedIn) setMine(r.playlists ?? []);
      })
      .catch((e: unknown) => {
        if (live && e instanceof ApiError) setProblem(`${e.message} ${e.action}`);
      });
    return () => {
      live = false;
    };
  }, []);

  async function openPlaylist(id: string) {
    setLoading(id);
    setProblem(null);
    try {
      const { tracks } = await api.myPlaylist(id);
      // Picking a playlist closes the menu, so the songs it loaded are what the person sees.
      setOpen(false);
      onPlaylist(tracks, id);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'We could not load that playlist.');
    } finally {
      setLoading(null);
    }
  }

  const added = new Set(addedIds);
  const results = searchable && found?.q === q ? found : null;
  return (
    <>
      {results?.error ? (
        <p className="error small" role="alert">
          {results.error.message} {results.error.action}
        </p>
      ) : null}
      {results && !results.error && results.tracks.length === 0 ? (
        <p className="muted small">No songs found.</p>
      ) : null}
      {results?.tracks.length ? (
        <ul className="search-results" aria-label="Search results">
          {results.tracks.map((t) => (
            <li key={t.sourceUrl ?? t.title}>
              <button type="button" className="btn ghost result" onClick={() => onPick(t)}>
                {t.artworkUrl ? (
                  <img className="result-art" src={t.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span className="result-art" aria-hidden="true" />
                )}
                <span className="result-text">
                  <span className="result-title">{t.title}</span>
                  {t.artist ? <span className="result-artist">{t.artist}</span> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {mine ? (
        <>
          <details
            className="pl-picker"
            open={open}
            onToggle={(e) => setOpen(e.currentTarget.open)}
          >
            <summary className="btn pill">My Spotify playlist</summary>
            <ul className="search-results">
              {[
                ...mine.filter((p) => added.has(p.id)),
                ...mine.filter((p) => !added.has(p.id)),
              ].map((p) =>
                added.has(p.id) ? (
                  <li key={p.id}>
                    <button type="button" className="btn ghost result added" disabled>
                      <span className="result-title">{p.name}</span>
                      <span className="added-badge">
                        <span aria-hidden="true">✓ </span>Added
                      </span>
                    </button>
                  </li>
                ) : (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="btn ghost result"
                      disabled={loading !== null}
                      onClick={() => void openPlaylist(p.id)}
                    >
                      <span className="result-title">{loading === p.id ? 'Loading…' : p.name}</span>
                    </button>
                  </li>
                ),
              )}
            </ul>
          </details>
          {addedCount > 0 ? (
            <p className="pl-added-note" role="status">
              <span aria-hidden="true">✓ </span>Playlist added
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted small">
          <a href={`/api/spotify/login?for=guest&return=${encodeURIComponent(`/e/${slug}`)}`}>
            Log in with Spotify
          </a>{' '}
          to use your own playlists. Only works for accounts on the pilot list.
        </p>
      )}
      {problem ? (
        <p className="error small" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
