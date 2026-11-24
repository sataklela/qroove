import { DomainError } from '@qroove/contracts';
import type { PlaybackOutcome } from '@qroove/contracts';
import type { EventDoc } from '../../db/types.js';
import {
  LEASE_TTL_MS,
  audit,
  commit,
  loadWork,
  requireAdmin,
  runCommand,
  type Deps,
} from '../context.js';
import { sameHash, sha256 } from '../ids.js';
import { closePlaying, readPlaying, requireLive } from '../lifecycle.js';
import { breakInProgress, recordPlay } from '../recompute.js';
import { takeOut } from './requests.js';

interface LeaseInput {
  eventId: string;
  leaseToken: string;
  epoch: number;
}

/** The fencing check: right token AND the current epoch, otherwise this device is stale. */
export function checkLease(e: EventDoc, input: LeaseInput) {
  const l = e.lease;
  if (!l || l.epoch !== input.epoch || !sameHash(l.controllerHash, sha256(input.leaseToken))) {
    throw new DomainError('STALE_LEASE');
  }
  return l;
}

const leaseView = (l: { epoch: number; expiresAt: number }) => ({
  epoch: l.epoch,
  expiresAt: l.expiresAt,
});

/**
 * Takes the player role (admin-capability holders only). A valid lease held elsewhere needs
 * `takeover`. Either way the epoch increments, so the previous device is fenced out, and any track
 * it left playing is treated as consumed rather than replayed.
 */
export function claimLease(
  deps: Deps,
  input: { eventId: string; adminSecret: string; takeover?: boolean },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    await requireAdmin(c.tx, input.adminSecret);
    requireLive(c.event.state);
    const old = c.event.lease;
    if (old && old.expiresAt > c.now && !input.takeover) throw new DomainError('STALE_LEASE');
    const pb = await readPlaying(c);
    const w = await loadWork(c);
    const token = deps.ids.secret();
    const epoch = c.event.leaseEpoch + 1;
    const lease = {
      controllerHash: sha256(token),
      epoch,
      claimedAt: c.now,
      heartbeatAt: c.now,
      expiresAt: c.now + LEASE_TTL_MS,
    };
    w.event = { ...c.event, leaseEpoch: epoch, lease };
    closePlaying(c, w, pb, 'PLAYED', 'PLAYED');
    audit(c, 'player.claim', 'player', { epoch, takeover: input.takeover === true });
    return { leaseToken: token, lease: leaseView(lease), version: commit(c, w) };
  });
}

/** Heartbeats do not bump `version`, so they never trigger client refreshes. */
export function heartbeat(deps: Deps, input: LeaseInput) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const l = checkLease(c.event, input);
    const next = { ...l, heartbeatAt: c.now, expiresAt: c.now + LEASE_TTL_MS };
    c.tx.putEvent({ ...c.event, lease: next }, { silent: true });
    return { lease: leaseView(next), version: c.event.version };
  });
}

/** A late report's time, kept between the lease claim and now (a phone clock may be off). */
const clampAt = (at: number | undefined, from: number, now: number) =>
  at === undefined ? now : Math.min(now, Math.max(from, at));

const OFFLINE_STARTABLE: ReadonlySet<string> = new Set([
  'RESERVED_NEXT',
  'QUEUED',
  'INELIGIBLE_TEMPORARILY',
  'OVERFLOW',
]);

/**
 * "Started" is when a song counts: history updates here, not when it was reserved.
 *
 * `offline` (ADR 0029): the player lost the network and went on to the next song it had been
 * shown. If that song is no longer the reservation but is still waiting, it is started anyway
 * (the reservation goes back to the queue). If it has since been withdrawn or removed, nothing is
 * recorded and `recorded: false` lets the player drop the report.
 */
