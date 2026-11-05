import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../shared/api';
import { useMenuRules } from '../shared/menu';
import { useLockedPage } from '../shared/useLockedPage';
import { PlayerConsole } from '../player/PlayerConsole';
import { commands } from './adminApi';
import {
  CarryOverPanel,
  EndPanel,
  HandoverPanel,
  ModerationPanel,
  PlaybackPanel,
  RulesPanel,
  SchedulePanel,
  SharePanel,
} from './panels';
import { ErrorLine } from './useAction';
import { useAdminStream } from './useAdminStream';

function AccessLost({ error }: { error: ApiError }) {
  return (
    <section className="card stack" role="alert">
      <h1>{error.status === 401 ? 'You do not have organiser access' : 'Something went wrong'}</h1>
      <p>
        {error.message} {error.action}
      </p>
      {error.status === 401 ? (
        <p className="muted">
          Open the organiser link you were given again, or ask the current organiser to hand the
          event over to you.
        </p>
      ) : null}
    </section>
  );
}

type Page = 'live' | 'invite' | 'more';
type Sub = 'handover' | 'time' | 'rules' | 'end';

const PAGES: Array<[Page, string]> = [
  ['live', 'Playing'],
  ['invite', 'Invite'],
  ['more', 'More'],
];

/**
 * A fixed-height console. Swipe sideways between three pages: what is playing with the queue, the
 * QR code to join, and the less-used controls (sound check, hand over, time, rules, end). Only the queue
 * list scrolls vertically, so a swipe never fights a scroll.
 */
export default function AdminPage() {
  const { eventId = '' } = useParams();
  const stream = useAdminStream(eventId);
  const { state, csrf, connection, error, refresh } = stream;
  const [extrasSlot, setExtrasSlot] = useState<HTMLDivElement | null>(null);
  const [page, setPage] = useState<Page>('live');
  const [sub, setSub] = useState<Sub | null>(null);
  const pager = useRef<HTMLDivElement>(null);
  useLockedPage();
  // The event starts by itself when the organiser's page opens; Pause is there if they want it.
  const autoStarted = useRef(false);
  const draft = state?.view.state === 'DRAFT';
  const token = csrf ?? state?.csrf ?? null;
  useEffect(() => {
    if (!draft || !token || autoStarted.current) return;
    autoStarted.current = true;
    // If this fails the Start event button is still there.
    void commands(eventId, token)
      .start()
      .then(refresh)
      .catch(() => undefined);
  }, [draft, token, eventId, refresh]);
  useMenuRules(state?.rules, state?.view.name, connection);
  useEffect(() => {
    document.body.classList.add('console');
    return () => document.body.classList.remove('console');
  }, []);

  if (!state) {
    return error ? <AccessLost error={error} /> : <p role="status">Loading…</p>;
  }
  if (error?.status === 401) return <AccessLost error={error} />;

  const v = state.view;
  const ended = v.state === 'ENDED' || v.state === 'ARCHIVED';
  const cmd = commands(eventId, csrf ?? state.csrf);
  const props = { s: state, cmd, refresh };
  const live = v.state === 'ACTIVE' || v.state === 'PAUSED' || v.state === 'TRANSFERRING';
  const SUBS: Array<[Sub, string]> = [
    ['handover', 'Hand over'],
    ['time', 'Time'],
    ['rules', 'Rules'],
    ['end', 'End the event'],
  ];
  const go = (i: number) => {
    const el = pager.current;
    if (el) el.scrollTo?.({ left: i * el.clientWidth, behavior: 'smooth' });
    setPage(PAGES[i]![0]);
  };
  return (
    <div className="console">
      <header className="console-head">
        <h1 className="sr-only">{v.name}</h1>
        <ErrorLine error={error} />
      </header>
      <div
        ref={pager}
        className="pager"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          const next = PAGES[Math.min(PAGES.length - 1, Math.max(0, i))]![0];
          if (next !== page) setPage(next);
        }}
      >
        <section className="page live" role="tabpanel" aria-label="Playing" id="page-live">
          {ended ? (
            <div className="queue-wrap scroll">
              <CarryOverPanel s={state} eventId={eventId} />
            </div>
          ) : (
            <>
              {live ? (
                <PlayerConsole eventId={eventId} stream={stream} extrasSlot={extrasSlot} />
              ) : null}
              <PlaybackPanel {...props} />
              <ModerationPanel {...props} />
            </>
          )}
        </section>
        <section className="page" role="tabpanel" aria-label="Invite" id="page-invite">
          <SharePanel joinUrl={state.joinUrl} name={v.name} slug={v.slug} />
        </section>
        <section className="page more" role="tabpanel" aria-label="More" id="page-more">
          <div className="stack">
            <div ref={setExtrasSlot} />
            <div className="row">
              {SUBS.filter(([id]) => (id === 'time' ? live : true)).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn${sub === id ? ' primary' : ''}`}
                  aria-pressed={sub === id}
                  onClick={() => setSub(sub === id ? null : id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {sub === 'handover' ? <HandoverPanel {...props} eventId={eventId} /> : null}
            {sub === 'time' ? <SchedulePanel {...props} /> : null}
            {sub === 'rules' ? <RulesPanel s={state} /> : null}
            {sub === 'end' ? <EndPanel {...props} /> : null}
          </div>
        </section>
      </div>
      <nav className="pager-dots" role="tablist" aria-label="Organiser sections">
        {PAGES.map(([id, label], i) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={page === id}
            aria-label={label}
            aria-controls={`page-${id}`}
            className="dot"
            onClick={() => go(i)}
          />
        ))}
      </nav>
    </div>
  );
}
