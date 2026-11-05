import type { AdminRequestView, ExportSnapshot } from '@qroove/contracts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GenreSwatch } from '../shared/Genre';
import { ApiError } from '../shared/api';
import { formatClock, fromLocalInput, pluralise, toLocalInput } from '../shared/time';
import { formatCode } from '../shared/code';
import { RulesList } from '../shared/menu';
import { ConfirmButton, CopyButton, QrCode } from '../shared/widgets';
import {
  adminApi,
  organiserPath,
  type AdminStateResponse,
  type Commands,
  type Created,
} from './adminApi';
import { ErrorLine, useAction } from './useAction';

interface PanelProps {
  s: AdminStateResponse;
  cmd: Commands;
  refresh: () => void;
}

const LIVE = new Set(['ACTIVE', 'PAUSED', 'TRANSFERRING']);

export function PlaybackPanel({ s, cmd, refresh }: PanelProps) {
  const { run, busy, error } = useAction(refresh);
  const v = s.view;
  const next = v.queue.find((q) => !q.overflow);
  const overflow = v.preview.items.filter((i) => i.overflow).length;
  const live = LIVE.has(v.state);
  // The break to act on: the one in progress, else the next one that has not started.
  const brk =
    v.breaks.find((b) => b.actualStart !== null && b.actualEnd === null) ??
    v.breaks.find((b) => b.actualStart === null && b.actualEnd === null);
  return (
    <section className="card stack compact playback-bar" aria-label="Playback">
      {!v.nowPlaying && v.waitingReason ? (
        <p className="muted small">Waiting: {v.waitingReason}</p>
      ) : null}
      <p className="muted small next-line">
        <span>Next:</span>
        {next ? <GenreSwatch style={next.style} size={14} /> : null}
        <span className="nl-text">
          {next ? `${next.title}${next.artist ? ` — ${next.artist}` : ''}` : 'nothing reserved yet'}
        </span>
        {v.runIndicator && v.state === 'ACTIVE' ? (
          <span>
            <GenreSwatch style={v.runIndicator.style} size={14} /> {v.runIndicator.runLength}/
            {v.runIndicator.cap}
          </span>
        ) : null}
      </p>
      {overflow > 0 ? (
        <p className="notice small">
          {overflow} {pluralise(overflow, 'song')} would run past the end. Extend the time under
          More.
        </p>
      ) : null}
      {v.state === 'PAUSED' && v.nowPlaying ? (
        <p className="notice small">Pausing after this song.</p>
      ) : null}
      <div className="row">
        {v.state === 'DRAFT' ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run(cmd.start)}
          >
            Start event
          </button>
        ) : null}
        {v.state === 'ACTIVE' ? (
          <button type="button" className="btn" disabled={busy} onClick={() => void run(cmd.pause)}>
            Pause At End of Current Song
          </button>
        ) : null}
        {v.state === 'PAUSED' || v.state === 'TRANSFERRING' ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run(cmd.resume)}
          >
            {v.state === 'TRANSFERRING' ? 'Cancel handover and resume' : 'Resume Playback'}
          </button>
        ) : null}
        {live && v.nowPlaying ? (
          <ConfirmButton
            label="Skip"
            warning="This song will be lost and the queue will change."
            confirmLabel="Yes, skip"
            onConfirm={() => run(cmd.skip)}
          />
        ) : null}
        {live && brk && brk.actualStart !== null ? (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run(() => cmd.endBreak(brk.id))}
          >
            End break
          </button>
        ) : live && brk ? (
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => void run(() => cmd.startBreak(brk.id))}
          >
            Start break
            {brk.startsAt !== null ? ` (due ${formatClock(brk.startsAt, v.timezone)})` : ''}
          </button>
        ) : null}
      </div>
      <ErrorLine error={error} />
    </section>
  );
}

