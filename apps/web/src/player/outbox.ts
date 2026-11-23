import { ApiError } from '../shared/api';

/**
 * Play reports the player has not yet got through to the server (ADR 0029). The player never waits
 * for the server between songs: it writes "finished" and "started" here and goes on. They are sent
 * in order as soon as the network allows, with the real times, and survive a reload.
 */
export type PlayOp =
  | {
      kind: 'started';
      requestId: string;
      at: number;
      durationMs: number | null;
      /** Not the server's reservation when started, or sent late: the server may accept it anyway. */
      offline: boolean;
    }
  | { kind: 'finished'; requestId: string; at: number; outcome: 'PLAYED' | 'FAILED' };

/** Songs the player may start while reports are stuck, i.e. with no network (2 songs, ADR 0029). */
export const OFFLINE_SONGS = 2;

/** Server answers that mean "this report is no longer useful": drop it and carry on. */
const DROP = new Set([
  'STALE_VERSION',
  'NOT_FOUND',
  'EVENT_NOT_ACTIVE',
  'EVENT_ENDED',
  'VALIDATION',
]);

export type FlushResult = 'done' | 'offline' | 'lost';

export class Outbox {
  private ops: PlayOp[];
  private busy: Promise<FlushResult> | null = null;

  constructor(
    private readonly key: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null = safe(),
  ) {
    this.ops = read(storage, key);
  }

  get pending(): readonly PlayOp[] {
    return this.ops;
  }

  /** Songs started but not yet confirmed: the player stops at `OFFLINE_SONGS`. */
  get unconfirmedStarts(): number {
    return this.ops.filter((o) => o.kind === 'started').length;
  }

  push(op: PlayOp) {
    this.ops.push(op);
    this.save();
  }

  clear() {
    this.ops = [];
    this.save();
  }

  /**
   * Sends the reports in order. Stops at the first network failure (and marks what is left as
   * late, so the server treats it as offline play). A lost lease drops everything.
   */
  flush(
    send: (op: PlayOp) => Promise<unknown>,
    onDrop?: (op: PlayOp, code: string) => void,
  ): Promise<FlushResult> {
    this.busy ??= this.run(send, onDrop).finally(() => {
      this.busy = null;
    });
    return this.busy;
  }

  private async run(
    send: (op: PlayOp) => Promise<unknown>,
    onDrop?: (op: PlayOp, code: string) => void,
  ): Promise<FlushResult> {
    while (this.ops.length > 0) {
      const op = this.ops[0]!;
      try {
        await send(op);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'STALE_LEASE') {
          this.clear();
          return 'lost';
        }
        if (!(e instanceof ApiError) || !DROP.has(e.code)) {
          this.ops = this.ops.map((o) => (o.kind === 'started' ? { ...o, offline: true } : o));
          this.save();
          return 'offline';
        }
        onDrop?.(op, e.code);
      }
      this.ops.shift();
      this.save();
    }
    return 'done';
  }

  private save() {
    try {
      if (this.ops.length) this.storage?.setItem(this.key, JSON.stringify(this.ops));
      else this.storage?.removeItem(this.key);
    } catch {
      /* memory only */
    }
  }
}

function safe() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(s: Pick<Storage, 'getItem'> | null, key: string): PlayOp[] {
  try {
    const v = JSON.parse(s?.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? (v as PlayOp[]) : [];
  } catch {
    return [];
  }
}

/**
 * The song to play next: the server's reservation when it is still current, otherwise (the
 * server has not heard about recent songs yet) the next one in the last forecast this device saw.
 * `done` holds songs this device has already started.
 */
export function pickNext(o: {
  reservedId: string | null;
  queueIds: readonly string[];
  done: ReadonlySet<string>;
  unconfirmedStarts: number;
}): { id: string; offline: boolean } | null {
  if (o.reservedId && !o.done.has(o.reservedId)) return { id: o.reservedId, offline: false };
  if (o.unconfirmedStarts === 0) return null; // in step with the server: wait for its pick
  if (o.unconfirmedStarts >= OFFLINE_SONGS) return null;
  const id = o.queueIds.find((q) => !o.done.has(q));
  return id ? { id, offline: true } : null;
}
