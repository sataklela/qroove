import type { MyRequests as Mine } from '@qroove/contracts';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError, type Creds } from '../shared/api';
import { useMenuRules } from '../shared/menu';
import { clearCreds, loadCreds } from '../shared/storage';
import { useLockedPage } from '../shared/useLockedPage';
import { useEventStream, useTick } from '../shared/useEventStream';
import { AddMusic } from './AddMusic';
import { JoinCard } from './JoinCard';
import { MyNextSong } from './MyNextSong';
import { MyRequests } from './MyRequests';
import { QueueTabs } from './QueueTabs';
import { DeckHeader } from './DeckHeader';
import { NextUp } from './NextUp';
import { NowPlaying } from './NowPlaying';
import { UpNext } from './UpNext';

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

function Loaded({ slug, eventId }: { slug: string; eventId: string }) {
  const { view, connection, error, clockOffset } = useEventStream(eventId, slug);
  // The deck header carries the connection state, so the top bar shows only the event's name.
  useMenuRules(view?.rules, view?.name);
  const [creds, setCreds] = useState<Creds | null>(() => loadCreds(eventId));
  const [mine, setMine] = useState<Mine | null>(null);
  const now = useTick(1000);

  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

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

  const mineIds = useMemo(() => new Set((mine?.requests ?? []).map((r) => r.id)), [mine]);

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

  const ended = view.state === 'ENDED' || view.state === 'ARCHIVED';
  const status = ended
    ? 'This event has ended.'
    : view.state === 'DRAFT'
      ? 'Not started yet. Add your songs now; they play once the organiser starts the event.'
      : view.state === 'PAUSED' || view.state === 'TRANSFERRING'
        ? 'Session paused.'
        : null;
  const serverNow = now + clockOffset;
  return (
    <div className="deck stack">
      <DeckHeader view={view} connection={connection} />
      {status ? <p className="muted">{status}</p> : null}

      <div className="status-row">
        <NowPlaying view={view} />
        <NextUp view={view} serverNow={serverNow} />
      </div>
      {creds && mine?.requests.length ? (
        <MyNextSong view={view} mine={mine} serverNow={serverNow} />
      ) : null}
      {ended ? null : creds ? (
        <AddMusic
          view={view}
          eventId={eventId}
          creds={creds}
          remaining={mine ? Math.max(0, mine.limit - mine.accepted) : 0}
          quota={mine ? { accepted: mine.accepted, limit: mine.limit } : null}
          onAdded={reload}
        />
      ) : (
        <JoinCard eventId={eventId} onJoined={setCreds} />
      )}
      {creds && mine ? (
        <QueueTabs
          mineCount={mine.requests.filter((r) => r.state !== 'WITHDRAWN').length}
          queue={<UpNext view={view} mineIds={mineIds} defaultOpen />}
          mine={
            <MyRequests
              mine={mine}
              live={view.state === 'ACTIVE'}
              serverNow={serverNow}
              onWithdraw={async (r) => {
                await api.withdraw(eventId, creds, r.id);
                reload();
              }}
            />
          }
        />
      ) : (
        <UpNext view={view} mineIds={mineIds} />
      )}
    </div>
  );
}
