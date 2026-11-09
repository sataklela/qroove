import { useEffect, useState } from 'react';
import { api, ApiError, type PlaylistSong } from '../shared/api';

const KEY = 'qroove.ytChannel';
const read = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

/**
 * "My YouTube playlist". Signed in with Google (read-only YouTube access), the guest's own playlists
 * are listed, private ones and Liked music included. Without a login, a channel link or @handle
 * lists that channel's public playlists instead.
 */
export function YouTubeBrowse({
  slug,
  onPlaylist,
  addedIds = [],
}: {
  slug: string;
  onPlaylist: (tracks: PlaylistSong[], playlistId: string) => void;
  addedIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(read);
  const [lists, setLists] = useState<Array<{ id: string; name: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const added = new Set(addedIds);
  const [mine, setMine] = useState<Array<{ id: string; name: string }> | null>(null);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .myYoutubePlaylists()
      .then((r) => {
        if (!live) return;
        setAvailable(r.available);
        if (r.signedIn) setMine(r.playlists);
      })
      .catch((e: unknown) => {
        if (live && e instanceof ApiError) setProblem(`${e.message} ${e.action}`);
      });
    return () => {
      live = false;
    };
  }, []);
  const [loginProblem] = useState(() => {
    const g = new URLSearchParams(window.location.search).get('google');
    return g ? 'The Google login did not finish. You can still paste a playlist link.' : null;
  });

  const fail = (e: unknown, fallback: string) =>
    setProblem(e instanceof ApiError ? `${e.message} ${e.action}` : fallback);

  async function find() {
    setBusy('find');
    setProblem(null);
    try {
      const { playlists } = await api.youtubePlaylists(channel.trim());
      setLists(playlists);
      try {
        localStorage.setItem(KEY, channel.trim());
      } catch {
        /* remembering the channel is a convenience only */
      }
      if (playlists.length === 0) {
        setProblem('No public playlists found. Make the playlist public, or paste its link.');
      }
    } catch (e) {
      fail(e, 'We could not look that up.');
    } finally {
      setBusy(null);
    }
  }

  async function pick(id: string) {
    setBusy(id);
    setProblem(null);
    try {
      const { tracks } = mine?.some((p) => p.id === id)
        ? await api.myYoutubePlaylist(id)
        : await api.resolvePlaylist(`https://www.youtube.com/playlist?list=${id}`);
      setOpen(false);
      onPlaylist(tracks, id);
    } catch (e) {
      fail(e, 'We could not load that playlist.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <details className="pl-picker" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary className="btn pill">My YouTube playlist</summary>
        {mine === null && available ? (
          <p className="muted small">
            <a href={`/api/google/login?return=${encodeURIComponent(`/e/${slug}`)}`}>
              Log in with Google
            </a>{' '}
            to use your own playlists, private ones too. We only get read-only access to your
            playlists.
          </p>
        ) : null}
        {mine === null ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (channel.trim().length >= 3) void find();
            }}
          >
            <input
              type="text"
              aria-label="Your YouTube channel link or @handle"
              placeholder="Channel link or @handle"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            />
            <button type="submit" className="btn" disabled={busy !== null}>
              {busy === 'find' ? 'Looking…' : 'Find'}
            </button>
          </form>
        ) : null}
        {mine === null ? (
          <p className="muted small">Without logging in: public playlists of a channel only.</p>
        ) : null}
        {(mine ?? lists)?.length ? (
          <ul className="search-results">
            {(mine ?? lists ?? []).map((p) =>
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
                    disabled={busy !== null}
                    onClick={() => void pick(p.id)}
                  >
                    <span className="result-title">{busy === p.id ? 'Loading…' : p.name}</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </details>
      {(problem ?? loginProblem) ? (
        <p className="error small" role="alert">
          {problem ?? loginProblem}
        </p>
      ) : null}
    </>
  );
}
