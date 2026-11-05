import { DomainError } from '@qroove/contracts';
import type { EventTx, Repository } from '../db/ports.js';
import type { AdminGrantDoc, AuditDoc, EventDoc, RequestDoc } from '../db/types.js';
import type { Clock } from './clock.js';
import { sameHash, sha256, type Ids } from './ids.js';
import { recompute } from './recompute.js';

export interface Deps {
  repo: Repository;
  clock: Clock;
  ids: Ids;
}

export const LEASE_TTL_MS = 30_000;
export const HANDOVER_TTL_MS = 10 * 60_000;

export interface Ctx {
  deps: Deps;
  tx: EventTx;
  event: EventDoc;
  now: number;
}

export interface CommandOpts {
  idempotencyKey?: string | undefined;
  /** Optimistic concurrency check for admin commands. */
  expectedVersion?: number | undefined;
}

/**
 * Runs `fn` in one transaction after loading the event. With an idempotency key, a replay returns
 * the stored response without running `fn` again. Responses must be JSON-serialisable and must not
 * contain secrets, so commands that mint tokens never take a key.
 */
export async function runCommand<T extends object>(
  deps: Deps,
  eventId: string,
  opts: CommandOpts,
  fn: (c: Ctx) => Promise<T>,
): Promise<T> {
  return deps.repo.runInTransaction(eventId, async (tx) => {
    const key = opts.idempotencyKey;
    const replay = key ? await tx.getIdempotency(key) : null;
    if (replay) return replay.response as T;
    const event = await tx.getEvent();
    if (!event) throw new DomainError('NOT_FOUND');
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== event.version) {
      throw new DomainError('STALE_VERSION');
    }
    const now = deps.clock.now();
    const result = await fn({ deps, tx, event, now });
    if (key) tx.putIdempotency({ key, response: result, at: now });
    return result;
  });
}

export async function requireAdmin(
  tx: EventTx,
  secret: string,
  allowRecovery = false,
): Promise<AdminGrantDoc> {
  const grant = await tx.getAdminGrant(sha256(secret));
  if (!grant || grant.revokedAt !== null || (grant.role === 'recovery' && !allowRecovery)) {
    throw new DomainError('UNAUTHORISED');
  }
  return grant;
}

export async function requireParticipant(tx: EventTx, participantId: string, token: string) {
  const p = await tx.getParticipant(participantId);
  if (!p || !sameHash(p.tokenHash, sha256(token))) throw new DomainError('UNAUTHORISED');
  return p;
}

export function audit(
  c: Ctx,
  action: string,
  actorRole: AuditDoc['actorRole'],
  payload: Record<string, unknown> = {},
  idempotencyKey: string | null = null,
) {
  c.tx.appendAudit({ action, actorRole, at: c.now, payload, idempotencyKey });
}

export function assertOpen(event: EventDoc) {
  if (event.state === 'ENDED' || event.state === 'ARCHIVED') throw new DomainError('EVENT_ENDED');
}

/** In-memory working copy of the event and its requests; flushed once at the end of a command. */
export class Work {
  readonly requests: Map<string, RequestDoc>;
  readonly dirty = new Set<string>();

  constructor(
    public event: EventDoc,
    requests: RequestDoc[],
  ) {
    this.requests = new Map(requests.map((r) => [r.id, r]));
  }

  putRequest(r: RequestDoc) {
    this.requests.set(r.id, r);
    this.dirty.add(r.id);
  }

  setState(r: RequestDoc, state: RequestDoc['state'], now: number): RequestDoc {
    if (r.state === state) return r;
    const next = { ...r, state, updatedAt: now };
    this.putRequest(next);
    return next;
  }
}

export async function loadWork(c: Ctx): Promise<Work> {
  return new Work(c.event, await c.tx.listRequests());
}

/** Recomputes reservation + preview, writes touched requests and the event. Returns new version. */
export function commit(c: Ctx, w: Work, opts: { recompute?: boolean } = {}): number {
  // Radio only plays while nothing else does: a queue song, a pause, a break, the end or another
  // device taking the player role all close it.
  const r = w.event.radio;
  if (
    r &&
    (w.event.state !== 'ACTIVE' ||
      w.event.nowPlaying !== null ||
      w.event.lease?.epoch !== r.leaseEpoch ||
      w.event.breaks.some((b) => b.actualStart !== null && b.actualEnd === null))
  ) {
    w.event.radio = null;
  }
  if (opts.recompute !== false) recompute(w, c.now);
  for (const id of w.dirty) c.tx.putRequest(w.requests.get(id)!);
  return c.tx.putEvent(w.event);
}
