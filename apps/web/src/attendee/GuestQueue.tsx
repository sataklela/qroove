import type { EventPublicView, MyRequests, RequestView } from '@qroove/contracts';
import { GENRES, type GenreId } from '@qroove/config';
import { GenreSwatch } from '../shared/Genre';
import { SwipeRow } from '../shared/SwipeRow';
import { formatClock } from '../shared/time';
import { etaText } from './eta';
import { breakMinutes, queueRows } from './queueRows';

const genreName = (id: GenreId) => GENRES.find((g) => g.id === id)?.label.split(' (')[0] ?? id;
/** Own songs that are still to come but have no place in the projected queue yet. */
const WAITING = new Set(['PENDING_METADATA', 'QUEUED', 'INELIGIBLE_TEMPORARILY', 'OVERFLOW']);

/**
 * The one list a guest needs: what plays next, in order. Their own songs sit in it, highlighted,
 * with a time when the scheduler is sure of one, and are withdrawn right there (swipe left, or ✕).
 * Titles only: other people's names are deliberately not shown (SPEC §6).
 */
export function GuestQueue({
  view,
  mine,
  serverNow,
  onWithdraw,
}: {
  view: EventPublicView;
  mine: MyRequests | null;
  serverNow: number;
  onWithdraw: (r: RequestView) => void;
}) {
  const rows = queueRows(view);
  const own = new Map((mine?.requests ?? []).map((r) => [r.id, r]));
  const queued = new Set(view.queue.map((q) => q.requestId));
  const extra = [...own.values()].filter((r) => WAITING.has(r.state) && !queued.has(r.id));
  const start = new Map(view.preview.items.map((i) => [i.requestId, i]));
  const live = view.state === 'ACTIVE';

  return (
    <section className="queue guest-queue" aria-labelledby="gq-h">
      <h2 id="gq-h" className="sr-only">
        Queue
      </h2>
      {rows.length === 0 && extra.length === 0 ? (
        <p className="muted">The queue is empty. Be the first to add a song.</p>
      ) : (
        <ol className="qlist">
          {rows.map((row) => {
            if (row.kind === 'radio') {
              return (
                <li key="radio-gap" className="qrow note">
                  <span className="title">
                    <GenreSwatch style={row.genre} size={14} label={false} /> Radio{' '}
                    {genreName(row.genre)} queued
                  </span>
                  <span className="muted small">
                    {row.stationName} · add a song to take its place
                  </span>
                </li>
              );
            }
            if (row.kind === 'break') {
              return (
                <li key={row.b.id} className="qrow note">
                  Break · {breakMinutes(row.b)} min
                  {row.b.startsAt !== null
                    ? ` · about ${formatClock(row.b.startsAt, view.timezone)}`
                    : ''}
                </li>
              );
            }
            const q = row.q;
            const r = own.get(q.requestId);
            const it = start.get(q.requestId);
            const eta =
              r && live && it ? etaText(it.predictedStartMs, it.uncertain, serverNow) : null;
            return (
              <SwipeRow
                key={q.requestId}
                className={`${r ? 'mine' : ''}${q.overflow ? ' overflow' : ''}`}
                onRemove={r ? () => onWithdraw(r) : undefined}
                removeLabel={`Withdraw ${q.title}`}
              >
                <span className="title">{q.title}</span>
                <span className="muted small">
                  <GenreSwatch style={q.style} size={12} /> {q.artist ?? ''}
                </span>
                {r ? (
                  <span className="badge mine">
                    Yours{eta ? ` · ${eta}` : q.overflow ? ' · after end time' : ''}
                  </span>
                ) : q.overflow ? (
                  <span className="badge warn">After end time</span>
                ) : null}
              </SwipeRow>
            );
          })}
          {extra.map((r) => (
            <SwipeRow
              key={r.id}
              className="mine waiting"
              onRemove={() => onWithdraw(r)}
              removeLabel={`Withdraw ${r.title}`}
            >
              <span className="title">{r.title}</span>
              <span className="muted small">
                <GenreSwatch style={r.style} size={12} /> {r.artist ?? ''}
              </span>
              <span className="badge mine">
                Yours · {r.statusText ?? (r.state === 'PENDING_METADATA' ? 'checking' : 'waiting')}
              </span>
            </SwipeRow>
          ))}
        </ol>
      )}
    </section>
  );
}
