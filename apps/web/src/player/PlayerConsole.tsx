import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BRAND } from '@qroove/config';
import { createPortal } from 'react-dom';
import { playerApi, type LeaseCreds } from '../admin/adminApi';
import type { AdminStream } from '../admin/useAdminStream';
import { ErrorLine } from '../admin/useAction';
import { ApiError } from '../shared/api';
import { EmbedPlayer } from './EmbedPlayer';
import { RadioFallback } from './RadioFallback';
import { connectSpotify, fetchSpotifyToken, type SpotifyConnection } from './spotifySdk';
import { sourceOf, type EmbedFailure, type Source } from './embed';
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
  const [adMuted, setAdMuted] = useState(false);
  /** A radio station is on: the next guest song waits for its handover (ADR 0023). */
  const [radioHold, setRadioHold] = useState(false);

  const audio = useRef<HTMLAudioElement>(null);
  /** Request the audio element is currently loaded with, and whether the server has been told. */
  const current = useRef<{ id: string; reported: boolean; url: string; src?: Source } | null>(null);
  const wake = useRef<WakeLockSentinel | null>(null);

  const reserved = s?.requests.find((r) => r.state === 'RESERVED_NEXT') ?? null;
  const nowPlaying = s?.view.nowPlaying ?? null;

  const match: Match | null = useMemo(() => {
    if (!reserved) return null;
    const p = picked[reserved.id];
    if (p) return { track: p, kind: 'exact' };
    if (failed.has(reserved.id)) return null;
    return findMatch(library, reserved);
  }, [reserved, library, picked, failed]);
  // A local file wins (no adverts, no sign-in); otherwise the song's own Spotify or YouTube player.
  const reservedUrl = reserved?.sourceUrl ?? null;
  const reservedId = reserved?.id ?? null;
  const spotifyBase = reservedId && !failed.has(reservedId) ? sourceOf(reservedUrl) : null;
  // Spotify's own player when it can play in full; otherwise the matching YouTube video, if any.
  const wantYouTube =
    spotifyBase?.kind === 'spotify' &&
    reservedId !== null &&
    (spotifyFailed.has(reservedId) || spotifyStatus === 'out' || spotifyStatus === 'problem');
  const reservedDuration = reserved?.durationMs ?? null;
  useEffect(() => {
    if (!wantYouTube || !reservedId || ytIds[reservedId]) return;
    let live = true;
    playerApi
      .youtube(eventId, reservedId)
      .then((r) => live && setYtIds((m) => ({ ...m, [reservedId]: r.videoIds ?? [] })))
      .catch(() => live && setYtIds((m) => ({ ...m, [reservedId]: [] })));
    return () => {
      live = false;
    };
  }, [wantYouTube, reservedId, eventId, ytIds]);
  const source = useMemo((): Source | null => {
    if (!spotifyBase || !wantYouTube || !reservedId) return spotifyBase;
    const ids = ytIds[reservedId];
    // Still looking: wait rather than start Spotify's 30-second preview.
    if (!ids) return null;
    const id = ids[ytIndex[reservedId] ?? 0];
    if (!id) return spotifyBase;
    return reservedDuration ? { kind: 'youtube', id, expectedMs: reservedDuration } : spotifyBase;
  }, [spotifyBase, wantYouTube, reservedId, ytIds, ytIndex, reservedDuration]);

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
    setAdMuted(false);
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
  }, []);

  const lose = useCallback(() => {
    stopAudio();
    lease.current = null;
    writeLease(eventId, null);
    setLeaseState('lost');
  }, [eventId, stopAudio]);

  const guard = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && e.code === 'STALE_LEASE') lose();
      else setError(e instanceof ApiError ? e : null);
    },
    [lose],
  );

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
      if (l) playerApi.heartbeat(eventId, l).catch(guard);
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [leaseState, eventId, guard]);

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
  const startFile = useCallback(
    async (id: string, track: LocalTrack, title: string, artist: string | null) => {
      const a = audio.current;
      if (!a || current.current) return;
      const url = URL.createObjectURL(track.file);
      current.current = { id, reported: false, url };
      setAudioId(id);
      a.src = url;
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
    current.current = { id, reported: false, url: '', src };
    setAudioId(id);
    setEmbed({ id, source: src });
    setUnlocked(true);
  }, []);

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

  async function onPlaying(durationMs: number | null) {
    const c = current.current;
    const l = lease.current;
    if (!c || c.reported || !l) return;
    c.reported = true;
    try {
      await playerApi.started(eventId, l, c.id, durationMs);
      try {
        wake.current = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        /* optional */
      }
    } catch (e) {
      stopAudio();
      if (e instanceof ApiError && e.code === 'STALE_VERSION') {
        setNotice('The queue changed before that song started, so it was not counted.');
      }
      guard(e);
    }
    stream.refresh();
  }

  async function onEnded() {
    const c = current.current;
    const l = lease.current;
    if (!c || !l) return;
    stopAudio();
    if (c.reported) await playerApi.finished(eventId, l, c.id, 'PLAYED').catch(guard);
    stream.refresh();
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
    const spotifyRefused = (why === 'account' || why === 'preview') && asked?.kind !== 'youtube';
    const maybeYouTube = ytIds[c.id] === undefined || ytIds[c.id]!.length > 0;
    if (
      spotifyRefused &&
      maybeYouTube &&
      !spotifyFailed.has(c.id) &&
      sourceOf(reservedUrl)?.kind === 'spotify'
    ) {
      setSpotifyFailed((f) => new Set(f).add(c.id));
      setNotice('Spotify offered only a preview, so this song is played from YouTube instead.');
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
    if (c.reported) await playerApi.finished(eventId, l, c.id, 'FAILED').catch(guard);
    else setFailed((f) => new Set(f).add(c.id));
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

  // Media Session + wake lock re-acquire (it is released when the tab is hidden).
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

  const manualPlayingId =
    nowPlaying && audioId !== nowPlaying.track.requestId ? nowPlaying.track.requestId : null;
  const canStart = leaseState === 'held' && s.view.state === 'ACTIVE' && !nowPlaying;
  const idle = !nowPlaying && !audioId && !radioHold;

  const extras = (
    <details className="card stack">
      <summary>Sound check and audio files (optional, {library.length} loaded)</summary>
      <button className="btn" disabled={checking} onClick={() => void soundCheck()}>
        {checking ? 'Playing…' : 'Play test chime'}
      </button>
      <p className="muted">
        Choose audio files you are allowed to play. They stay on this device and are never uploaded.
      </p>
      <label className="btn">
        Choose files
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
        Choose a folder
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
        <span>
          Remember these files on this device
          <span className="muted small">
            {' '}
            Stores copies in this browser&apos;s private storage. Only tick this if the music owner
            permits copies, and untick to delete them. The browser may remove them; just choose the
            files again.
          </span>
        </span>
      </label>
      <p className="muted small">
        Only play recordings you are licensed to play at this venue. Qroove never streams or copies
        music: songs play in the music service&apos;s own player.
      </p>
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
      {embed ? (
        <EmbedPlayer
          key={embed.id}
          source={embed.source}
          spotify={spotify}
          onPlaying={(ms) => void onPlaying(ms)}
          onEnded={() => void onEnded()}
          onFailed={(why) => void onMediaError(why)}
          onAd={setAdMuted}
        />
      ) : null}
      {adMuted ? (
        <p className="muted small" role="status">
          Muted until the song starts: adverts play with the sound off.
        </p>
      ) : null}
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
      <audio
        ref={audio}
        controls
        hidden={embed !== null || audioId === null}
        onPlaying={() => void onPlaying((audio.current?.duration ?? 0) * 1000 || null)}
        onEnded={() => void onEnded()}
        onError={() => void onMediaError()}
      />
      <RadioFallback
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
                This song will play from YouTube. Any advert plays with the sound off.
              </p>
            ) : source?.kind === 'spotify' && spotifyStatus === 'out' ? (
              <>
                <a
                  className="btn"
                  href={`/api/spotify/login?return=${encodeURIComponent(`/admin/${eventId}`)}`}
                >
                  Log in with Spotify
                </a>
                <p className="muted small">
                  Needs Spotify Premium. Without it, Spotify may offer only a preview.
                </p>
              </>
            ) : source?.kind === 'spotify' && spotifyStatus === 'problem' ? (
              <p className="muted small">
                Spotify&apos;s player would not start here, so its embedded player is used. This
                needs a Premium sign-in at open.spotify.com in this browser.
              </p>
            ) : null}
            <button
              className="btn primary"
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
