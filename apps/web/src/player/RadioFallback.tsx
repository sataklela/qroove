/* The lease lives in a ref owned by the player console; callbacks read it when they run. */
/* eslint-disable react-hooks/preserve-manual-memoization */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  GENRES,
  RADIO_DEFAULTS,
  chooseRadioStation,
  genresOf,
  type GenreId,
  type RadioStation,
  type StyleId,
} from '@qroove/config';
import type { EventPublicView } from '@qroove/contracts';
import { playerApi, setRadioFallback, type LeaseCreds } from '../admin/adminApi';
import { ApiError } from '../shared/api';
import { fetchRadioStatus, radioTrackKey, type RadioStatus } from './radio';

type Phase = 'idle' | 'connecting' | 'playing';

/** 0.1 s of silence (8 kHz 8-bit mono WAV). */
const SILENCE =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

const genreName = (g: string) => GENRES.find((x) => x.id === g)?.label ?? g;

/**
 * Radio fallback (ADR 0023). When no guest song is due, the organiser's device plays a station's
 * public listener URL in its own <audio> element and tells the server which track is on. A guest
 * song that becomes due waits for the station's next track (or the maximum wait) and then takes
 * over through the normal player: `onHold` keeps the normal auto-advance off until then.
 */
export function RadioFallback({
  eventId,
  view,
  csrf,
  lease,
  leaseHeld,
  reservedId,
  busy,
  unlocked,
  onUnlocked,
  onHold,
  onError,
  refresh,
}: {
  eventId: string;
  view: EventPublicView;
  csrf: string | null;
  lease: RefObject<LeaseCreds | null>;
  leaseHeld: boolean;
  reservedId: string | null;
  /** A guest song is loaded in the main player. */
  busy: boolean;
  unlocked: boolean;
  onUnlocked: () => void;
  onHold: (hold: boolean) => void;
  onError: (e: unknown) => void;
  refresh: () => void;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [station, setStation] = useState<RadioStation | null>(null);
  const [status, setStatus] = useState<RadioStatus | null>(null);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  /** The browser refused to start sound by itself: wait for a tap rather than trying again. */
  const [needsTap, setNeedsTap] = useState(false);
  /** The start grace has run out (the server's `radioHoldUntil`, counted on this device's clock). */
  const [graceOver, setGraceOver] = useState(false);
  const [waitingSince, setWaitingSince] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Failures per station: first one retries at once, then the station rests for a minute. */
  const failures = useRef(new Map<string, number>());
  const resting = useRef(new Map<string, number>());
  const lastKey = useRef<string | null>(null);
  const lastOk = useRef(0);
  const starting = useRef(false);

  const on = view.radioFallback;
  const onBreak = view.breaks.some((b) => b.actualStart !== null && b.actualEnd === null);
  const holdUntil = view.radioHoldUntil;
  const inGrace = holdUntil !== null && !graceOver;
  const canRun =
    !inGrace && on && leaseHeld && view.state === 'ACTIVE' && !onBreak && !view.nowPlaying && !busy;
  const active = phase !== 'idle';

  useEffect(() => {
    if (holdUntil === null) return;
    const id = setTimeout(() => setGraceOver(true), Math.max(0, holdUntil - view.serverNow));
    return () => clearTimeout(id);
  }, [holdUntil, view.serverNow]);

  /** Plays a silent clip in a tap, so the browser lets this element start by itself later. */
  async function armSound() {
    const a = audio.current;
    if (!a) return;
    try {
      a.src = SILENCE;
      await a.play();
      a.pause();
      a.removeAttribute('src');
      a.load();
      onUnlocked();
    } catch {
      setMessage('This browser would not allow sound. Tap again.');
    }
  }

  const choice = useMemo(() => {
    const done = view.breaks.filter((b) => b.actualEnd !== null).length;
    const seg = view.rules?.segments[Math.min(done, (view.rules?.segments.length ?? 1) - 1)];
    const allowed: GenreId[] = seg ? genresOf(seg.enabledStyles as StyleId[]) : [];
    const ri = view.runIndicator;
    return {
      allowed,
      last: (ri?.style as GenreId | undefined) ?? null,
      run: ri?.runLength ?? 0,
      cap: ri?.cap ?? 1,
    };
    // `tick` re-evaluates after a station failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.breaks, view.rules, view.runIndicator, tick]);

  const pick = useCallback((): RadioStation | null => {
    const t = Date.now();
    const unavailable = new Set<string>();
    for (const [id, until] of resting.current) if (until > t) unavailable.add(id);
    return chooseRadioStation({
      allowedGenres: choice.allowed,
      lastGenre: choice.last,
      runLength: choice.run,
      runCap: choice.cap,
      unavailable,
    });
  }, [choice]);

  const stop = useCallback(
    (tellServer: boolean) => {
      const a = audio.current;
      if (a) {
        a.pause();
        a.removeAttribute('src');
        a.load();
      }
      setPhase('idle');
      setStation(null);
      setStatus(null);
      setStale(false);
      lastKey.current = null;
      const l = lease.current;
      if (tellServer && l) void playerApi.radioEnded(eventId, l).catch(() => undefined);
    },
    [eventId, lease],
  );

  const start = useCallback(
    async (byTap: boolean) => {
      const a = audio.current;
      const l = lease.current;
      if (!a || !l || starting.current) return;
      const s = pick();
      if (!s) {
        setMessage('No working radio station is available for this event. Music is on hold.');
        return;
      }
      starting.current = true;
      setMessage(null);
      setStation(s);
      setPhase('connecting');
      try {
        a.src = s.streamUrl;
        await a.play();
      } catch (err) {
        stop(false);
        starting.current = false;
        if (!byTap && err instanceof DOMException && err.name === 'NotAllowedError') {
          setNeedsTap(true);
          return;
        }
        // Any other failure rests the station, so it cannot be retried in a loop.
        resting.current.set(s.id, Date.now() + RADIO_DEFAULTS.failureBackoffMs);
        setMessage(`${s.name} would not play. Trying another station if there is one.`);
        setTick((n) => n + 1);
        return;
      }
      starting.current = false;
      setNeedsTap(false);
      onUnlocked();
      let st: RadioStatus | null = null;
      try {
        st = await fetchRadioStatus(s);
        lastOk.current = Date.now();
      } catch {
        setStale(true);
      }
      setStatus(st);
      lastKey.current = radioTrackKey(st);
      setPhase('playing');
      try {
        await playerApi.radioStarted(eventId, l, s.id, lastKey.current, st?.title ?? null);
      } catch (e) {
        // A guest song or a pause got there first: the radio gives way.
        stop(false);
        if (!(
          e instanceof ApiError &&
          (e.code === 'STALE_VERSION' || e.code === 'EVENT_NOT_ACTIVE')
        )) {
          onError(e);
        }
      }
      refresh();
    },
    [eventId, lease, onError, onUnlocked, pick, refresh, stop],
  );

  // Starts by itself once the browser has allowed sound; the first start needs a tap.
  useEffect(() => {
    if (canRun && !reservedId && phase === 'idle' && unlocked && !needsTap) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the radio is the effect
      void start(false);
    }
  }, [canRun, reservedId, phase, unlocked, needsTap, start, tick]);

  // Anything that rules radio out stops it (the server has already closed its side).
  useEffect(() => {
    if (!canRun && phase !== 'idle') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      stop(leaseHeld);
    }
  }, [canRun, phase, leaseHeld, stop]);

  // The main player stays off while a station is on, until the handover below.
  useEffect(() => {
    onHold(active);
    return () => onHold(false);
  }, [active, onHold]);

  const handOver = useCallback(() => {
    stop(true);
    setWaitingSince(null);
  }, [stop]);

  // A guest song is due: note when it started waiting.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWaitingSince(reservedId && phase === 'playing' ? Date.now() : null);
  }, [reservedId, phase]);

  // Station feed: track changes mark the end of a track; this is also where a waiting guest song
  // takes over. A feed that stays silent only produces a warning, never a guessed track change.
  useEffect(() => {
    if (phase !== 'playing' || !station) return;
    const id = setInterval(() => {
      setNow(Date.now());
      fetchRadioStatus(station)
        .then((st) => {
          lastOk.current = Date.now();
          setStale(false);
          setStatus(st);
          const key = radioTrackKey(st);
          if (key === lastKey.current) return;
          // The first feed answer after a failed one only gives the track its identity.
          const wasUnknown = lastKey.current === 'live';
          lastKey.current = key;
          if (reservedId && !wasUnknown) {
            handOver();
            return;
          }
          const l = lease.current;
          if (l) {
            playerApi
              .radioStarted(eventId, l, station.id, key, st.title)
              .then(refresh)
              .catch(onError);
          }
          const better = wasUnknown ? null : pick();
          if (better && better.genre !== station.genre) {
            stop(false);
            setTick((n) => n + 1);
          }
        })
        .catch(() => {
          if (Date.now() - lastOk.current > RADIO_DEFAULTS.metadataStaleMs) setStale(true);
        });
    }, RADIO_DEFAULTS.statusPollMs);
    return () => clearInterval(id);
  }, [phase, station, reservedId, eventId, lease, handOver, onError, pick, refresh, stop]);

  // The longest a guest song waits for the station's track to end.
  useEffect(() => {
    if (waitingSince === null) return;
    const left = waitingSince + RADIO_DEFAULTS.maxQueueWaitMs - Date.now();
    const id = setTimeout(handOver, Math.max(0, left));
    return () => clearTimeout(id);
  }, [waitingSince, handOver]);

  function failed() {
    const s = station;
    stop(true);
    if (!s) return;
    const n = (failures.current.get(s.id) ?? 0) + 1;
    failures.current.set(s.id, n);
    if (n >= 2) {
      resting.current.set(s.id, Date.now() + RADIO_DEFAULTS.failureBackoffMs);
      failures.current.set(s.id, 0);
      setMessage(`${s.name} stopped. Trying another station if there is one.`);
    }
    setTick((t) => t + 1);
  }

  async function toggle(next: boolean) {
    if (!csrf) return;
    try {
      await setRadioFallback(eventId, csrf, next);
      if (!next) stop(true);
      refresh();
    } catch (e) {
      onError(e);
    }
  }

  const waitedMs = waitingSince === null ? 0 : now - waitingSince;
  const showArm = (inGrace || !active) && on && leaseHeld && view.state === 'ACTIVE' && !unlocked;
  const showStart =
    canRun && !reservedId && phase === 'idle' && (!unlocked || needsTap || message !== null);
  if (view.state !== 'ACTIVE' && view.state !== 'PAUSED' && !on) return null;

  return (
    <div className="stack compact radio-fallback" aria-label="Radio fallback">
      <audio ref={audio} hidden onError={failed} onEnded={failed} onWaiting={undefined} />
      <label className="check-row">
        <input
          type="checkbox"
          checked={on}
          disabled={!csrf || view.state === 'DRAFT'}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          Radio fallback
          <span className="muted small">
            {' '}
            Plays a live station when no guest song is due. A guest song starts when the
            station&apos;s current track ends.
          </span>
        </span>
      </label>
      {phase === 'playing' && station ? (
        <div role="status">
          <p>
            <strong>Radio · {genreName(station.genre)}</strong> · {station.name}
          </p>
          <p className="muted small">
            {status?.title ?? 'Live radio · track information unavailable'}
          </p>
          {stale ? (
            <p className="warning small">
              The station&apos;s track information is not arriving, so a song cannot be handed over
              at a track change. The radio keeps playing.
            </p>
          ) : null}
          {reservedId ? (
            <>
              <p className="muted small">
                A guest song is next. It starts when this radio track ends (at the latest in{' '}
                {Math.max(0, Math.ceil((RADIO_DEFAULTS.maxQueueWaitMs - waitedMs) / 60_000))} min).
              </p>
              <button className="btn primary" onClick={handOver}>
                Play the queued song now
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {phase === 'connecting' ? <p className="muted small">Connecting to the radio…</p> : null}
      {showArm ? (
        <div className="stack compact">
          <p className="muted small">
            When no guest song is ready, the radio starts by itself. Tap once now so this device is
            allowed to play it.
          </p>
          <button className="btn" onClick={() => void armSound()}>
            Allow sound for the radio
          </button>
        </div>
      ) : null}
      {showStart ? (
        <button className="btn primary" onClick={() => void start(true)}>
          Start radio
        </button>
      ) : null}
      {message ? (
        <p className="warning small" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
