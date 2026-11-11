import { DomainError, allowedStyles, type Provider, type StyleId } from '@qroove/contracts';
import { countsTowardQuota } from '@qroove/scheduler';
import {
  SYSTEM_SEED_ID,
  type ParticipantDoc,
  type RecordingKeyDoc,
  type RequestDoc,
} from '../../db/types.js';
import {
  audit,
  commit,
  loadWork,
  requireAdmin,
  requireParticipant,
  runCommand,
  type Ctx,
  type CommandOpts,
  type Deps,
  type Work,
} from '../context.js';
import { codename, pickCodename } from '../codenames.js';
import { mulberry32, sha256 } from '../ids.js';

/**
 * Anyone with the room code (or the QR code, which opens the same link) can join. Nobody types a
 * name: each person gets a codename that no one else at the event has (ADR 0026).
 */
export async function joinEvent(deps: Deps, input: { eventId: string }) {
  return deps.repo.runInTransaction(input.eventId, async (tx) => {
    const event = await tx.getEvent();
    if (!event) throw new DomainError('NOT_FOUND');
    if (event.state === 'ENDED' || event.state === 'ARCHIVED') throw new DomainError('EVENT_ENDED');
    const now = deps.clock.now();
    const token = deps.ids.secret();
    const taken = event.codenames ?? [];
    const index = pickCodename(taken, mulberry32(deps.ids.seed()));
    const nickname = codename(index);
    // Silent: a new guest changes nothing anyone else can see.
    tx.putEvent({ ...event, codenames: [...taken, index] }, { silent: true });
    const p: ParticipantDoc = {
      id: deps.ids.participantId(),
      tokenHash: sha256(token),
      nickname,
      joinedAt: now,
      lastSeenAt: now,
      acceptedCount: 0,
    };
    tx.putParticipant(p);
    tx.appendAudit({
      action: 'participant.join',
      actorRole: 'participant',
      at: now,
      payload: { participantId: p.id },
      idempotencyKey: null,
    });
    return { participantId: p.id, token, nickname };
  });
}

/** Track metadata is resolved by ingestion (Phase 4) before the domain sees it. */
export interface TrackInput {
  canonicalKey: string;
  /** Other exact identities (platform id, fingerprint) that must also block duplicates. */
  aliasKeys?: string[];
  /** Version-insensitive key; a collision sends the request to admin review. */
  looseKey?: string | null;
  provider: Provider;
  title: string;
  artist: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  sourceUrl: string | null;
  /** Set when metadata will arrive later via `resolveMetadata`. */
  metadataPending?: boolean;
  playable?: boolean;
}

export interface SubmitInput extends CommandOpts {
  eventId: string;
  participantId: string;
  token: string;
  style: StyleId;
  track: TrackInput;
}

const TAKEABLE: ReadonlySet<string> = new Set(['QUEUED', 'INELIGIBLE_TEMPORARILY', 'OVERFLOW']);
const OPEN_FOR_SUBMIT = new Set(['DRAFT', 'ACTIVE', 'PAUSED']);

