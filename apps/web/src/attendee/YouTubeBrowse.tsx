import { useState } from 'react';
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
 * "My YouTube playlist": paste a channel link or @handle, pick one of its public playlists. No
 * sign-in, so private playlists are not offered. Songs then load like any pasted playlist link.
 */
export function YouTubeBrowse({
  onPlaylist,
  addedIds = [],
}: {
  onPlaylist: (tracks: PlaylistSong[], playlistId: string) => void;
  addedIds?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState(read);
  const [lists, setLists] = useState<Array<{ id: string; name: string }> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const added = new Set(addedIds);

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
      const { tracks } = await api.resolvePlaylist(`https://www.youtube.com/playlist?list=${id}`);
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
        <p className="muted small">Public playlists only. Private ones: paste the link instead.</p>
        {lists?.length ? (
          <ul className="search-results">
            {lists.map((p) =>
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
      {problem ? (
        <p className="error small" role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