export function reportStarted(
  deps: Deps,
  input: LeaseInput & {
    requestId: string;
    durationMs?: number | null;
    at?: number | undefined;
    offline?: boolean | undefined;
  },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const l = checkLease(c.event, input);
    const np = c.event.nowPlaying;
    if (np?.requestId === input.requestId) return { ok: true as const, version: c.event.version };
    requireLive(c.event.state);
    if (c.event.state !== 'ACTIVE') throw new DomainError('EVENT_NOT_ACTIVE');
    const w = await loadWork(c);
    if (breakInProgress(w)) throw new DomainError('EVENT_NOT_ACTIVE');
    let req = w.requests.get(input.requestId);
    if (np) throw new DomainError('STALE_VERSION');
    if (input.offline === true && req && c.event.reservation?.requestId !== req.id) {
      if (req.state === 'PLAYED' || req.state === 'SKIPPED' || req.state === 'PLAYING') {
        return { ok: true as const, version: c.event.version };
      }
      if (!OFFLINE_STARTABLE.has(req.state)) {
        audit(c, 'player.offline_unrecorded', 'player', { requestId: req.id, state: req.state });
        return { ok: true as const, recorded: false, version: c.event.version };
      }
      const held = c.event.reservation && w.requests.get(c.event.reservation.requestId);
      if (held) w.setState(held, 'QUEUED', c.now);
      req = w.setState(req, 'RESERVED_NEXT', c.now);
      w.event = { ...w.event, reservation: null };
    } else if (c.event.reservation?.requestId !== input.requestId) {
      throw new DomainError('STALE_VERSION');
    }
    if (!req || req.state !== 'RESERVED_NEXT') throw new DomainError('STALE_VERSION');
    const startedAt = clampAt(input.at, l.claimedAt, c.now);

    // Consume only the locks this request holds, so a reviewed lookalike cannot overwrite another's.
    const lockKeys: string[] = [];
    for (const k of [...req.keys, ...(req.looseKey ? [req.looseKey] : [])]) {
      const doc = await c.tx.getRecordingKey(k);
      if (doc?.requestId === req.id) lockKeys.push(k);
    }
    const durationMs = req.durationMs ?? input.durationMs ?? null;
    const playing = { ...req, state: 'PLAYING' as const, durationMs, updatedAt: c.now };
    w.putRequest(playing);
    for (const key of lockKeys) c.tx.putRecordingKey({ key, requestId: req.id, state: 'consumed' });
    const seq = c.event.playbackSeq + 1;
    c.tx.putPlayback({
      seq,
      requestId: req.id,
      ownerId: req.ownerId,
      style: req.style,
      startedAt,
      endedAt: null,
      outcome: null,
    });
    w.event = {
      ...w.event,
      playbackSeq: seq,
      reservation: null,
      nowPlaying: { requestId: req.id, startedAt, durationMs, playbackSeq: seq },
      lease: { ...l, heartbeatAt: c.now, expiresAt: c.now + LEASE_TTL_MS },
    };
    recordPlay(w, playing);
    audit(c, 'player.started', 'player', {
      requestId: req.id,
      epoch: input.epoch,
      ...(input.offline === true ? { offline: true } : {}),
    });
    return { ok: true as const, version: commit(c, w) };
  });
}

/** Idempotent. `FAILED` after start still counts toward the owner's quota (SPEC §3.3). */
export function reportFinished(
  deps: Deps,
  input: LeaseInput & {
    requestId: string;
    outcome: 'PLAYED' | 'FAILED';
    at?: number | undefined;
  },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const l = checkLease(c.event, input);
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (req.state === 'PLAYED' || req.state === 'SKIPPED') {
      return { ok: true as const, version: c.event.version };
    }
    if (req.state !== 'PLAYING' || c.event.nowPlaying?.requestId !== req.id) {
      throw new DomainError('STALE_VERSION');
    }
    const pb = await readPlaying(c);
    const w = await loadWork(c);
    const outcome: PlaybackOutcome = input.outcome;
    const endedAt = clampAt(input.at, l.claimedAt, c.now);
    closePlaying(c, w, pb, outcome === 'PLAYED' ? 'PLAYED' : 'SKIPPED', outcome, endedAt);
    audit(c, 'player.finished', 'player', { requestId: req.id, outcome });
    return { ok: true as const, version: commit(c, w) };
  });
}

/**
 * The reserved song has no player on this device (e.g. its owner blocks embedding): it is taken
 * out as UNAVAILABLE, which frees its owner's slot, and the next song is reserved at once, so the
 * music does not stop for a tap. Idempotent.
 */
export function reportUnplayable(deps: Deps, input: LeaseInput & { requestId: string }) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    checkLease(c.event, input);
    requireLive(c.event.state);
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (req.state === 'UNAVAILABLE') return { ok: true as const, version: c.event.version };
    if (req.state !== 'RESERVED_NEXT' || c.event.reservation?.requestId !== req.id) {
      throw new DomainError('STALE_VERSION');
    }
    const w = await loadWork(c);
    await takeOut(c, w, req, 'UNAVAILABLE', 'unplayable');
    audit(c, 'player.unplayable', 'player', { requestId: req.id });
    return { ok: true as const, version: commit(c, w) };
  });
}

export function releaseLease(deps: Deps, input: LeaseInput) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    checkLease(c.event, input);
    audit(c, 'player.release', 'player', { epoch: input.epoch });
    return { ok: true as const, version: c.tx.putEvent({ ...c.event, lease: null, radio: null }) };
  });
}
