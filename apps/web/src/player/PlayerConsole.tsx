import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@qroove/config';
import { createPortal } from 'react-dom';
import { ChevronDown, FileAudio, FolderOpen, Volume2, WifiOff } from 'lucide-react';
import { InfoTip } from '../shared/InfoTip';
import { SignInButton } from '../shared/SignInButton';
import { playerApi, type LeaseCreds } from '../admin/adminApi';
import type { AdminStream } from '../admin/useAdminStream';
import { ErrorLine } from '../admin/useAction';
import { ApiError } from '../shared/api';
import { EmbedPlayer } from './EmbedPlayer';
import { useScreenAwake } from './keepAwake';
import { RadioFallback } from './RadioFallback';
import { connectSpotify, fetchSpotifyToken, type SpotifyConnection } from './spotifySdk';
import { loadYouTube, sourceOf, type EmbedFailure, type Source } from './embed';
import { OFFLINE_SONGS, Outbox, pickNext, type PlayOp } from './outbox';
import {
  findMatch,
  isAudio,
  trackFromFile,
  withTags,
  type LocalTrack,
  type Match,
} from './library';
import { clearTracks, loadTracks, saveTracks } from './store';
import { playTone } from './tone';

type LeaseState = 'none' | 'held' | 'lost';

const HEARTBEAT_MS = 10_000;
const leaseKey = (id: string) => `qroove:lease:${id}`;

function readLease(id: string): LeaseCreds | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(leaseKey(id)) ?? 'null') as LeaseCreds | null;
    return v && typeof v.leaseToken === 'string' && typeof v.epoch === 'number' ? v : null;
  } catch {
    return null;
  }
}

function writeLease(id: string, l: LeaseCreds | null) {
  try {
    if (l) sessionStorage.setItem(leaseKey(id), JSON.stringify(l));
    else sessionStorage.removeItem(leaseKey(id));
  } catch {
    /* memory only */
  }
}

/**
 * Playback lives on the organiser's device: this takes the player role by itself, and the organiser
 * only taps once to start, because browsers need a tap before they play sound. Rendered for as long
 * as the event is live. Optional extras (the chime, local files) go into `extrasSlot`.
 */
