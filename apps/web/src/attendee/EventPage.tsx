import type { MyRequests as Mine, RequestView } from '@qroove/contracts';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, type Creds } from '../shared/api';
import { useMenuRules } from '../shared/menu';
import { formatCode } from '../shared/code';
import { clearCreds, loadCreds, saveCreds } from '../shared/storage';
import { useLockedPage } from '../shared/useLockedPage';
import { useEventStream, useTick } from '../shared/useEventStream';
import { AddMusic } from './AddMusic';
import { DeckHeader } from './DeckHeader';
import { GuestQueue } from './GuestQueue';
import { NowPlaying } from './NowPlaying';

export function EventPage() {
  const { slug = '' } = useParams();
  useLockedPage();
  // Keyed by slug, so a result for an old slug is never shown for a new one.
  const [found, setFound] = useState<{
    slug: string;
    eventId: string | null;
    error: ApiError | null;
  } | null>(null);

  useEffect(() => {
    let live = true;
    api
      .bySlug(slug)
      .then((r) => live && setFound({ slug, eventId: r.eventId, error: null }))
      .catch(
        (e: unknown) =>
          live && setFound({ slug, eventId: null, error: e instanceof ApiError ? e : null }),
      );
    return () => {
      live = false;
    };
  }, [slug]);

  const current = found?.slug === slug ? found : null;
  const eventId = current?.eventId ?? null;
  const lookup = current?.error ?? null;

  if (lookup) {
    return (
      <section className="card" role="alert">
        <h1>{lookup.status === 404 ? 'We could not find that event' : 'Something went wrong'}</h1>
        <p>
          {lookup.message} {lookup.action}
        </p>
        <Link to="/">Back to the start</Link>
      </section>
    );
  }
  if (!eventId) return <p role="status">Loading event…</p>;
  return <Loaded slug={slug} eventId={eventId} />;
}

/** One join per event at a time, however often the effect runs (React strict mode runs it twice). */
const joining = new Map<string, Promise<Creds>>();
function joinOnce(eventId: string): Promise<Creds> {
  let p = joining.get(eventId);
  if (!p) {
    p = api
      .join(eventId)
      .then((j) => {
        const c = { participantId: j.participantId, token: j.token };
        saveCreds(eventId, c);
        return c;
      })
      .finally(() => joining.delete(eventId));
    joining.set(eventId, p);
  }
  return p;
}

/**
 * One fixed screen: what is playing, the queue (the only part that scrolls) and one button to add
 * a song. Opening the page is joining: nothing to type, nothing to tap.
 */
function Loaded({ slug, eventId }: { slug: string; eventId: string }) {
  const { view, connection, error, clockOffset } = useEventStream(eventId, slug);
  // The room code is the event's name; the deck header carries the connection state.
  useMenuRules(view?.rules, formatCode(slug));
  const [creds, setCreds] = useState<Creds | null>(() => loadCreds(eventId));
  const [mine, setMine] = useState<Mine | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<ApiError | null>(null);
  const [joinTry, setJoinTry] = useState(0);
  const now = useTick(1000);

  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    document.body.classList.add('console');
    return () => document.body.classList.remove('console');
  }, []);

  // What just happened shows for a few seconds, then makes room for anything longer-lived.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(id);
  }, [notice]);

  const open = view ? view.state !== 'ENDED' && view.state !== 'ARCHIVED' : false;
  useEffect(() => {
    if (creds || !open) return;
    let live = true;
    joinOnce(eventId).then(
      (c) => live && setCreds(c),
      (e: unknown) => live && setJoinError(e instanceof ApiError ? e : null),
    );
    return () => {
      live = false;
    };
  }, [creds, open, eventId, joinTry]);

  // Re-read my songs when the event changes, or after one of my own actions.
  const version = view?.version;
  useEffect(() => {
    if (!creds) return;
    let live = true;
    api
      .myRequests(eventId, creds)
      .then((m) => live && setMine(m))
      .catch((e: unknown) => {
        if (live && e instanceof ApiError && e.status === 401) {
          clearCreds(eventId);
          setCreds(null);
          setMine(null);
        }
      });
    return () => {
      live = false;
    };
  }, [creds, eventId, version, tick]);

  if (!view) {
    return error ? (
      <section className="card" role="alert">
        <p>
          {error.message} {error.action}
        </p>
      </section>
    ) : (
      <p role="status">Loading event…</p>
    );
  }

  const ended = !open;
  const status = ended
    ? 'This event has ended.'
    : view.state === 'DRAFT'
      ? 'Not started yet. Songs you add play once the organiser starts.'
      : null;
  const serverNow = now + clockOffset;
  const left = mine ? Math.max(0, mine.limit - mine.accepted) : 0;
  // A song of mine the organiser removed, or that could not be found: say so once, in one line.
  const lost = (mine?.requests ?? []).filter(
    (r) => r.state === 'REJECTED' || r.state === 'UNAVAILABLE',
  );
  const lostLine = lost.length
    ? `“${lost[lost.length - 1]!.title}”: ${lost[lost.length - 1]!.statusText ?? 'removed'}.`
    : null;

  async function withdraw(r: RequestView) {
    if (!creds) return;
    setNotice(null);
    try {
      await api.withdraw(eventId, creds, r.id);
      setNotice(`Withdrew “${r.title}”.`);
    } catch (e) {
      setNotice(
        e instanceof ApiError ? `${e.message} ${e.action}` : 'Could not withdraw that song.',
      );
    }
    reload();
  }

  return (
    <div className="deck console">
      <DeckHeader view={view} connection={connection} codename={mine?.nickname ?? null} />
      <NowPlaying view={view} />
      {status ? <p className="muted small deck-line">{status}</p> : null}
      <GuestQueue
        view={view}
        mine={mine}
        serverNow={serverNow}
        onWithdraw={(r) => void withdraw(r)}
      />
      <p className="deck-line small" role="status">
        {notice ?? lostLine ?? ''}
      </p>
      {ended ? null : creds ? (
        <button
          type="button"
          className="btn primary add-bar"
          disabled={!mine}
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          <span>＋ Add a song</span>
          {mine ? (
            <span className="quota" id="add-quota">
              {mine.accepted} of {mine.limit}
            </span>
          ) : null}
        </button>
      ) : joinError ? (
        <button
          type="button"
          className="btn primary add-bar"
          onClick={() => {
            setJoinError(null);
            setJoinTry((n) => n + 1);
          }}
        >
          Could not join. Tap to try again
        </button>
      ) : (
        <p className="muted small deck-line" role="status">
          Joining…
        </p>
      )}
      {adding && creds ? (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Add a song">
          <AddMusic
            view={view}
            eventId={eventId}
            creds={creds}
            remaining={left}
            quota={mine ? { accepted: mine.accepted, limit: mine.limit } : null}
            onClose={() => setAdding(false)}
            onAdded={(message) => {
              setAdding(false);
              setNotice(message);
              reload();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
