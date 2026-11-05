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

/** "Started" is when a song counts: history updates here, not when it was reserved. */
export function reportStarted(
  deps: Deps,
  input: LeaseInput & { requestId: string; durationMs?: number | null },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const l = checkLease(c.event, input);
    const np = c.event.nowPlaying;
    if (np?.requestId === input.requestId) return { ok: true as const, version: c.event.version };
    requireLive(c.event.state);
    if (c.event.state !== 'ACTIVE') throw new DomainError('EVENT_NOT_ACTIVE');
    const w = await loadWork(c);
    if (breakInProgress(w)) throw new DomainError('EVENT_NOT_ACTIVE');
    if (np || c.event.reservation?.requestId !== input.requestId) {
      throw new DomainError('STALE_VERSION');
    }
    const req = w.requests.get(input.requestId);
    if (!req || req.state !== 'RESERVED_NEXT') throw new DomainError('STALE_VERSION');

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
      startedAt: c.now,
      endedAt: null,
      outcome: null,
    });
    w.event = {
      ...c.event,
      playbackSeq: seq,
      reservation: null,
      nowPlaying: { requestId: req.id, startedAt: c.now, durationMs, playbackSeq: seq },
      lease: { ...l, heartbeatAt: c.now, expiresAt: c.now + LEASE_TTL_MS },
    };
    recordPlay(w, playing);
    audit(c, 'player.started', 'player', { requestId: req.id, epoch: input.epoch });
    return { ok: true as const, version: commit(c, w) };
  });
}

/** Idempotent. `FAILED` after start still counts toward the owner's quota (SPEC §3.3). */
export function reportFinished(
  deps: Deps,
  input: LeaseInput & { requestId: string; outcome: 'PLAYED' | 'FAILED' },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    checkLease(c.event, input);
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
    closePlaying(c, w, pb, outcome === 'PLAYED' ? 'PLAYED' : 'SKIPPED', outcome);
    audit(c, 'player.finished', 'player', { requestId: req.id, outcome });
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
