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

/** "Other (Musicality Exercise)" -> "OTHER". */
const shout = (label: string) => label.split(' (')[0]!.toUpperCase();

/** "You selected SALSA. Remove all BACHATA, CHA-CHA, OTHER songs." */
export function genreAdvice(genre: GenreId): string {
  const label = (id: GenreId) => shout(GENRES.find((g) => g.id === id)!.label);
  const others = GENRES.filter((g) => g.id !== genre).map((g) => label(g.id));
  return `You selected ${label(genre)}. Remove all ${others.join(', ')} songs.`;
}

/**
 * The one place to add music: paste a playlist or song link, pick its genre, sort the songs (drag,
 * swipe left to remove, swipe right to send to the top), then add. Title, artist and length come from
 * the link. Only as many as the person has left can be added, so the rest are greyed out.
 */
export function AddMusic({
  view,
  eventId,
  creds,
  remaining,
  quota,
  onAdded,
}: {
  view: EventPublicView;
  eventId: string;
  creds: Creds;
  /** How many more songs this person may still add. */
  remaining: number;
  /** Accepted songs against the person's limit, once the server has said; null while loading. */
  quota: { accepted: number; limit: number } | null;
  onAdded: () => void;
}) {
  const allowed = view.rules ? allowedStyles(view.rules) : null;
  const styles = STYLE_PRESETS.filter((s) => !allowed || allowed.includes(s.id));
  const genres = GENRES.filter((g) => styles.some((s) => s.genre === g.id));
  const [url, setUrl] = useState('');
  const [songs, setSongs] = useState<ListSong[]>([]);
  const [picked, setPicked] = useState<GenreId | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
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
  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- only uses stable setters
  const onTracks = useCallback((_id: string, tracks: PlaylistSong[]) => {
    setSongs(toList(tracks));
    // Clearing the field after adding must not wipe the "added" message; loading a new list does.
    if (tracks.length > 0) {
      setDone(null);
      setError(null);
    }
  }, []);

  const genre = picked ?? (genres.length === 1 ? genres[0]!.id : null);
  // Songs are sent under the first style the event allows in that genre.
  const style = styles.find((s) => s.genre === genre)?.id ?? null;
  const take = Math.min(remaining, songs.length, MAX_BATCH);

  /** What the form can honestly say right now; the server still has the last word on each song. */
  const banner = !genre
    ? 'Choose the genre of the music first.'
    : songs.length === 0
      ? `Selected ${shout(GENRES.find((g) => g.id === genre)!.label)}. It is played at this event; paste a link or search to add songs.`
      : genreAdvice(genre);
  const allowance =
    songs.length === 0
      ? null
      : remaining === 0
        ? 'You have used all your songs for this event. Withdraw one that has not started to add another.'
        : take < songs.length
          ? `Only the first ${take} fit your allowance; the rest are greyed out.`
          : null;

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

  async function add() {
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
      setDone(`${r.accepted} added${dup ? `, ${dup} already queued` : ''}.`);
      setUrl('');
      setSongs([]);
      setPicked(null);
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
      onAdded();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack" aria-labelledby="am-h">
      <div className="card-head">
        <h2 id="am-h">Add music</h2>
        {quota ? (
          <span className="quota" id="add-quota">
            {quota.accepted} of {quota.limit} accepted songs
          </span>
        ) : null}
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
          setDone(null);
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
      <fieldset className="genre-chips">
        <legend>Which genre?</legend>
        {genres.map((g) => {
          const id = styles.find((s) => s.genre === g.id)!.id;
          return (
            <label
              key={g.id}
              className={`genre-chip${genre === g.id ? ' on' : ''}`}
              style={styleBoxVars(id)}
            >
              <input
                type="radio"
                name="music-genre"
                value={g.id}
                checked={genre === g.id}
                onChange={() => setPicked(g.id)}
              />
              <span className="swatch" aria-hidden="true" style={{ width: 10, height: 10 }} />
              {shortGenreLabel(g.id)}
            </label>
          );
        })}
      </fieldset>
      <p className="validation" role="status">
        {banner}
      </p>
      {allowance ? <p className="muted small">{allowance}</p> : null}
      {songs.length > 0 ? (
        <div ref={listRef}>
          <SongList songs={songs} onChange={setSongs} activeCount={take} label="Songs to add" />
        </div>
      ) : null}
      <button
        type="button"
        className="btn primary add-btn"
        disabled={busy || take === 0 || !style}
        aria-busy={busy}
        onClick={() => void add()}
      >
        {busy
          ? 'Adding…'
          : songs.length > 0 && !genre
            ? 'Choose a genre first'
            : take > 0
              ? `Add ${take} ${take === 1 ? 'song' : 'songs'} to queue`
              : 'Add to queue'}
      </button>
      {error ? (
        <p className="error" role="alert">
          {error.message} {error.action}
        </p>
      ) : null}
      {done ? (
        <p className="ok" role="status">
          {done}
        </p>
      ) : null}
    </section>
  );
}
