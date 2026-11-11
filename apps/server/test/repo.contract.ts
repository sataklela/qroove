import { describe, expect, it } from 'vitest';
import type { Repository } from '../src/db/ports.js';
import { newDraft } from '../src/domain/draft.js';
import { buildRules } from '../src/domain/draft.js';
import { makeDeps } from './helpers.js';
import type { RequestDoc } from '../src/db/types.js';

/** Behavioural contract every `Repository` adapter must satisfy. */
export function runRepoContract(name: string, make: () => Promise<Repository>, skip = false) {
  describe.skipIf(skip)(`Repository contract: ${name}`, () => {
    async function fresh() {
      const repo = await make();
      const deps = makeDeps(repo);
      const d = newDraft(deps, {
        name: 'Contract',
        timezone: 'UTC',
        rules: buildRules({}, 1),
        plannedDurationMin: null,
        breaks: [],
      });
      expect(await repo.createEvent({ event: d.event, adminGrants: d.adminGrants })).toBe(true);
      return { repo, deps, event: d.event };
    }
    const req = (id: string, seq: number, over: Partial<RequestDoc> = {}): RequestDoc => ({
      id,
      ownerId: 'o1',
      state: 'QUEUED',
      title: 't',
      artist: null,
      style: 'salsa',
      provider: 'manual',
      canonicalKey: `k${id}`,
      sourceUrl: null,
      durationMs: null,
      artworkUrl: null,
      playable: true,
      keys: [`k${id}`],
      looseKey: null,
      possibleDuplicate: false,
      acceptedSeq: seq,
      createdAt: 1,
      updatedAt: 1,
      removedReason: null,
      ...over,
    });

    it('rejects a duplicate slug and finds events by slug', async () => {
      const { repo, deps, event } = await fresh();
      const clash = newDraft(deps, {
        name: 'x',
        timezone: 'UTC',
        rules: buildRules({}, 1),
        plannedDurationMin: null,
        breaks: [],
      });
      clash.event.publicSlug = event.publicSlug;
      expect(await repo.createEvent({ event: clash.event, adminGrants: clash.adminGrants })).toBe(
        false,
      );
      expect((await repo.findEventBySlug(event.publicSlug))?.id).toBe(event.id);
      expect(await repo.findEventBySlug('NOPE00')).toBeNull();
    });

    it('commits writes, bumps version, and honours silent writes', async () => {
      const { repo, event } = await fresh();
      const v = await repo.runInTransaction(event.id, async (tx) => {
        const e = (await tx.getEvent())!;
        tx.putRequest(req('a', 1));
        return tx.putEvent({ ...e, acceptedSeq: 1 });
      });
      expect(v).toBe(event.version + 1);
      const silent = await repo.runInTransaction(event.id, async (tx) => {
        const e = (await tx.getEvent())!;
        return tx.putEvent({ ...e, acceptedSeq: 2 }, { silent: true });
      });
      expect(silent).toBe(v);
      const agg = (await repo.getEventPublic(event.id))!;
      expect(agg.event.version).toBe(v);
      expect(agg.event.acceptedSeq).toBe(2);
      expect(agg.requests.map((r) => r.id)).toEqual(['a']);
    });

    it('discards writes when the callback throws', async () => {
      const { repo, event } = await fresh();
      await expect(
        repo.runInTransaction(event.id, async (tx) => {
          tx.putRequest(req('a', 1));
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect((await repo.getEventPublic(event.id))!.requests).toHaveLength(0);
    });

    it('throws on a read after a write', async () => {
      const { repo, event } = await fresh();
      await expect(
        repo.runInTransaction(event.id, async (tx) => {
          tx.putRequest(req('a', 1));
          await tx.getRequest('a');
        }),
      ).rejects.toThrow(/read after write/);
    });

    it('serialises concurrent read-modify-write transactions', async () => {
      const { repo, event } = await fresh();
      await Promise.all(
        Array.from({ length: 8 }, () =>
          repo.runInTransaction(event.id, async (tx) => {
            const e = (await tx.getEvent())!;
            tx.putEvent({ ...e, acceptedSeq: e.acceptedSeq + 1 });
          }),
        ),
      );
      const e = (await repo.getEventPublic(event.id))!.event;
      expect(e.acceptedSeq).toBe(8);
      expect(e.version).toBe(event.version + 8);
    });

    it('lists requests by owner/state ordered by acceptedSeq', async () => {
      const { repo, event } = await fresh();
      await repo.runInTransaction(event.id, async (tx) => {
        tx.putRequest(req('c', 3, { ownerId: 'o2' }));
        tx.putRequest(req('a', 1));
        tx.putRequest(req('b', 2, { state: 'PLAYED' }));
      });
      await repo.runInTransaction(event.id, async (tx) => {
        expect((await tx.listRequests()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
        expect((await tx.listRequests({ ownerId: 'o1' })).map((r) => r.id)).toEqual(['a', 'b']);
        expect((await tx.listRequests({ states: ['PLAYED'] })).map((r) => r.id)).toEqual(['b']);
        expect(await tx.listRequests({ states: [] })).toEqual([]);
      });
    });

    it('round-trips keys, playback, grants, offers, idempotency and audit', async () => {
      const { repo, event } = await fresh();
      await repo.runInTransaction(event.id, async (tx) => {
        tx.putRecordingKey({ key: 'spotify:track:a/b', requestId: 'r', state: 'active' });
        tx.putPlayback({
          seq: 1,
          requestId: 'r',
          ownerId: 'o',
          style: 'salsa',
          startedAt: 1,
          endedAt: null,
          outcome: null,
        });
        tx.putHandoverOffer({ id: 'h', expiresAt: 5, usedAt: null });
        tx.putIdempotency({ key: 'k/1', response: { ok: true }, at: 1 });
        tx.putParticipant({
          id: 'p',
          tokenHash: 'x',
          nickname: 'N',
          joinedAt: 1,
          lastSeenAt: 1,
          acceptedCount: 0,
        });
        tx.appendAudit({
          action: 'a',
          actorRole: 'system',
          at: 1,
          payload: { n: 1 },
          idempotencyKey: null,
        });
      });
      await repo.runInTransaction(event.id, async (tx) => {
        expect((await tx.getRecordingKey('spotify:track:a/b'))?.state).toBe('active');
        expect(await tx.getRecordingKey('other')).toBeNull();
        expect((await tx.getPlayback(1))?.endedAt).toBeNull();
        expect((await tx.getHandoverOffer('h'))?.expiresAt).toBe(5);
        expect((await tx.getIdempotency('k/1'))?.response).toEqual({ ok: true });
        expect((await tx.listAdminGrants()).map((g) => g.role).sort()).toEqual([
          'admin',
          'recovery',
        ]);
        expect((await tx.getParticipant('p'))?.nickname).toBe('N');
      });
      expect((await repo.listAudit(event.id)).map((a) => a.action)).toEqual(['a']);
      expect((await repo.getEventPublic(event.id))!.nicknames).toEqual({ p: 'N' });
    });

    it('notifies subscribers after commits to the event doc', async () => {
      const { repo, event } = await fresh();
      const seen: number[] = [];
      const off = repo.subscribe(event.id, (e) => seen.push(e.version));
      await repo.runInTransaction(event.id, async (tx) => {
        tx.putEvent((await tx.getEvent())!);
      });
      await expect.poll(() => seen.at(-1), { timeout: 5000 }).toBe(event.version + 1);
      off();
    });

    it('reports a missing event as null inside a transaction', async () => {
      const repo = await make();
      await repo.runInTransaction('missing-event', async (tx) => {
        expect(await tx.getEvent()).toBeNull();
      });
      expect(await repo.getEventPublic('missing-event')).toBeNull();
    });

    it('purges per the cut-offs and keeps what is still inside retention', async () => {
      const { repo, event } = await fresh();
      const old = 1_000;
      const recent = 5_000_000;
      await repo.runInTransaction(event.id, async (tx) => {
        const e = (await tx.getEvent())!;
        tx.putEvent({ ...e, state: 'ENDED', endedAt: old });
        tx.putParticipant({
          id: 'p',
          tokenHash: 'h',
          nickname: 'N',
          joinedAt: old,
          lastSeenAt: old,
          acceptedCount: 0,
        });
        tx.appendAudit({
          action: 'old',
          actorRole: 'system',
          at: old,
          payload: {},
          idempotencyKey: null,
        });
        tx.appendAudit({
          action: 'new',
          actorRole: 'system',
          at: recent,
          payload: {},
          idempotencyKey: null,
        });
        tx.putIdempotency({ key: 'old', response: {}, at: old });
        tx.putIdempotency({ key: 'new', response: {}, at: recent });
      });
      const report = await repo.purge({
        draftsBefore: 0,
        participantsEndedBefore: 2_000,
        auditBefore: 2_000,
        idempotencyBefore: 2_000,
      });
      // Adapters may share a database with other tests, so counts are lower bounds.
      expect(report.participantsDeleted).toBeGreaterThanOrEqual(1);
      expect(report.auditDeleted).toBeGreaterThanOrEqual(1);
      expect(report.idempotencyDeleted).toBeGreaterThanOrEqual(1);
      expect((await repo.listAudit(event.id)).map((a) => a.action)).toEqual(['new']);
      expect((await repo.getEventPublic(event.id))!.nicknames).toEqual({});
      await repo.runInTransaction(event.id, async (tx) => {
        expect(await tx.getIdempotency('old')).toBeNull();
        expect(await tx.getIdempotency('new')).not.toBeNull();
      });
      // Idempotent: a second run finds nothing left to delete.
      const again = await repo.purge({
        draftsBefore: 0,
        participantsEndedBefore: 2_000,
        auditBefore: 2_000,
        idempotencyBefore: 2_000,
      });
      expect(again).toMatchObject({
        participantsDeleted: 0,
        auditDeleted: 0,
        idempotencyDeleted: 0,
      });
    });

    it('deletes abandoned drafts and frees their slug', async () => {
      const { repo, event } = await fresh();
      const cut = {
        draftsBefore: event.createdAt,
        participantsEndedBefore: 0,
        auditBefore: 0,
        idempotencyBefore: 0,
      };
      expect((await repo.purge(cut)).draftsDeleted).toBe(0); // not older than the cut-off
      expect(
        (await repo.purge({ ...cut, draftsBefore: event.createdAt + 1 })).draftsDeleted,
      ).toBeGreaterThanOrEqual(1);
      expect(await repo.getEventPublic(event.id)).toBeNull();
      expect(await repo.findEventBySlug(event.publicSlug)).toBeNull();
    });
  });
}