export function ModerationPanel({ s, cmd, refresh }: PanelProps) {
  const { run, error } = useAction(refresh);
  const shown = s.requests.filter(
    (r) => !['WITHDRAWN', 'REJECTED', 'UNAVAILABLE'].includes(r.state),
  );
  const started = new Set(['PLAYING', 'PLAYED', 'SKIPPED']);
  const finished = new Set(['PLAYED', 'SKIPPED']);
  const row = (r: AdminRequestView) => (
    <li key={r.id} className={finished.has(r.state) ? 'done' : undefined}>
      <span className="title">{r.title}</span>
      <span className="muted small">
        {r.artist ? `${r.artist} ` : ''}
        <GenreSwatch style={r.style} size={14} /> · {r.ownerNickname ?? 'No nickname'} (#
        {r.ownerLabel})
      </span>
      <span className="badge info">
        {r.possibleDuplicate ? 'Possible duplicate' : r.state.replaceAll('_', ' ').toLowerCase()}
      </span>
      {r.possibleDuplicate ? (
        <span className="row">
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => cmd.duplicate(r.id, 'approve'))}
          >
            Distinct
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => cmd.duplicate(r.id, 'reject'))}
          >
            Reject
          </button>
        </span>
      ) : null}
      {!started.has(r.state) && s.view.state !== 'ENDED' && s.view.state !== 'ARCHIVED' ? (
        <ConfirmButton
          label="Remove"
          ariaLabel={`Remove ${r.title}`}
          confirmLabel="Yes, remove"
          danger
          onConfirm={() => run(() => cmd.remove(r.id))}
        />
      ) : null}
    </li>
  );
  return (
    <section className="queue" aria-label="Queue">
      <ErrorLine error={error} />
      {shown.length === 0 ? (
        <p className="muted">No requests yet.</p>
      ) : (
        <ul className="list">{shown.map(row)}</ul>
      )}
      <p className="muted small">
        Removing a song that has not started frees the contributor’s slot. Played songs stay on
        record.
      </p>
    </section>
  );
}

export function SchedulePanel({ s, cmd, refresh }: PanelProps) {
  const { run, busy, error } = useAction(refresh);
  const [value, setValue] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const v = s.view;
  const ms = fromLocalInput(value);
  const invalid = value !== '' && (ms === null || ms <= now || (v.endAt !== null && ms <= v.endAt));
  const live = v.state === 'ACTIVE' || v.state === 'PAUSED';
  return (
    <section className="card stack" aria-labelledby="sc-h">
      <h2 id="sc-h">Time</h2>
      <p>
        {v.endAt ? (
          <>
            Planned end: <strong>{formatClock(v.endAt, v.timezone)}</strong>
          </>
        ) : (
          'No fixed end time.'
        )}
      </p>
      {live ? (
        <div>
          <label htmlFor="extend">{v.endAt ? 'Extend until' : 'Set an end time'}</label>
          <div className="row">
            <input
              id="extend"
              type="datetime-local"
              value={value}
              min={toLocalInput(now)}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={invalid}
            />
            <button
              type="button"
              className="btn"
              disabled={busy || ms === null || invalid}
              onClick={() => ms && void run(() => cmd.extend(ms)).then(() => setValue(''))}
            >
              {v.endAt ? 'Extend' : 'Set'}
            </button>
          </div>
          {invalid ? (
            <p className="error">
              Pick a real time later than {v.endAt ? 'the current end' : 'now'}.
            </p>
          ) : null}
        </div>
      ) : null}
      <ErrorLine error={error} />
    </section>
  );
}

/** The permanent room code (two triplets, easy to say aloud) with the QR code as a backup. */
export function SharePanel({
  joinUrl,
  name,
  slug,
}: {
  joinUrl: string;
  name: string;
  slug: string;
}) {
  return (
    <section className="share" aria-label="Invite people">
      <p className="room-code" aria-label={`Room code ${slug.split('').join(' ')}`}>
        {formatCode(slug)}
      </p>
      <QrCode text={joinUrl} label={`QR code to join ${name}`} />
    </section>
  );
}

export function HandoverPanel({ s, cmd, refresh, eventId }: PanelProps & { eventId: string }) {
  const { run, busy, error } = useAction(refresh);
  const [offer, setOffer] = useState<{ code: string; expiresAt: number } | null>(null);
  const live = LIVE.has(s.view.state);
  const link = offer ? `${location.origin}/claim/${eventId}#c=${offer.code}` : '';
  return (
    <section className="card stack" aria-labelledby="ho-h">
      <h2 id="ho-h">Hand over</h2>
      <p className="muted">
        Give control to someone else. Their link works once, for 10 minutes. The moment they open
        it, your access stops, playback pauses, and the song in progress counts as played.
      </p>
      {live ? (
        <ConfirmButton
          label="Hand over admin"
          confirmLabel="Yes, create a handover link"
          onConfirm={async () => {
            const r = await run(cmd.handover);
            if (r) setOffer(r);
          }}
          disabled={busy}
        />
      ) : null}
      {offer ? (
        <div className="stack">
          <p className="warning">
            Send this to the new organiser privately. It expires at{' '}
            {formatClock(offer.expiresAt, s.view.timezone)}.
          </p>
          <p className="big code">{offer.code}</p>
          <p className="mono">{link}</p>
          <CopyButton text={link} label="Copy handover link" />
        </div>
      ) : null}
      <ErrorLine error={error} />
    </section>
  );
}

