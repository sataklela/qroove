import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../shared/api';
import { formatCode } from '../shared/code';
import { useMenuRules } from '../shared/menu';
import { useLockedPage } from '../shared/useLockedPage';
import { useConsoleLayout } from './layout';
import { PlayerConsole } from '../player/PlayerConsole';
import { NowPlaying } from '../attendee/NowPlaying';
import { commands } from './adminApi';
import {
  CarryOverPanel,
  EndPanel,
  HandoverPanel,
  ModerationPanel,
  PlaybackPanel,
  SettingsPanel,
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
type Sub = 'settings' | 'sound' | 'handover' | 'end';

const PAGES: Array<[Page, string]> = [
  ['live', 'Playing'],
  ['invite', 'Invite'],
  ['more', 'More'],
];

/**
 * A fixed-height console. Swipe sideways between three pages: what is playing with the queue, the
 * QR code to join, and the less-used controls (settings, sound check, hand over, end). Only the queue
 * list scrolls vertically, so a swipe never fights a scroll.
 */
export default function AdminPage() {
  const { eventId = '' } = useParams();
  const stream = useAdminStream(eventId);
  const { state, csrf, connection, error, refresh } = stream;
  const [extrasSlot, setExtrasSlot] = useState<HTMLDivElement | null>(null);
  const [page, setPage] = useState<Page>('live');
  const [sub, setSub] = useState<Sub | null>('settings');
  const pager = useRef<HTMLDivElement>(null);
  const layout = useConsoleLayout();
  const swipe = layout === 'portrait';
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
  // The room code is always in the top bar, so guests can be told it from any page.
  useMenuRules(state?.rules, state ? formatCode(state.view.slug) : null, connection);
  useEffect(() => {
    document.body.classList.add('console');
    return () => document.body.classList.remove('console');
  }, []);
  // The page's width follows the arrangement (base.css: body[data-layout]).
  useEffect(() => {
    document.body.dataset.layout = layout;
    return () => {
      delete document.body.dataset.layout;
    };
  }, [layout]);

  // The server's clock, sampled when each view arrives, so the song's progress bar is right.
  const serverNow = state?.view.serverNow;
  // eslint-disable-next-line react-hooks/purity -- Date.now() is sampled once per server view
  const clockOffset = useMemo(() => (serverNow ? serverNow - Date.now() : 0), [serverNow]);

  if (!state) {
    return error ? <AccessLost error={error} /> : <p role="status">Loading…</p>;
  }
  if (error?.status === 401) return <AccessLost error={error} />;

  const v = state.view;
  const ended = v.state === 'ENDED' || v.state === 'ARCHIVED';
  const cmd = commands(eventId, csrf ?? state.csrf);
  const props = { s: state, cmd, refresh };
  const live = v.state === 'ACTIVE' || v.state === 'PAUSED' || v.state === 'TRANSFERRING';
  const all = layout === 'wall';
  const SUBS: Array<[Sub, string]> = [
    ['settings', 'Settings'],
    ['sound', 'Sound'],
    ['handover', 'Hand over'],
    ['end', 'End the event'],
  ];
  const go = (i: number) => {
    const el = pager.current;
    if (el) el.scrollTo?.({ left: i * el.clientWidth, behavior: 'smooth' });
    setPage(PAGES[i]![0]);
  };
  return (
    <div className="console" data-layout={layout}>
      <header className="console-head">
        <h1 className="sr-only">{v.name}</h1>
        <ErrorLine error={error} />
      </header>
      <div
        ref={pager}
        className="pager"
        onScroll={(e) => {
          if (!swipe) return;
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
              {/* Only while a song (or the radio) is on: the player card already says when nothing is. */}
              {/* Two groups: side by side on a big screen, one column (display: contents) elsewhere. */}
              <div className="live-a">
                {live && (v.nowPlaying || v.radio) ? (
                  <NowPlaying view={v} clockOffset={clockOffset} showRun={false} />
                ) : null}
                {live ? (
                  <PlayerConsole eventId={eventId} stream={stream} extrasSlot={extrasSlot} />
                ) : null}
              </div>
              <div className="live-b">
                <PlaybackPanel {...props} />
                <ModerationPanel {...props} />
              </div>
            </>
          )}
        </section>
        <section
          className="page invite"
          role={swipe ? 'tabpanel' : 'region'}
          aria-label={layout === 'wall' ? 'Join this event' : 'Invite'}
          id="page-invite"
          hidden={layout === 'wall' && ended}
        >
          <SharePanel joinUrl={state.joinUrl} name={v.name} slug={v.slug} />
          {swipe ? null : <p className="muted small scan-hint">Scan to add songs</p>}
        </section>
        <section
          className="page more"
          role={swipe ? 'tabpanel' : 'region'}
          aria-label={swipe ? 'More' : 'Event controls'}
          id="page-more"
        >
          <div className="stack">
            <div className="row" hidden={all}>
              {SUBS.filter(([id]) =>
                id === 'settings' ? !ended : id === 'sound' ? live : true,
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn${sub === id ? ' primary' : ''}`}
                  aria-pressed={sub === id}
                  onClick={() => setSub(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* On the wall every panel is open: nothing to tap through from across the room. */}
            {all || sub === 'settings' ? (!ended ? <SettingsPanel {...props} /> : null) : null}
            {/* Always mounted: the player draws its sound check and radio switch into it. */}
            <div ref={setExtrasSlot} hidden={!(all ? live : sub === 'sound')} />
            {all || sub === 'handover' ? <HandoverPanel {...props} eventId={eventId} /> : null}
            {all || sub === 'end' ? <EndPanel {...props} /> : null}
          </div>
        </section>
      </div>
      <nav
        hidden={!swipe}
        className="pager-dots" role="tablist" aria-label="Organiser sections">
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
