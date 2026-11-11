import {
  EVENT_LIMITS,
  GENRES,
  STYLE_PRESETS,
  maxSubmissionLimit,
  type GenreId,
  type StyleId,
} from '@qroove/config';
import type { AdminRequestView, ExportSnapshot, SettingsBody } from '@qroove/contracts';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { GenreSwatch, shortGenreLabel, styleBoxVars } from '../shared/Genre';
import { SwipeRow } from '../shared/SwipeRow';
import { WheelPicker } from '../shared/WheelPicker';
import { DURATIONS, RUN_CAPS, limitChoices } from './choices';
import { ApiError } from '../shared/api';
import { formatClock, pluralise } from '../shared/time';
import { formatCode } from '../shared/code';
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

const UPCOMING = new Set([
  'PENDING_METADATA',
  'QUEUED',
  'INELIGIBLE_TEMPORARILY',
  'RESERVED_NEXT',
  'OVERFLOW',
]);

/**
 * The queue: only what is still to come, in the order it will play, then anything that is waiting
 * for its turn or for a decision. Swipe a row to the left to remove it (✕ does it in two taps).
 */
export function ModerationPanel({ s, cmd, refresh }: PanelProps) {
  const { run, error } = useAction(refresh);
  const byId = new Map(s.requests.map((r) => [r.id, r]));
  const inOrder = s.view.queue.flatMap((q) => {
    const r = byId.get(q.requestId);
    return r && UPCOMING.has(r.state) ? [r] : [];
  });
  const seen = new Set(inOrder.map((r) => r.id));
  const shown = [...inOrder, ...s.requests.filter((r) => UPCOMING.has(r.state) && !seen.has(r.id))];
  const over = s.view.state === 'ENDED' || s.view.state === 'ARCHIVED';
  const row = (r: AdminRequestView) => (
    <SwipeRow
      key={r.id}
      className={r.starter ? 'starter' : ''}
      onRemove={over ? undefined : () => void run(() => cmd.remove(r.id))}
      removeLabel={`Remove ${r.title}`}
    >
      <span className="title">{r.title}</span>
      <span className="muted small">
        <GenreSwatch style={r.style} size={12} /> {r.artist ? `${r.artist} · ` : ''}
        {r.starter ? 'Starter' : (r.ownerNickname ?? `#${r.ownerLabel}`)}
      </span>
      {r.possibleDuplicate ? (
        <span className="row">
          <span className="badge info">Possible duplicate</span>
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
      ) : r.state === 'INELIGIBLE_TEMPORARILY' || r.state === 'OVERFLOW' ? (
        <span className="badge warn">
          {r.state === 'OVERFLOW' ? 'After end time' : 'Waiting for its turn'}
        </span>
      ) : null}
    </SwipeRow>
  );
  return (
    <section className="queue" aria-label="Queue">
      <ErrorLine error={error} />
      {shown.length === 0 ? (
        <p className="muted">No songs waiting.</p>
      ) : (
        <ol className="qlist">{shown.map(row)}</ol>
      )}
    </section>
  );
}

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/**
 * Everything the organiser may change while the music plays (ADR 0025). Each control saves itself:
 * turning a wheel or tapping a genre is the whole action.
 */
export function SettingsPanel({ s, cmd, refresh }: PanelProps) {
  const { run, busy, error } = useAction(refresh);
  const planned = s.plannedDurationMin ?? EVENT_LIMITS.defaultDurationMin;
  const seg = s.rules.segments[0]!;
  const maxLimit = maxSubmissionLimit(planned);
  const limits = limitChoices(maxLimit);
  const limit = Math.min(s.rules.submissionLimit, maxLimit);
  const enabled = new Set<StyleId>(seg.enabledStyles);
  const on = (g: GenreId) => STYLE_PRESETS.some((p) => p.genre === g && enabled.has(p.id));
  const save = (body: SettingsBody) => void run(() => cmd.settings(body));
  function toggle(g: GenreId) {
    const next = STYLE_PRESETS.filter((p) => (p.genre === g ? !on(g) : enabled.has(p.id))).map(
      (p) => p.id,
    );
    if (next.length > 0) save({ enabledStyles: next });
  }
  const only = GENRES.filter((g) => on(g.id)).length === 1;
  return (
    <section className="stack settings" aria-label="Settings">
      <div className="params">
        <div className="drum-cell">
          <span className="param-label" aria-hidden="true">
            Event time
          </span>
          <WheelPicker
            label="Event time"
            values={
              DURATIONS.includes(planned)
                ? DURATIONS
                : [...DURATIONS, planned].sort((a, b) => a - b)
            }
            value={planned}
            format={hm}
            className="small"
            onChange={(m) =>
              save({
                plannedDurationMin: m,
                // The per-person ceiling follows the time, so a shorter event may lower the limit.
                ...(s.rules.submissionLimit > maxSubmissionLimit(m)
                  ? { submissionLimit: maxSubmissionLimit(m) }
                  : {}),
              })
            }
          />
        </div>
        <div className="drum-cell">
          <span className="param-label" aria-hidden="true">
            Songs in a row
          </span>
          <WheelPicker
            label="Songs in a row"
            values={
              RUN_CAPS.includes(seg.masterRunCap) ? RUN_CAPS : [...RUN_CAPS, seg.masterRunCap]
            }
            value={seg.masterRunCap}
            className="small"
            onChange={(n) => save({ masterRunCap: n })}
          />
        </div>
        <div className="drum-cell">
          <span className="param-label" aria-hidden="true">
            Songs per person
          </span>
          <WheelPicker
            label="Songs per person"
            values={limits.includes(limit) ? limits : [...limits, limit].sort((a, b) => a - b)}
            value={limit}
            className="small"
            onChange={(n) => save({ submissionLimit: n })}
          />
        </div>
      </div>
      <div className="genre-add" role="group" aria-label="Genres">
        {GENRES.map((g) => (
          <button
            key={g.id}
            type="button"
            role="checkbox"
            aria-checked={on(g.id)}
            disabled={busy || (only && on(g.id))}
            className={`btn genre-chip${on(g.id) ? ' on' : ''}`}
            style={styleBoxVars(g.id)}
            onClick={() => toggle(g.id)}
          >
            <span className="swatch" aria-hidden="true" style={{ width: 10, height: 10 }} />
            {shortGenreLabel(g.id)}
          </button>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          role="switch"
          checked={s.guestsFirst}
          onChange={(e) => save({ guestsFirst: e.target.checked })}
        />
        <span>Guest requests play before starter songs</span>
      </label>
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