export function RulesPanel({ s }: { s: AdminStateResponse }) {
  const frozen = s.view.state !== 'DRAFT';
  return (
    <section className="stack" aria-label="Rules">
      <p className="muted small">
        {frozen
          ? `Locked since the event started. Fingerprint ${s.rulesHash?.slice(0, 12) ?? ''}.`
          : 'These are locked when you start the event.'}
      </p>
      <RulesList rules={s.rules} />
    </section>
  );
}

export function EndPanel({ s, cmd, refresh }: PanelProps) {
  const { run, busy, error } = useAction(refresh);
  if (s.view.state === 'ENDED' || s.view.state === 'ARCHIVED') return null;
  return (
    <section className="stack" aria-label="End the event">
      <p className="muted small">
        Ending is permanent. Songs that did not play can be carried over to a new event.
      </p>
      <ConfirmButton
        label="End event"
        confirmLabel="Yes, end the event now"
        disabled={busy}
        onConfirm={() => run(cmd.end)}
      />
      <ErrorLine error={error} />
    </section>
  );
}

/** Song picker + "create event from these" for carry-over; queued songs fit the new time minus one minute. */
export function ImportPicker({
  snapshot,
  timezone,
  name,
  intro,
  plannedDurationMin,
  onCreated,
}: {
  snapshot: ExportSnapshot;
  timezone: string;
  name: string;
  intro: string;
  plannedDurationMin: number;
  onCreated: (c: Created) => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(
    () => new Set(snapshot.recommendations.map((_, i) => i)),
  );
  const [shuffle, setShuffle] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="muted">{intro}</p>
      <ul className="list">
        {snapshot.recommendations.map((r, i) => (
          <li key={i}>
            <label className="check">
              <input
                type="checkbox"
                checked={picked.has(i)}
                onChange={(e) =>
                  setPicked((cur) => {
                    const n = new Set(cur);
                    if (e.target.checked) n.add(i);
                    else n.delete(i);
                    return n;
                  })
                }
              />
              <span>
                <strong>{r.title}</strong>{' '}
                <span className="muted small">
                  {r.artist ? `${r.artist} ` : ''}
                  <GenreSwatch style={r.style} size={14} />
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label className="check">
        <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
        <span>Shuffle within each style</span>
      </label>
      <button
        type="button"
        className="btn primary"
        disabled={busy || picked.size === 0}
        onClick={() => {
          setBusy(true);
          setError(null);
          adminApi
            .importSnapshot({
              snapshot,
              timezone,
              shuffle,
              selectedIndexes: [...picked],
              name,
              plannedDurationMin,
            })
            .then(onCreated)
            .catch((e: unknown) => setError(e instanceof ApiError ? e : null))
            .finally(() => setBusy(false));
        }}
      >
        Create event from these
      </button>
      <ErrorLine error={error} />
    </>
  );
}

export function CarryOverPanel({ s, eventId }: { s: AdminStateResponse; eventId: string }) {
  const [songs, setSongs] = useState<ExportSnapshot | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const go = useNavigate();
  const ended = s.view.state === 'ENDED' || s.view.state === 'ARCHIVED';

  useEffect(() => {
    if (!ended) return;
    let live = true;
    adminApi
      .carryOver(eventId)
      .then((x) => live && setSongs(x))
      .catch((e: unknown) => live && setError(e instanceof ApiError ? e : null));
    return () => {
      live = false;
    };
  }, [ended, eventId]);

  if (!ended) return null;
  return (
    <section className="card stack" aria-labelledby="co-h">
      <h2 id="co-h">Carry over to a new event</h2>
      <ErrorLine error={error} />
      {songs && songs.recommendations.length === 0 ? (
        <p className="muted">Everything in the queue was played.</p>
      ) : null}
      {songs && songs.recommendations.length > 0 ? (
        <ImportPicker
          snapshot={songs}
          timezone={s.view.timezone}
          name={`${s.view.name} (next)`.slice(0, 80)}
          plannedDurationMin={s.plannedDurationMin ?? 120}
          intro="These songs never played. They join the new event owned by a neutral “system” contributor and follow the same fairness rules; you can remove any of them before starting."
          onCreated={(c: Created) => go(organiserPath(c))}
        />
      ) : null}
    </section>
  );
}
