import { GENRES, STYLE_PRESETS, type GenreId } from '@qroove/config';
import { allowedStyles, type EventPublicView } from '@qroove/contracts';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError, type Creds, type PlaylistSong } from '../shared/api';
import { shortGenreLabel, styleBoxVars } from '../shared/Genre';
import { PlaylistInput } from '../shared/PlaylistInput';
import { SpotifyBrowse } from './SpotifyBrowse';
import { YouTubeBrowse } from './YouTubeBrowse';
import { SongList, type ListSong } from '../shared/SongList';

/** The most one request may carry; the rest can be added afterwards. */
const MAX_BATCH = 100;

let counter = 0;
const toList = (tracks: readonly PlaylistSong[]): ListSong[] =>
  tracks.map((t) => ({ ...t, id: `p${++counter}` }));

/**
 * The one place to add music: paste a playlist or song link (or search), then tap the genre to add.
 * Choosing the genre and adding are one tap. A playlist's songs can be sorted first (drag, swipe
 * left to remove, swipe right to send to the top). Only as many as the person has left can be
 * added, so the rest are greyed out.
 */
export function AddMusic({
  view,
  eventId,
  creds,
  remaining,
  quota,
  onAdded,
  onClose,
}: {
  view: EventPublicView;
  eventId: string;
  creds: Creds;
  /** How many more songs this person may still add. */
  remaining: number;
  /** Accepted songs against the person's limit, once the server has said; null while loading. */
  quota: { accepted: number; limit: number } | null;
  /** Called with a short message ("2 added.") once songs are in the queue. */
  onAdded: (message: string) => void;
  onClose: () => void;
}) {
  const allowed = view.rules ? allowedStyles(view.rules) : null;
  const styles = STYLE_PRESETS.filter((s) => !allowed || allowed.includes(s.id));
  const genres = GENRES.filter((g) => styles.some((s) => s.genre === g.id));
  const [url, setUrl] = useState('');
  const [songs, setSongs] = useState<ListSong[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // Playlists added by this person to this event, kept on this device (no server field exists for it).
  const addedKey = `qroove:pl-added:${eventId}:${creds.participantId}`;
  const [addedIds, setAddedIds] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(addedKey) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  const [loadedPlaylist, setLoadedPlaylist] = useState<string | null>(null);
  // Must stay stable: PlaylistInput reports tracks from an effect keyed on this function.
  const onTracks = useCallback((_id: string, tracks: PlaylistSong[]) => {
    setSongs(toList(tracks));
    if (tracks.length > 0) setError(null);
  }, []);

  const take = Math.min(remaining, songs.length, MAX_BATCH);
  const allowance =
    remaining === 0
      ? 'You have used all your songs for this event. Withdraw one that has not started to add another.'
      : songs.length === 0
        ? 'Paste a link or search, then tap the genre to add.'
        : take < songs.length
          ? `Only the first ${take} fit your allowance; the rest are greyed out.`
          : `Tap the genre of ${take === 1 ? 'this song' : `these ${take} songs`} to add ${take === 1 ? 'it' : 'them'}.`;

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      setError(
        new ApiError(
          'PASTE',
          'We could not read your clipboard.',
          'Long-press the box and choose Paste.',
          0,
        ),
      );
    }
  }

  /** Songs are sent under the first style the event allows in that genre. */
  async function add(genre: GenreId) {
    const style = styles.find((x) => x.genre === genre)?.id;
    if (!style || take === 0) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitBatch(
        eventId,
        creds,
        {
          style,
          songs: songs.slice(0, take).map(({ title, artist, durationMs, sourceUrl }) => ({
            title,
            artist,
            durationMs,
            sourceUrl,
          })),
        },
        crypto.randomUUID(),
      );
      const dup = r.results.filter((x) => x.status === 'DUPLICATE').length;
      const full = r.results.filter((x) => x.status === 'QUOTA_FULL').length;
      const message = `${r.accepted} added${dup ? `, ${dup} already queued` : ''}${
        full ? `, ${full} over your limit` : ''
      }.`;
      setUrl('');
      setSongs([]);
      if (loadedPlaylist && r.accepted > 0) {
        const next = [...new Set([...addedIds, loadedPlaylist])];
        setAddedIds(next);
        try {
          localStorage.setItem(addedKey, JSON.stringify(next));
        } catch {
          /* private mode: remembered until reload only */
        }
      }
      setLoadedPlaylist(null);
      onAdded(message);
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="add-sheet" aria-labelledby="am-h">
      <div className="card-head">
        <h2 id="am-h">Add music</h2>
        {quota ? (
          <span className="quota">
            {quota.accepted} of {quota.limit} songs
          </span>
        ) : null}
        <button type="button" className="btn ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="row">
        <PlaylistInput
          id="music"
          value={url}
          onChange={setUrl}
          onTracks={onTracks}
          label="Search Spotify or paste a link"
          placeholder="Search Spotify or paste a link"
        />
        <button type="button" className="btn" onClick={() => void paste()}>
          Paste
        </button>
      </div>
      <SpotifyBrowse
        slug={view.slug}
        text={url}
        onPick={(song) => {
          setSongs((old) =>
            old.some((o) => o.sourceUrl !== null && o.sourceUrl === song.sourceUrl)
              ? old
              : [...old, ...toList([song])],
          );
          setUrl('');
        }}
        addedIds={addedIds}
        onPlaylist={(tracks, id) => {
          setLoadedPlaylist(id);
          onTracks('music', tracks);
          // Once the menu has closed and the list is drawn, bring the loaded songs into view.
          setTimeout(
            () => listRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
            50,
          );
        }}
      />
      <YouTubeBrowse
        slug={view.slug}
        addedIds={addedIds}
        onPlaylist={(tracks, id) => {
          setLoadedPlaylist(id);
          onTracks('music', tracks);
          setTimeout(
            () => listRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }),
            50,
          );
        }}
      />
      <p className="validation" role="status">
        {allowance}
      </p>
      <div className="add-songs" ref={listRef}>
        {songs.length > 0 ? (
          <SongList songs={songs} onChange={setSongs} activeCount={take} label="Songs to add" />
        ) : null}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error.message} {error.action}
        </p>
      ) : null}
      <div className="genre-add" role="group" aria-label="Add as">
        {genres.map((g) => {
          const id = styles.find((x) => x.genre === g.id)!.id;
          return (
            <button
              key={g.id}
              type="button"
              className="btn genre-chip on add-as"
              style={styleBoxVars(id)}
              disabled={busy || take === 0}
              aria-busy={busy}
              onClick={() => void add(g.id)}
            >
              <span className="swatch" aria-hidden="true" style={{ width: 10, height: 10 }} />
              {busy ? 'Adding…' : `Add as ${shortGenreLabel(g.id)}`}
            </button>
          );
        })}
      </div>
    </section>
  );
}