export function submitRequest(deps: Deps, input: SubmitInput) {
  return runCommand(deps, input.eventId, input, async (c) => {
    const p = await requireParticipant(c.tx, input.participantId, input.token);
    const e = c.event;
    if (e.state === 'ENDED' || e.state === 'ARCHIVED') throw new DomainError('EVENT_ENDED');
    if (!OPEN_FOR_SUBMIT.has(e.state)) throw new DomainError('EVENT_NOT_ACTIVE');
    if (!allowedStyles(e.rules).includes(input.style)) {
      throw new DomainError('VALIDATION', 'That style is not part of this event.');
    }
    const t = input.track;
    const keys = [t.canonicalKey, ...(t.aliasKeys ?? []).filter((k) => k !== t.canonicalKey)];
    let uncertain = false;
    /** A waiting starter song with this recording: the guest takes it over instead of being refused. */
    let starter: RequestDoc | null = null;
    // Duplicates are rejected before quota is looked at, so a rejected duplicate costs nothing.
    for (const k of keys) {
      const hit = await c.tx.getRecordingKey(k);
      if (!hit || hit.state === 'released') continue;
      const other = await c.tx.getRequest(hit.requestId);
      // A fingerprint match is only certain when the lengths agree (SPEC §5).
      const lengthsDiffer =
        k.startsWith('fp:') &&
        t.durationMs !== null &&
        other?.durationMs != null &&
        Math.abs(t.durationMs - other.durationMs) > 5000;
      if (lengthsDiffer) uncertain = true;
      else if (other && other.ownerId === SYSTEM_SEED_ID && TAKEABLE.has(other.state)) {
        starter = other;
        break;
      } else
        throw new DomainError(
          'DUPLICATE',
          other ? `Already queued as “${other.title}”.` : undefined,
        );
    }
    if (starter) uncertain = false;
    if (t.looseKey && !starter) {
      const hit = await c.tx.getRecordingKey(t.looseKey);
      if (hit && hit.state !== 'released') uncertain = true;
    }
    // Recount from the requests themselves as a guard against a drifted counter.
    const mine = await c.tx.listRequests({ ownerId: p.id });
    const used = mine.filter((r) => countsTowardQuota(r.state)).length;
    if (used >= e.rules.submissionLimit) throw new DomainError('QUOTA_FULL');

    if (starter) {
      const seedOwner = await c.tx.getParticipant(SYSTEM_SEED_ID);
      const w = await loadWork(c);
      // Same request, new owner: it keeps its recording locks and now counts as a guest's song.
      const taken: RequestDoc = {
        ...starter,
        ownerId: p.id,
        style: input.style,
        sourceUrl: t.sourceUrl ?? starter.sourceUrl,
        durationMs: t.durationMs ?? starter.durationMs,
        artworkUrl: t.artworkUrl ?? starter.artworkUrl,
        acceptedSeq: e.acceptedSeq + 1,
        updatedAt: c.now,
      };
      w.event = { ...e, acceptedSeq: taken.acceptedSeq };
      w.putRequest(taken);
      c.tx.putParticipant({ ...p, acceptedCount: used + 1, lastSeenAt: c.now });
      if (seedOwner) {
        c.tx.putParticipant({
          ...seedOwner,
          acceptedCount: Math.max(0, seedOwner.acceptedCount - 1),
        });
      }
      audit(
        c,
        'request.takeover',
        'participant',
        { requestId: taken.id, style: taken.style },
        input.idempotencyKey ?? null,
      );
      const version = commit(c, w);
      return { request: w.requests.get(taken.id)!, version };
    }

    const heldKeys = new Set<string>();
    if (uncertain) {
      for (const k of keys) {
        const hit = await c.tx.getRecordingKey(k);
        if (hit && hit.state !== 'released') heldKeys.add(k);
      }
    }
    const w = await loadWork(c);
    const req: RequestDoc = {
      id: deps.ids.requestId(),
      ownerId: p.id,
      state: t.metadataPending || uncertain ? 'PENDING_METADATA' : 'QUEUED',
      title: t.title,
      artist: t.artist,
      style: input.style,
      provider: t.provider,
      canonicalKey: t.canonicalKey,
      sourceUrl: t.sourceUrl,
      durationMs: t.durationMs,
      artworkUrl: t.artworkUrl,
      playable: uncertain ? false : (t.playable ?? !t.metadataPending),
      keys,
      looseKey: t.looseKey ?? null,
      possibleDuplicate: uncertain,
      acceptedSeq: e.acceptedSeq + 1,
      createdAt: c.now,
      updatedAt: c.now,
      removedReason: null,
    };
    w.event = { ...e, acceptedSeq: req.acceptedSeq };
    w.putRequest(req);
    // A request held for review never steals a lock from the one it may duplicate.
    for (const k of keys) {
      if (!heldKeys.has(k)) c.tx.putRecordingKey({ key: k, requestId: req.id, state: 'active' });
    }
    if (req.looseKey && !uncertain) {
      c.tx.putRecordingKey({ key: req.looseKey, requestId: req.id, state: 'active' });
    }
    c.tx.putParticipant({ ...p, acceptedCount: used + 1, lastSeenAt: c.now });
    audit(
      c,
      'request.submit',
      'participant',
      { requestId: req.id, style: req.style },
      input.idempotencyKey ?? null,
    );
    const version = commit(c, w);
    return { request: w.requests.get(req.id)!, version };
  });
}

const STARTED = new Set(['PLAYING', 'PLAYED', 'SKIPPED']);

/** Shared by owner withdrawal and admin removal. `after` runs once all reads are done. */
async function takeOut(
  c: Ctx,
  w: Work,
  req: RequestDoc,
  to: 'WITHDRAWN' | 'REJECTED' | 'UNAVAILABLE',
  reason: string | null,
) {
  const owner = await c.tx.getParticipant(req.ownerId);
  // Release only the locks this request actually holds.
  const held: string[] = [];
  for (const k of [...req.keys, ...(req.looseKey ? [req.looseKey] : [])]) {
    const doc = await c.tx.getRecordingKey(k);
    if (doc && doc.requestId === req.id) held.push(k);
  }
  w.putRequest({ ...req, state: to, removedReason: reason, updatedAt: c.now });
  for (const key of held) {
    c.tx.putRecordingKey({ key, requestId: req.id, state: 'released' } satisfies RecordingKeyDoc);
  }
  if (owner) {
    const remaining = [...w.requests.values()].filter(
      (r) => r.ownerId === owner.id && countsTowardQuota(r.state),
    ).length;
    c.tx.putParticipant({ ...owner, acceptedCount: remaining });
  }
  // The reservation (if this was it) is cleared by recompute, which then picks the next song.
}