export function PlayerConsole({
  eventId,
  stream,
  extrasSlot,
}: {
  eventId: string;
  stream: AdminStream;
  extrasSlot: HTMLElement | null;
}) {
  const { state: s, csrf } = stream;

  const [leaseState, setLeaseState] = useState<LeaseState>('none');
  const lease = useRef<LeaseCreds | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).has('spotify')
      ? 'The Spotify login did not finish. Try again, or start without it.'
      : null,
  );

  const [library, setLibrary] = useState<LocalTrack[]>([]);
  const [remember, setRemember] = useState(false);
  const [picked, setPicked] = useState<Record<string, LocalTrack>>({});
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  /** Mirrors of refs that the screen needs to show. */
  const [audioId, setAudioId] = useState<string | null>(null);
  const [embed, setEmbed] = useState<{ id: string; source: Source } | null>(null);

  const [spotify, setSpotify] = useState<SpotifyConnection | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<'checking' | 'out' | 'ready' | 'problem'>(
    'checking',
  );
  const [paused, setPaused] = useState(false);
  /** YouTube matches for Spotify songs (see ADR 0022): ids by request, and which one is in use. */
  const [ytIds, setYtIds] = useState<Record<string, string[]>>({});
  const [ytIndex, setYtIndex] = useState<Record<string, number>>({});
  /** Requests whose Spotify playback was refused, so YouTube is tried instead. */
  const [spotifyFailed, setSpotifyFailed] = useState<Set<string>>(new Set());
  /** A radio station is on: the next guest song waits for its handover (ADR 0023). */
  const [radioHold, setRadioHold] = useState(false);
  const [cuedFailed, setCuedFailed] = useState<ReadonlySet<string>>(new Set());
  /** A song being skipped because it cannot play here (its report is on its way). */
  const [skipping, setSkipping] = useState<string | null>(null);

  const audio = useRef<HTMLAudioElement>(null);
  /** Request the audio element is currently loaded with, and whether the server has been told. */
  const current = useRef<{
    id: string;
    reported: boolean;
    url: string;
    src?: Source;
    /** Started from the forecast while the server was out of reach. */
    offline?: boolean;
  } | null>(null);

  // ---- what plays next (ADR 0029) ------------------------------------------------------------
  // The player never waits for the server between songs: reports go through the outbox, and the
  // next song is the server's reservation or, while reports are stuck, the last forecast seen.
  const outbox = useMemo(() => new Outbox(`qroove:outbox:${eventId}`), [eventId]);
  /** Songs this device has started (so the stale server view never makes it replay one). */
  const [done, setDone] = useState<ReadonlySet<string>>(
    () => new Set(outbox.pending.map((o) => o.requestId)),
  );
  const [unconfirmed, setUnconfirmed] = useState(() => outbox.unconfirmedStarts);
  const [offline, setOffline] = useState(false);
  const serverReserved = s?.requests.find((r) => r.state === 'RESERVED_NEXT') ?? null;
  const queue = s?.view.queue;
  const queueIds = useMemo(
    () => (queue ?? []).filter((q) => !q.overflow).map((q) => q.requestId),
    [queue],
  );
  const next = pickNext({
    reservedId: serverReserved?.id ?? null,
    queueIds,
    done,
    unconfirmedStarts: unconfirmed,
  });
  const reserved = (next && s?.requests.find((r) => r.id === next.id)) || null;
  const serverNowPlaying = s?.view.nowPlaying ?? null;
  // A song this device already ended still shows as playing until the server hears about it.
  const nowPlaying =
    serverNowPlaying &&
    done.has(serverNowPlaying.track.requestId) &&
    audioId !== serverNowPlaying.track.requestId
      ? null
      : serverNowPlaying;
  /**
   * After a reload (or the app being restarted) the server still has a song playing that this
   * page holds no player for: pick it up again where it should be, rather than asking for a tap.
   */
  const resumeId =
    leaseState === 'held' &&
    !audioId &&
    serverNowPlaying &&
    !done.has(serverNowPlaying.track.requestId)
      ? serverNowPlaying.track.requestId
      : null;
  const resume = (resumeId && s?.requests.find((r) => r.id === resumeId)) || null;
  /** The song whose player is being prepared: the one to resume, else the next one. */
  const target = resume ?? reserved;

  const match: Match | null = useMemo(() => {
    if (!target) return null;
    const p = picked[target.id];
    if (p) return { track: p, kind: 'exact' };
    if (failed.has(target.id)) return null;
    return findMatch(library, target);
  }, [target, library, picked, failed]);
  // A local file wins (no adverts, no sign-in); otherwise the song's own Spotify or YouTube player.
  const reservedId = reserved?.id ?? null;
  const targetId = target?.id ?? null;
  const spotifyBase = targetId && !failed.has(targetId) ? sourceOf(target?.sourceUrl) : null;
  // Spotify's own player when it can play in full; otherwise the matching YouTube video, if any.
  const wantYouTube =
    spotifyBase?.kind === 'spotify' &&
    targetId !== null &&
    (spotifyFailed.has(targetId) || spotifyStatus === 'out' || spotifyStatus === 'problem');
  const targetDuration = target?.durationMs ?? null;
  useEffect(() => {
    if (!wantYouTube || !targetId || ytIds[targetId]) return;
    let live = true;
    playerApi
      .youtube(eventId, targetId)
      .then((r) => live && setYtIds((m) => ({ ...m, [targetId]: r.videoIds ?? [] })))
      .catch(() => live && setYtIds((m) => ({ ...m, [targetId]: [] })));
    return () => {
      live = false;
    };
  }, [wantYouTube, targetId, eventId, ytIds]);
  const source = useMemo((): Source | null => {
    if (!spotifyBase || !wantYouTube || !targetId) return spotifyBase;
    const ids = ytIds[targetId];
    // Still looking: wait rather than start Spotify's 30-second preview.
    if (!ids) return null;
    const id = ids[ytIndex[targetId] ?? 0];
    if (!id) return spotifyBase;
    return targetDuration ? { kind: 'youtube', id, expectedMs: targetDuration } : spotifyBase;
  }, [spotifyBase, wantYouTube, targetId, ytIds, ytIndex, targetDuration]);

  // ---- lease -------------------------------------------------------------------------------
  const stopAudio = useCallback(() => {
    const a = audio.current;
    if (a) {
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    if (current.current?.url) URL.revokeObjectURL(current.current.url);
    current.current = null;
    setAudioId(null);
    setEmbed(null);
  }, []);

  const lose = useCallback(() => {
    stopAudio();
    outbox.clear();
    setUnconfirmed(0);
    lease.current = null;
    writeLease(eventId, null);
    setLeaseState('lost');
  }, [eventId, stopAudio, outbox]);

  const guard = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === 'STALE_LEASE') lose();
      else setError(e instanceof ApiError ? e : null);
    },
    [lose],
  );

  // ---- reports (outbox) ----------------------------------------------------------------------
  const flushReports = useCallback(() => {
    const send = (op: PlayOp) => {
      const l = lease.current;
      if (!l) return Promise.reject(new ApiError('OFFLINE', '', '', 0));
      return op.kind === 'started'
        ? playerApi.started(eventId, l, op.requestId, op.durationMs, {
            at: op.at,
            offline: op.offline,
          })
        : playerApi.finished(eventId, l, op.requestId, op.outcome, op.at);
    };
    // An online start the server refused (the queue changed just then): stop, as before.
    const onDrop = (op: PlayOp, code: string) => {
      if (op.kind === 'started' && !op.offline && current.current?.id === op.requestId) {
        stopAudio();
        if (code === 'STALE_VERSION') {
          setNotice('The queue changed before that song started, so it was not counted.');
        }
      }
    };
    return outbox.flush(send, onDrop).then((r) => {
      setUnconfirmed(outbox.unconfirmedStarts);
      setOffline(r === 'offline');
      if (r === 'lost') lose();
      else if (r === 'done') stream.refresh();
    });
    // `stream.refresh` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, outbox, lose, stopAudio]);

  const report = useCallback(
    (op: PlayOp) => {
      outbox.push(op);
      setUnconfirmed(outbox.unconfirmedStarts);
      void flushReports();
    },
    [outbox, flushReports],
  );

  // Back online: send what is waiting at once rather than at the next heartbeat.
  useEffect(() => {
    const on = () => void flushReports();
    window.addEventListener('online', on);
    return () => window.removeEventListener('online', on);
  }, [flushReports]);

  const claim = useCallback(async () => {
    if (!csrf) return;
    setError(null);
    try {
      const r = await playerApi.claim(eventId, csrf, true);
      lease.current = { leaseToken: r.leaseToken, epoch: r.lease.epoch };
      writeLease(eventId, lease.current);
      setLeaseState('held');
      setNotice(null);
      stream.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e : null);
    }
    // `stream.refresh` is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csrf, eventId]);

  // The organiser's device is the player: resume after a reload, otherwise take the role.
  const claimed = useRef(false);
  useEffect(() => {
    if (!csrf || claimed.current) return;
    claimed.current = true;
    const l = readLease(eventId);
    if (!l) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- taking the role is the effect
      void claim();
      return;
    }
    playerApi
      .heartbeat(eventId, l)
      .then(() => {
        lease.current = l;
        setLeaseState('held');
      })
      .catch(() => {
        writeLease(eventId, null);
        void claim();
      });
  }, [csrf, eventId, claim]);

  useEffect(() => {
    if (leaseState !== 'held') return;
    const id = setInterval(() => {
      const l = lease.current;
      if (outbox.pending.length) void flushReports();
      if (l) {
        playerApi
          .heartbeat(eventId, l)
          .then(() => setError((e) => (e?.code === 'OFFLINE' ? null : e)))
          .catch(guard);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [leaseState, eventId, guard, outbox, flushReports]);

  // Leftover reports from before a reload go out once the role is back.
  useEffect(() => {
    if (leaseState === 'held' && outbox.pending.length) void flushReports();
  }, [leaseState, outbox, flushReports]);

  // Another device claimed the lease: stop immediately, without waiting for our next heartbeat.
  const epoch = s?.lease?.epoch;
  useEffect(() => {
    if (
      leaseState === 'held' &&
      lease.current &&
      epoch !== undefined &&
      epoch !== lease.current.epoch
    ) {
      lose();
    }
  }, [epoch, leaseState, lose]);

  useEffect(() => () => stopAudio(), [stopAudio]);

  // ---- Spotify sign-in ----------------------------------------------------------------------
  useEffect(() => {
    let live = true;
    let conn: SpotifyConnection | null = null;
    fetchSpotifyToken()
      .then(async (t) => {
        if (!t) {
          if (live) setSpotifyStatus('out');
          return;
        }
        conn = await connectSpotify(BRAND.product);
        if (live) {
          setSpotify(conn);
          setSpotifyStatus('ready');
        } else conn.disconnect();
      })
      .catch(() => {
        // Unsupported browser or account: the embedded player still works.
        if (live) setSpotifyStatus('problem');
      });
    return () => {
      live = false;
      conn?.disconnect();
    };
  }, []);

  // ---- library -----------------------------------------------------------------------------
  useEffect(() => {
    loadTracks()
      .then((t) => {
        if (t.length) {
          setLibrary(t);
          setRemember(true);
        }
      })
      .catch(() => undefined);
  }, []);

  async function addFiles(list: FileList | null) {
    const files = [...(list ?? [])].filter(isAudio);
    if (!files.length) return;
    const fresh = files.map(trackFromFile);
    setLibrary((old) => {
      const ids = new Set(fresh.map((t) => t.id));
      return [...old.filter((t) => !ids.has(t.id)), ...fresh];
    });
    if (remember) void saveTracks(fresh).catch(() => undefined);
    // Tags refine the filename guess a few at a time; matching works throughout.
    for (let i = 0; i < fresh.length; i += 4) {
      const batch = await Promise.all(fresh.slice(i, i + 4).map(withTags));
      setLibrary((old) => old.map((t) => batch.find((b) => b.id === t.id) ?? t));
    }
  }

  async function toggleRemember(on: boolean) {
    setRemember(on);
    if (on) await saveTracks(library).catch(() => undefined);
    else await clearTracks().catch(() => undefined);
  }

  // ---- playback ----------------------------------------------------------------------------
  const nextOffline = useRef(false);
  const nextIsOffline = next?.offline ?? false;
  // Declared before the auto-advance effect, so it is current when that effect starts a song.
  useEffect(() => {
    nextOffline.current = nextIsOffline;
  }, [nextIsOffline]);

  // YouTube's player script loads once the role is held, so the first song does not wait for it.
  useEffect(() => {
    if (leaseState === 'held') loadYouTube().catch(() => undefined);
  }, [leaseState]);

  // YouTube matches for the forecast songs too, so the player has them if the network drops.
  const queueHead = queueIds.slice(0, OFFLINE_SONGS + 1).join(',');
  useEffect(() => {
    if (spotifyStatus === 'ready' || spotifyStatus === 'checking' || !s) return;
    const ids = queueHead
      .split(',')
      .filter(
        (id) =>
          id &&
          ytIds[id] === undefined &&
          sourceOf(s.requests.find((r) => r.id === id)?.sourceUrl)?.kind === 'spotify',
      )
      .slice(0, 2);
    let live = true;
    for (const id of ids) {
      playerApi
        .youtube(eventId, id)
        .then((r) => live && setYtIds((m) => ({ ...m, [id]: r.videoIds ?? [] })))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
    // Only when the forecast or sign-in changes; `s` and `ytIds` are read, not watched.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueHead, spotifyStatus, eventId]);

  const startFile = useCallback(
    async (id: string, track: LocalTrack, title: string, artist: string | null, fromSec = 0) => {
      const a = audio.current;
      if (!a || current.current) return;
      const url = URL.createObjectURL(track.file);
      current.current = { id, reported: false, url, offline: nextOffline.current };
      setAudioId(id);
      a.src = url;
      if (fromSec > 0) a.currentTime = fromSec;
      try {
        await a.play();
        setUnlocked(true);
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({ title, artist: artist ?? '' });
        }
      } catch {
        // Autoplay was refused (not unlocked yet): wait for a tap rather than looping.
        stopAudio();
        setUnlocked(false);
      }
    },
    [stopAudio],
  );

  const startEmbed = useCallback((id: string, src: Source) => {
    if (current.current) return;
    current.current = { id, reported: false, url: '', src, offline: nextOffline.current };
    setAudioId(id);
    setEmbed({ id, source: src });
    setUnlocked(true);
  }, []);

  // Resume the song the server says is playing (see `resumeId`), from where it should be now.
  useEffect(() => {
    if (!resume || !serverNowPlaying || current.current) return;
    const id = resume.id;
    const elapsed = Math.max(0, Date.now() - serverNowPlaying.startedAt);
    const length = resume.durationMs ?? source?.expectedMs ?? null;
    const markDone = () => setDone((d) => new Set(d).add(id));
    if (length !== null && elapsed > length - 3000) {
      markDone();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closing the song is the effect
      report({ kind: 'finished', requestId: id, at: Date.now(), outcome: 'PLAYED' });
      return;
    }
    if (match) void startFile(id, match.track, resume.title, resume.artist, elapsed / 1000);
    else if (source?.kind === 'youtube') startEmbed(id, { ...source, startMs: elapsed });
    else return; // Spotify, or no player: the organiser marks it ended by hand, as before.
    // The server already knows it started (TS keeps the narrowing from the guard above).
    const started = current.current as { reported: boolean } | null;
    if (started) started.reported = true;
    markDone();
    // Only when the song to resume or its player changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume?.id, match, source]);

  // Auto-advance once audio is unlocked and the sound check is done.
  useEffect(() => {
    if (!reserved || (!match && !source) || !unlocked) return;
    if (
      leaseState !== 'held' ||
      s?.view.state !== 'ACTIVE' ||
      nowPlaying ||
      current.current ||
      radioHold
    )
      return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting the next song is the effect
    if (match) void startFile(reserved.id, match.track, reserved.title, reserved.artist);
    else if (source) startEmbed(reserved.id, source);
  }, [
    reserved,
    match,
    source,
    unlocked,
    leaseState,
    s?.view.state,
    nowPlaying,
    radioHold,
    startFile,
    startEmbed,
  ]);

  function onPlaying(durationMs: number | null) {
    const c = current.current;
    if (!c || c.reported || !lease.current) return;
    c.reported = true;
    setDone((d) => new Set(d).add(c.id));
    report({
      kind: 'started',
      requestId: c.id,
      at: Date.now(),
      durationMs,
      offline: c.offline === true,
    });
  }

  /** The next song starts straight away; the server hears about both through the outbox. */
  function onEnded() {
    const c = current.current;
    if (!c || !lease.current) return;
    stopAudio();
    if (c.reported)
      report({ kind: 'finished', requestId: c.id, at: Date.now(), outcome: 'PLAYED' });
  }

  async function onMediaError(why?: EmbedFailure) {
    const c = current.current;
    const l = lease.current;
    if (!c || !l) return;
    stopAudio();
    if (why === 'account') {
      setSpotify(null);
      setSpotifyStatus('problem');
    }
    // Spotify refused or offered only a preview: the same song may play in full from YouTube.
    const asked = c.src;
    const spotifyRefused =
      (why === 'account' || why === 'preview' || why === 'stalled') && asked?.kind !== 'youtube';
    const maybeYouTube = ytIds[c.id] === undefined || ytIds[c.id]!.length > 0;
    if (
      spotifyRefused &&
      maybeYouTube &&
      !spotifyFailed.has(c.id) &&
      sourceOf(s?.requests.find((r) => r.id === c.id)?.sourceUrl)?.kind === 'spotify'
    ) {
      setSpotifyFailed((f) => new Set(f).add(c.id));
      setNotice(
        why === 'stalled'
          ? "Spotify's player did not start this song, so it is played from YouTube instead."
          : 'Spotify offered only a preview, so this song is played from YouTube instead.',
      );
      stream.refresh();
      return;
    }
    // A YouTube match that cannot be embedded: try the next-best one before giving up.
    const matched = asked?.kind === 'youtube' && asked.expectedMs !== undefined;
    if (why === 'blocked' && matched) {
      const next = (ytIndex[c.id] ?? 0) + 1;
      if (ytIds[c.id]?.[next]) {
        setYtIndex((m) => ({ ...m, [c.id]: next }));
        stream.refresh();
        return;
      }
      setYtIds((m) => ({ ...m, [c.id]: [] }));
    }
    if (c.reported)
      report({ kind: 'finished', requestId: c.id, at: Date.now(), outcome: 'FAILED' });
    else {
      // Never started: skip it so the music goes on without a tap (the server reserves the next).
      // Marked failed first, so it is not started again while the skip is on its way.
      setFailed((f) => new Set(f).add(c.id));
      setSkipping(c.id);
      const title = s?.requests.find((r) => r.id === c.id)?.title ?? 'That song';
      const skipped = await playerApi
        .unplayable(eventId, l, c.id)
        .then(() => true)
        .catch(() => false);
      setSkipping(null);
      if (skipped) {
        setNotice(`${title} could not be played here, so it was skipped.`);
        stream.refresh();
        return;
      }
    }
    setNotice(
      why === 'account'
        ? 'Spotify refused this account. It needs Premium and must be on the Qroove pilot list.'
        : why === 'preview'
          ? 'Spotify offered only a 30-second preview, so the song was not started. Sign in to Spotify Premium in this browser and try again, or play it another way.'
          : why === 'blocked'
            ? 'That song cannot be played here (its owner may not allow embedding). Open the link or pick a file.'
            : 'That file could not be played. Use manual mode or pick another file.',
    );
    stream.refresh();
  }

  async function manualStart(id: string) {
    const l = lease.current;
    if (l) await playerApi.started(eventId, l, id, null).catch(guard);
    stream.refresh();
  }

  async function manualEnd(id: string) {
    const l = lease.current;
    if (l) await playerApi.finished(eventId, l, id, 'PLAYED').catch(guard);
    stream.refresh();
  }

  async function soundCheck() {
    setChecking(true);
    try {
      await playTone();
    } catch {
      setNotice('This browser could not play the test tone. Check the volume and output device.');
    } finally {
      setChecking(false);
    }
  }

  // The screen stays on for as long as this device is the player of a running event: through
  // songs, the gaps between them and the radio. A phone that sleeps by itself can cut the sound.
  useScreenAwake(leaseState === 'held' && s?.view.state === 'ACTIVE');

  // Media Session: lock screen and headset buttons.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.setActionHandler('play', () => void audio.current?.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.current?.pause());
    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
    };
  }, []);

  useEffect(() => {
    if (!audioId) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [audioId]);

  if (!s) return null;

  // The next song waits in its own cued player while this one plays (YouTube and Spotify embeds).
  const cued =
    audioId !== null &&
    reserved &&
    reserved.id !== audioId &&
    !match &&
    source &&
    !cuedFailed.has(reserved.id) &&
    !(spotify && source.kind === 'spotify')
      ? { id: reserved.id, source }
      : null;

  const manualPlayingId =
    nowPlaying && audioId !== nowPlaying.track.requestId ? nowPlaying.track.requestId : null;
  const canStart = leaseState === 'held' && s.view.state === 'ACTIVE' && !nowPlaying;
  const idle = !nowPlaying && !audioId && !radioHold;

  const extras = (
    <details className="card stack">
      <summary>Sound check and audio files (optional, {library.length} loaded)</summary>
      <button className="btn" disabled={checking} onClick={() => void soundCheck()}>
        <Volume2 aria-hidden size={18} /> {checking ? 'Playing…' : 'Play test chime'}
      </button>
      <label className="btn">
        <FileAudio aria-hidden size={18} /> Choose files
        <input
          type="file"
          multiple
          accept="audio/*"
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      <label className="btn">
        <FolderOpen aria-hidden size={18} /> Choose a folder
        <input
          type="file"
          multiple
          hidden
          {...{ webkitdirectory: '' }}
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => void toggleRemember(e.target.checked)}
        />
        <span>Remember these files on this device</span>
      </label>
      <InfoTip label="About audio files and licences">
        Choose audio files you are allowed to play. They stay on this device and are never uploaded.
        Remembering stores copies in this device&apos;s private storage: only tick it if the music
        owner permits copies, and untick to delete them. Remembered files keep playing with no
        network. Only play recordings you are licensed to play at this venue. Qroove never streams
        or copies music: songs play in the music service&apos;s own player.
      </InfoTip>
    </details>
  );

  return (
    <section className="card stack compact player-console" aria-label="Player" aria-live="polite">
      {extrasSlot ? createPortal(extras, extrasSlot) : null}
      {notice ? (
        <p className="warning small" role="status">
          {notice}
        </p>
      ) : null}
      {leaseState === 'lost' ? (
        <div className="stack" role="alert">
          <p>Another device took over playback, so this one has stopped.</p>
          <button className="btn" onClick={() => void claim()}>
            Take playback back
          </button>
        </div>
      ) : null}
      {[embed, cued].map((x) =>
        x ? (
          <EmbedPlayer
            key={x.id}
            source={x.source}
            spotify={spotify}
            armed={x === embed}
            onPlaying={(ms) => x === embed && onPlaying(ms)}
            onEnded={() => x === embed && onEnded()}
            onFailed={(why) => {
              // A cued player that fails is dropped; the song gets a fresh player when its turn comes.
              if (x === embed) void onMediaError(why);
              else setCuedFailed((f) => new Set(f).add(x.id));
            }}
          />
        ) : null,
      )}
      {embed && spotify ? (
        <button
          className="btn"
          onClick={() => {
            spotify.togglePause();
            setPaused(!paused);
          }}
        >
          {paused ? 'Resume the music' : 'Pause the music'}
        </button>
      ) : null}
      {/* Native controls keep the player usable without our UI (lock screen, headphones). */}
      {offline ? (
        <p className="warning small offline-line" role="status">
          <WifiOff aria-hidden size={16} />{' '}
          {unconfirmed >= OFFLINE_SONGS && !audioId
            ? 'No network: waiting to reconnect.'
            : `No network: playing on (${Math.max(0, OFFLINE_SONGS - unconfirmed)} more song${
                OFFLINE_SONGS - unconfirmed === 1 ? '' : 's'
              } ready).`}
        </p>
      ) : null}
      <audio
        ref={audio}
        controls
        hidden={embed !== null || audioId === null}
        onPlaying={() => void onPlaying((audio.current?.duration ?? 0) * 1000 || null)}
        onEnded={() => void onEnded()}
        onError={() => void onMediaError()}
      />
      <RadioFallback
        settingsSlot={extrasSlot}
        eventId={eventId}
        view={s.view}
        csrf={csrf}
        lease={lease}
        leaseHeld={leaseState === 'held'}
        reservedId={reservedId}
        busy={audioId !== null}
        unlocked={unlocked}
        onUnlocked={() => setUnlocked(true)}
        onHold={setRadioHold}
        onError={guard}
        refresh={stream.refresh}
      />
      {audioId || nowPlaying ? (
        <p className="muted small">Keep this page open: the music stops if you leave it.</p>
      ) : null}
      {manualPlayingId ? (
        <div className="stack">
          <p className="muted small">
            This song was started by hand. Press the button when it has finished.
          </p>
          <button className="btn primary" onClick={() => void manualEnd(manualPlayingId)}>
            Mark ended
          </button>
        </div>
      ) : null}
      {reserved && idle && s.view.state === 'ACTIVE' ? (
        match || source ? (
          <>
            <p className="warning small">Nothing is playing yet.</p>
            {match ? (
              <p className="muted small">
                {match.kind === 'exact' ? 'File found' : 'Probable file (title only)'}:{' '}
                {match.track.file.name}
              </p>
            ) : source?.kind === 'youtube' && source.expectedMs !== undefined ? (
              <p className="muted small">
                This song will play from YouTube, in YouTube's own player.
              </p>
            ) : source?.kind === 'spotify' && spotifyStatus === 'out' ? (
              // Spotify playback is for pilot accounts: one tap further away (YouTube is the default).
              <details className="more-options">
                <summary className="btn ghost small" aria-label="More ways to play">
                  More <ChevronDown aria-hidden size={16} />
                </summary>
                <div className="row">
                  <SignInButton
                    href={`/api/spotify/login?return=${encodeURIComponent(`/admin/${eventId}`)}`}
                  >
                    Spotify
                  </SignInButton>
                  <InfoTip label="About Spotify playback">
                    Needs Spotify Premium on the pilot list. Without it, Spotify may offer only a
                    preview.
                  </InfoTip>
                </div>
              </details>
            ) : source?.kind === 'spotify' && spotifyStatus === 'problem' ? (
              <InfoTip label="Why Spotify's embedded player is used">
                Spotify&apos;s player would not start here, so its embedded player is used. This
                needs a Premium sign-in at open.spotify.com in this browser.
              </InfoTip>
            ) : null}
            <button
              className="btn primary"
              data-tv-focus
              disabled={!canStart}
              onClick={() => {
                if (match)
                  void startFile(reserved.id, match.track, reserved.title, reserved.artist);
                else if (source) startEmbed(reserved.id, source);
              }}
            >
              Start playing
            </button>
          </>
        ) : skipping === reserved.id ? (
          <p className="muted small" role="status">
            {reserved.title} cannot be played here: skipping it…
          </p>
        ) : (
          <div className="stack">
            <p className="warning small">
              Nothing is playing: {reserved.title} has no player here.
            </p>
            <label className="btn">
              Choose a file for this song
              <input
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && isAudio(f)) {
                    setFailed((old) => {
                      const n = new Set(old);
                      n.delete(reserved.id);
                      return n;
                    });
                    setPicked((p) => ({ ...p, [reserved.id]: trackFromFile(f) }));
                  }
                  e.target.value = '';
                }}
              />
            </label>
            {failed.has(reserved.id) && sourceOf(reserved.sourceUrl) ? (
              <button
                className="btn"
                onClick={() =>
                  setFailed((old) => {
                    const n = new Set(old);
                    n.delete(reserved.id);
                    return n;
                  })
                }
              >
                Try the player again
              </button>
            ) : null}
            {reserved.sourceUrl ? (
              <a
                className="btn"
                href={reserved.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open the requester&apos;s link
              </a>
            ) : null}
            <button
              className="btn primary"
              disabled={!canStart}
              onClick={() => void manualStart(reserved.id)}
            >
              Mark started
            </button>
          </div>
        )
      ) : null}
      <ErrorLine error={error} />
    </section>
  );
}
