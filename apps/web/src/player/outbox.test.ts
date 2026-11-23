import { describe, expect, it } from 'vitest';
import { ApiError } from '../shared/api';
import { Outbox, pickNext, type PlayOp } from './outbox';

const mem = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
};
const err = (code: string) => new ApiError(code, code, '', code === 'OFFLINE' ? 0 : 409);
const started = (requestId: string): PlayOp => ({
  kind: 'started',
  requestId,
  at: 1,
  durationMs: null,
  offline: false,
});
const finished = (requestId: string): PlayOp => ({
  kind: 'finished',
  requestId,
  at: 2,
  outcome: 'PLAYED',
});

describe('Outbox', () => {
  it('sends in order and survives a reload', async () => {
    const s = mem();
    const box = new Outbox('k', s);
    box.push(finished('a'));
    box.push(started('b'));
    const again = new Outbox('k', s);
    expect(again.pending).toHaveLength(2);
    const sent: string[] = [];
    expect(await again.flush(async (op) => sent.push(`${op.kind}:${op.requestId}`))).toBe('done');
    expect(sent).toEqual(['finished:a', 'started:b']);
    expect(new Outbox('k', s).pending).toHaveLength(0);
  });

  it('stops at a network failure, marks starts as late, and goes on later', async () => {
    const box = new Outbox('k', mem());
    box.push(finished('a'));
    box.push(started('b'));
    expect(await box.flush(() => Promise.reject(err('OFFLINE')))).toBe('offline');
    expect(box.unconfirmedStarts).toBe(1);
    expect(box.pending[1]).toMatchObject({ kind: 'started', offline: true });
    expect(await box.flush(() => Promise.resolve())).toBe('done');
  });

  it('drops reports the server no longer wants, and everything on a lost lease', async () => {
    const box = new Outbox('k', mem());
    box.push(started('gone'));
    box.push(started('b'));
    const sent: string[] = [];
    await box.flush(async (op) => {
      if (op.requestId === 'gone') throw err('STALE_VERSION');
      sent.push(op.requestId);
    });
    expect(sent).toEqual(['b']);
    box.push(started('c'));
    expect(await box.flush(() => Promise.reject(err('STALE_LEASE')))).toBe('lost');
    expect(box.pending).toHaveLength(0);
  });
});

describe('pickNext', () => {
  const q = ['b', 'c', 'd'];
  it('follows the server when it is in step', () => {
    expect(
      pickNext({ reservedId: 'b', queueIds: q, done: new Set(), unconfirmedStarts: 0 }),
    ).toEqual({ id: 'b', offline: false });
    // The server has every report but has not picked anything: wait.
    expect(pickNext({ reservedId: null, queueIds: q, done: new Set(), unconfirmedStarts: 0 })).toBe(
      null,
    );
  });
  it('goes on through the forecast for two songs without the server, then stops', () => {
    expect(
      pickNext({ reservedId: 'b', queueIds: q, done: new Set(['a', 'b']), unconfirmedStarts: 1 }),
    ).toEqual({ id: 'c', offline: true });
    expect(
      pickNext({
        reservedId: 'b',
        queueIds: q,
        done: new Set(['a', 'b', 'c']),
        unconfirmedStarts: 2,
      }),
    ).toBe(null);
  });
});