export function withdrawRequest(
  deps: Deps,
  input: CommandOpts & { eventId: string; participantId: string; token: string; requestId: string },
) {
  return runCommand(deps, input.eventId, input, async (c) => {
    const p = await requireParticipant(c.tx, input.participantId, input.token);
    if (c.event.state === 'ENDED' || c.event.state === 'ARCHIVED')
      throw new DomainError('EVENT_ENDED');
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (req.ownerId !== p.id) throw new DomainError('NOT_OWNER');
    if (req.state === 'WITHDRAWN') return { ok: true as const, version: c.event.version };
    if (STARTED.has(req.state) || req.state === 'REJECTED')
      throw new DomainError('ALREADY_STARTED');
    const w = await loadWork(c);
    await takeOut(c, w, req, 'WITHDRAWN', null);
    audit(
      c,
      'request.withdraw',
      'participant',
      { requestId: req.id },
      input.idempotencyKey ?? null,
    );
    return { ok: true as const, version: commit(c, w) };
  });
}

export function adminRemove(
  deps: Deps,
  input: CommandOpts & { eventId: string; adminSecret: string; requestId: string; reason?: string },
) {
  return runCommand(deps, input.eventId, input, async (c) => {
    await requireAdmin(c.tx, input.adminSecret);
    if (c.event.state === 'ENDED' || c.event.state === 'ARCHIVED')
      throw new DomainError('EVENT_ENDED');
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (req.state === 'REJECTED') return { ok: true as const, version: c.event.version };
    // Played records are the anti-duplicate history and cannot be erased.
    if (STARTED.has(req.state) || req.state === 'WITHDRAWN')
      throw new DomainError('ALREADY_STARTED');
    const w = await loadWork(c);
    await takeOut(c, w, req, 'REJECTED', input.reason ?? null);
    audit(
      c,
      'request.remove',
      'admin',
      { requestId: req.id, reason: input.reason ?? null },
      input.idempotencyKey ?? null,
    );
    return { ok: true as const, version: commit(c, w) };
  });
}

/** Called by ingestion when a PENDING_METADATA lookup finishes; `null` means it failed for good. */
export function resolveMetadata(
  deps: Deps,
  input: {
    eventId: string;
    requestId: string;
    metadata: Partial<Pick<RequestDoc, 'title' | 'artist' | 'durationMs' | 'artworkUrl'>> | null;
  },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (req.state !== 'PENDING_METADATA' || req.possibleDuplicate)
      return { ok: true as const, version: c.event.version };
    const w = await loadWork(c);
    if (input.metadata === null) {
      await takeOut(c, w, req, 'UNAVAILABLE', 'metadata unavailable');
    } else {
      w.putRequest({
        ...req,
        ...input.metadata,
        state: 'QUEUED',
        playable: true,
        updatedAt: c.now,
      });
    }
    audit(c, 'request.metadata', 'system', { requestId: req.id, ok: input.metadata !== null });
    return { ok: true as const, version: commit(c, w) };
  });
}

/** Admin decision on a request held as a possible duplicate. */
export function reviewDuplicate(
  deps: Deps,
  input: CommandOpts & {
    eventId: string;
    adminSecret: string;
    requestId: string;
    decision: 'approve' | 'reject';
  },
) {
  return runCommand(deps, input.eventId, input, async (c) => {
    await requireAdmin(c.tx, input.adminSecret);
    if (c.event.state === 'ENDED' || c.event.state === 'ARCHIVED')
      throw new DomainError('EVENT_ENDED');
    const req = await c.tx.getRequest(input.requestId);
    if (!req) throw new DomainError('NOT_FOUND');
    if (!req.possibleDuplicate || req.state !== 'PENDING_METADATA') {
      throw new DomainError('VALIDATION', 'This request is not waiting for review.');
    }
    if (input.decision === 'reject') {
      const w = await loadWork(c);
      await takeOut(c, w, req, 'REJECTED', 'duplicate');
      audit(c, 'request.duplicate.reject', 'admin', { requestId: req.id });
      return { ok: true as const, version: commit(c, w) };
    }
    const free: string[] = [];
    for (const k of [...req.keys, ...(req.looseKey ? [req.looseKey] : [])]) {
      const doc = await c.tx.getRecordingKey(k);
      if (!doc || doc.state === 'released') free.push(k);
    }
    const w = await loadWork(c);
    w.putRequest({
      ...req,
      state: 'QUEUED',
      playable: true,
      possibleDuplicate: false,
      updatedAt: c.now,
    });
    for (const key of free) c.tx.putRecordingKey({ key, requestId: req.id, state: 'active' });
    audit(c, 'request.duplicate.approve', 'admin', { requestId: req.id });
    return { ok: true as const, version: commit(c, w) };
  });
}
