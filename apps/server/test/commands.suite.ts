import { describe, expect, it } from 'vitest';
import { hashRules } from '@qroove/contracts/hash';
import type { Repository } from '../src/db/ports.js';
import * as cmd from '../src/domain/commands/index.js';
import { expectCode, guest, liveEvent, makeDeps, snap, track } from './helpers.js';

/** Domain command behaviour; runs against every adapter. */
export function runCommandSuite(name: string, make: () => Promise<Repository>, skip = false) {
  describe.skipIf(skip)(`Domain commands: ${name}`, () => {
    async function setup(body: Parameters<typeof liveEvent>[1] = {}, start = true) {
      const deps = makeDeps(await make());
      const ev = await liveEvent(deps, body, start);
      const admin = { eventId: ev.eventId, adminSecret: ev.adminSecret };
      const submit = (
        g: Awaited<ReturnType<typeof guest>>,
        n: string | number,
        style: 'salsa' | 'bachata' = 'salsa',
        dur?: number | null,
      ) => cmd.submitRequest(deps, { ...g, style, track: track(n, dur) });
      /** Claims the player, starts the reserved track and returns the lease handle. */
      const player = async () => {
        const c = await cmd.claimLease(deps, admin);
        const lease = { eventId: ev.eventId, leaseToken: c.leaseToken, epoch: c.lease.epoch };
        return {
          lease,
          start: async () => {
            const s = await snap(deps, ev.eventId);
            const id = s.event.reservation!.requestId;
            await cmd.reportStarted(deps, { ...lease, requestId: id });
            return id;
          },
          finish: (requestId: string, outcome: 'PLAYED' | 'FAILED' = 'PLAYED') =>
            cmd.reportFinished(deps, { ...lease, requestId, outcome }),
        };
      };
      return { deps, ev, admin, submit, player };
    }

    it('creates a draft, edits rules, then freezes them with a hash at start', async () => {
      const { deps, ev, admin } = await setup({}, false);
      expect(ev.slug).toHaveLength(6);
      expect((await snap(deps, ev.eventId)).event.state).toBe('DRAFT');
      await cmd.updateDraft(deps, { ...admin, submissionLimit: 3, masterRunCap: 3 });
      await cmd.startEvent(deps, admin);
      const { event } = await snap(deps, ev.eventId);
      expect(event.state).toBe('ACTIVE');
      expect(event.rules.submissionLimit).toBe(3);
      expect(event.rulesHash).toBe(hashRules(event.rules));
      await expectCode(cmd.updateDraft(deps, { ...admin, submissionLimit: 9 }), 'RULES_FROZEN');
      expect((await snap(deps, ev.eventId)).event.rulesHash).toBe(event.rulesHash);
    });

    it('rejects wrong, missing and recovery secrets for admin actions', async () => {
      const { deps, ev, admin } = await setup();
      await expectCode(
        cmd.pause(deps, { ...admin, adminSecret: 'nope-nope-nope-nope-nope' }),
        'UNAUTHORISED',
      );
      await expectCode(
        cmd.pause(deps, { ...admin, adminSecret: ev.recoverySecret }),
        'UNAUTHORISED',
      );
      await expectCode(
        cmd.pause(deps, { eventId: 'does-not-exist', adminSecret: ev.adminSecret }),
        'NOT_FOUND',
      );
    });

    it('starts the planned-time clock at start and refuses a stale expectedVersion', async () => {
      const deps = makeDeps(await make());
      const ev = await liveEvent(deps, { plannedDurationMin: 120 }, false);
      expect((await snap(deps, ev.eventId)).event.endAt).toBeNull();
      deps.clock.advance(5 * 60_000);
      await cmd.startEvent(deps, { eventId: ev.eventId, adminSecret: ev.adminSecret });
      expect((await snap(deps, ev.eventId)).event.endAt).toBe(deps.clock.now() + 120 * 60_000);
      await expectCode(
        cmd.updateDraft(deps, {
          eventId: ev.eventId,
          adminSecret: ev.adminSecret,
          expectedVersion: 99,
        }),
        'STALE_VERSION',
      );
    });

    it('reserves the first submission immediately and previews the queue', async () => {
      const { deps, ev, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const r1 = await submit(a, 1, 'salsa');
      const r2 = await submit(b, 2, 'bachata');
      const s = await snap(deps, ev.eventId);
      expect(s.state(r1.request.id)).toBe('RESERVED_NEXT');
      expect(s.state(r2.request.id)).toBe('QUEUED');
      expect(s.event.reservation?.requestId).toBe(r1.request.id);
      expect(s.event.preview.items.map((i) => i.requestId)).toEqual([r1.request.id, r2.request.id]);
      expect(s.event.preview.items[1]!.predictedStartMs).toBeGreaterThan(
        s.event.preview.items[0]!.predictedStartMs!,
      );
    });

    it('accepts exactly 5 of 6 concurrent submits from one participant', async () => {
      const { deps, ev, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const results = await Promise.allSettled([1, 2, 3, 4, 5, 6].map((n) => submit(a, n)));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason.code).toBe('QUOTA_FULL');
      const seqs = (await snap(deps, ev.eventId)).requests.map((r) => r.acceptedSeq).sort();
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
    });

    it('lets exactly one of two concurrent duplicate submits win, without spending quota', async () => {
      const { deps, ev, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const results = await Promise.allSettled([submit(a, 'same'), submit(b, 'same')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const loser = results.findIndex((r) => r.status === 'rejected') === 0 ? a : b;
      const rej = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')!;
      expect(rej.reason.code).toBe('DUPLICATE');
      for (const n of [1, 2, 3, 4, 5]) await submit(loser, n); // all five slots still free
    });

    it('frees quota and the recording on withdrawal', async () => {
      const { deps, ev, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const first = await submit(a, 1);
      for (const n of [2, 3, 4, 5]) await submit(a, n);
      await expectCode(submit(a, 6), 'QUOTA_FULL');
      await cmd.withdrawRequest(deps, { ...a, requestId: first.request.id });
      await submit(a, 6);
      await submit(await guest(deps, ev.eventId), 1); // withdrawn recording can be requested again
      expect((await snap(deps, ev.eventId)).state(first.request.id)).toBe('WITHDRAWN');
    });

    it('enforces ownership and blocks withdrawing a started song', async () => {
      const { deps, ev, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const r = await submit(a, 1);
      await expectCode(cmd.withdrawRequest(deps, { ...b, requestId: r.request.id }), 'NOT_OWNER');
      await expectCode(
        cmd.withdrawRequest(deps, { ...a, token: 'x'.repeat(43), requestId: r.request.id }),
        'UNAUTHORISED',
      );
      const p = await player();
      await p.start();
      await expectCode(
        cmd.withdrawRequest(deps, { ...a, requestId: r.request.id }),
        'ALREADY_STARTED',
      );
    });

    it('validates style, event state, and participant on submit', async () => {
      const { deps, ev, admin, submit } = await setup({ enabledStyles: ['salsa', 'bachata'] });
      const a = await guest(deps, ev.eventId);
      await expectCode(
        cmd.submitRequest(deps, { ...a, style: 'chacha', track: track(1) }),
        'VALIDATION',
      );
      await cmd.endEvent(deps, admin);
      await expectCode(submit(a, 1), 'EVENT_ENDED');
      const draft = await setup({}, false);
      await expectCode(
        draft.submit(await guest(draft.deps, draft.ev.eventId), 1),
        'EVENT_NOT_ACTIVE',
      );
    });

    it('plays oldest first within the genre cap, updates history on start, and blocks replays', async () => {
      const { deps, ev, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const s1 = await submit(a, 1, 'salsa');
      const s2 = await submit(a, 2, 'salsa');
      const b1 = await submit(b, 3, 'bachata');
      const p = await player();
      expect(await p.start()).toBe(s1.request.id);
      let s = await snap(deps, ev.eventId);
      expect(s.event.history.playedKeys).toEqual(['spotify:track:1']);
      expect(s.event.nowPlaying?.requestId).toBe(s1.request.id);
      expect(s.event.reservation).toBeNull(); // nothing is reserved while a song plays
      await p.finish(s1.request.id);
      s = await snap(deps, ev.eventId);
      expect(s.state(s1.request.id)).toBe('PLAYED');
      expect(s.event.reservation?.requestId).toBe(s2.request.id); // the same person may go again
      await expectCode(submit(b, 1), 'DUPLICATE'); // played recording stays blocked
      await p.finish(s1.request.id); // idempotent
      expect(await p.start()).toBe(s2.request.id);
      await p.finish(s2.request.id);
      s = await snap(deps, ev.eventId);
      expect(s.event.reservation?.requestId).toBe(b1.request.id);
    });

    it('waits, with a reason, when only a genre at its cap has songs left', async () => {
      const { deps, ev, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      await submit(a, 1);
      await submit(a, 2);
      const queued = await submit(a, 3);
      const p = await player();
      await p.finish(await p.start());
      await p.finish(await p.start());
      const s = await snap(deps, ev.eventId);
      expect(s.event.reservation).toBeNull();
      expect(s.state(queued.request.id)).toBe('INELIGIBLE_TEMPORARILY');
      expect(s.event.waitingReason).toMatch(/different genre/);
      const rb = await submit(a, 4, 'bachata');
      expect((await snap(deps, ev.eventId)).event.reservation?.requestId).toBe(rb.request.id);
    });

    it('rejects a start for anything but the reservation, and a stale or missing lease', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      await submit(a, 1);
      const other = await submit(b, 2, 'bachata');
      const p = await player();
      await expectCode(
        cmd.reportStarted(deps, { ...p.lease, requestId: other.request.id }),
        'STALE_VERSION',
      );
      await expectCode(
        cmd.reportStarted(deps, { ...p.lease, epoch: 99, requestId: other.request.id }),
        'STALE_LEASE',
      );
      await expectCode(cmd.claimLease(deps, admin), 'STALE_LEASE'); // held, no takeover
    });

    it('fences out a stale player after a takeover', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      await submit(await guest(deps, ev.eventId), 1);
      const old = await player();
      await cmd.heartbeat(deps, old.lease);
      const taken = await cmd.claimLease(deps, { ...admin, takeover: true });
      expect(taken.lease.epoch).toBe(old.lease.epoch + 1);
      await expectCode(cmd.heartbeat(deps, old.lease), 'STALE_LEASE');
      await expectCode(old.start(), 'STALE_LEASE');
      await expectCode(cmd.releaseLease(deps, old.lease), 'STALE_LEASE');
    });

    it('lets an expired lease be claimed without takeover, and heartbeats do not bump version', async () => {
      const { deps, ev, admin, player } = await setup();
      const p = await player();
      const v = (await snap(deps, ev.eventId)).event.version;
      deps.clock.advance(10_000);
      await cmd.heartbeat(deps, p.lease);
      expect((await snap(deps, ev.eventId)).event.version).toBe(v);
      deps.clock.advance(31_000);
      const next = await cmd.claimLease(deps, admin);
      expect(next.lease.epoch).toBe(p.lease.epoch + 1);
    });

    it('treats a track left playing at takeover as consumed, never replayed', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const r = await submit(await guest(deps, ev.eventId), 1);
      const p = await player();
      await p.start();
      await cmd.claimLease(deps, { ...admin, takeover: true });
      const s = await snap(deps, ev.eventId);
      expect(s.state(r.request.id)).toBe('PLAYED');
      expect(s.event.nowPlaying).toBeNull();
    });

    it('counts a failed or skipped started track toward quota and history', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      await expectCode(cmd.skip(deps, admin), 'VALIDATION');
      const first = await submit(a, 1);
      await submit(b, 2, 'bachata');
      const p = await player();
      await p.start();
      await cmd.skip(deps, admin);
      let s = await snap(deps, ev.eventId);
      expect(s.state(first.request.id)).toBe('SKIPPED');
      expect(s.event.history.playedKeys).toContain('spotify:track:1');
      for (const n of [3, 4, 5, 6]) await submit(a, n); // 1 skipped + 4 = 5 used
      await expectCode(submit(a, 7), 'QUOTA_FULL');
      const id = await p.start();
      await p.finish(id, 'FAILED');
      s = await snap(deps, ev.eventId);
      expect(s.state(id)).toBe('SKIPPED');
    });

    it('pause keeps the reservation; resume does not change it', async () => {
      const { deps, ev, admin, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const r = await submit(a, 1);
      await cmd.pause(deps, admin);
      await submit(b, 2, 'bachata'); // submissions still accepted while paused
      let s = await snap(deps, ev.eventId);
      expect(s.event.state).toBe('PAUSED');
      expect(s.event.reservation?.requestId).toBe(r.request.id);
      await cmd.pause(deps, admin); // idempotent
      await cmd.resume(deps, admin);
      s = await snap(deps, ev.eventId);
      expect(s.event.state).toBe('ACTIVE');
      expect(s.event.reservation?.requestId).toBe(r.request.id);
    });

    it('does not reserve while paused, and reserves on resume', async () => {
      const { deps, ev, admin, submit } = await setup();
      await cmd.pause(deps, admin);
      const r = await submit(await guest(deps, ev.eventId), 1);
      expect((await snap(deps, ev.eventId)).event.reservation).toBeNull();
      await cmd.resume(deps, admin);
      expect((await snap(deps, ev.eventId)).event.reservation?.requestId).toBe(r.request.id);
    });

    it('re-selects when the reserved song is withdrawn or removed by the admin', async () => {
      const { deps, ev, admin, submit } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const c = await guest(deps, ev.eventId);
      const r1 = await submit(a, 1);
      const r2 = await submit(b, 2, 'bachata');
      const r3 = await submit(c, 3);
      await cmd.withdrawRequest(deps, { ...a, requestId: r1.request.id });
      expect((await snap(deps, ev.eventId)).event.reservation?.requestId).toBe(r2.request.id);
      await cmd.adminRemove(deps, { ...admin, requestId: r2.request.id, reason: 'not on theme' });
      const s = await snap(deps, ev.eventId);
      expect(s.state(r2.request.id)).toBe('REJECTED');
      expect(s.event.reservation?.requestId).toBe(r3.request.id);
      // The owner's slot reopened.
      for (const n of [4, 5, 6, 7]) await submit(b, n);
      await submit(b, 8);
    });

    it('does not let the admin erase a played record', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const r = await submit(await guest(deps, ev.eventId), 1);
      const p = await player();
      await p.finish(await p.start());
      await expectCode(
        cmd.adminRemove(deps, { ...admin, requestId: r.request.id }),
        'ALREADY_STARTED',
      );
    });

    it('marks songs that cannot finish before the end time as OVERFLOW, and recovers on extension', async () => {
      const { deps, ev, admin, submit } = await setup();
      const now = deps.clock.now();
      await cmd.setEndTime(deps, { ...admin, endAt: now + 6 * 60_000 });
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const c = await guest(deps, ev.eventId);
      const r1 = await submit(a, 1, 'salsa', 240_000);
      const r2 = await submit(b, 2, 'bachata', 240_000);
      const r3 = await submit(c, 3, 'salsa', 240_000);
      let s = await snap(deps, ev.eventId);
      expect(s.state(r1.request.id)).toBe('RESERVED_NEXT');
      expect(s.state(r2.request.id)).toBe('OVERFLOW');
      expect(s.state(r3.request.id)).toBe('OVERFLOW');
      const overflow = s.event.preview.items.filter((i) => i.overflow);
      expect(overflow).toHaveLength(2);
      expect(overflow[0]!.predictedStartMs).toBeNull();
      await expectCode(cmd.setEndTime(deps, { ...admin, endAt: now + 5 * 60_000 }), 'VALIDATION'); // not later
      await cmd.setEndTime(deps, { ...admin, endAt: now + 60 * 60_000 });
      s = await snap(deps, ev.eventId);
      expect(s.state(r2.request.id)).toBe('QUEUED');
      expect(s.event.preview.items.some((i) => i.overflow)).toBe(false);
      await expectCode(cmd.setEndTime(deps, { ...admin, endAt: now - 1 }), 'VALIDATION');
    });

    it('holds starts during a break and resumes after it', async () => {
      const { deps, ev, admin, submit, player } = await setup({
        plannedDurationMin: 120,
        breaks: [{ label: 'Class', startMin: 60, durationSec: 600 }],
      });
      const brk = (await snap(deps, ev.eventId)).event.breaks[0]!;
      await submit(await guest(deps, ev.eventId), 1);
      const p = await player();
      await cmd.startBreak(deps, { ...admin, breakId: brk.id });
      await expectCode(cmd.startBreak(deps, { ...admin, breakId: brk.id }), 'VALIDATION');
      await expectCode(p.start(), 'EVENT_NOT_ACTIVE');
      await cmd.endBreak(deps, { ...admin, breakId: brk.id });
      await p.start();
      await expectCode(cmd.endBreak(deps, { ...admin, breakId: brk.id }), 'VALIDATION');
    });

    it('replays an idempotent submit without spending quota twice', async () => {
      const { deps, ev } = await setup();
      const a = await guest(deps, ev.eventId);
      const input = { ...a, style: 'salsa' as const, track: track(1), idempotencyKey: 'key-1' };
      const first = await cmd.submitRequest(deps, input);
      const again = await cmd.submitRequest(deps, input);
      expect(again.request.id).toBe(first.request.id);
      expect((await snap(deps, ev.eventId)).requests).toHaveLength(1);
      for (const n of [2, 3, 4, 5])
        await cmd.submitRequest(deps, { ...a, style: 'salsa', track: track(n) });
    });

    it('resolves pending metadata into the queue, or marks it unavailable', async () => {
      const { deps, ev } = await setup();
      const a = await guest(deps, ev.eventId);
      const pending = await cmd.submitRequest(deps, {
        ...a,
        style: 'salsa',
        track: { ...track(1), metadataPending: true },
      });
      const dead = await cmd.submitRequest(deps, {
        ...a,
        style: 'salsa',
        track: { ...track(2), metadataPending: true },
      });
      let s = await snap(deps, ev.eventId);
      expect(s.state(pending.request.id)).toBe('PENDING_METADATA');
      expect(s.event.reservation).toBeNull();
      await cmd.resolveMetadata(deps, {
        eventId: ev.eventId,
        requestId: pending.request.id,
        metadata: { durationMs: 200_000 },
      });
      await cmd.resolveMetadata(deps, {
        eventId: ev.eventId,
        requestId: dead.request.id,
        metadata: null,
      });
      s = await snap(deps, ev.eventId);
      expect(s.state(pending.request.id)).toBe('RESERVED_NEXT');
      expect(s.state(dead.request.id)).toBe('UNAVAILABLE');
      for (const n of [3, 4, 5, 6])
        await cmd.submitRequest(deps, { ...a, style: 'salsa', track: track(n) }); // UNAVAILABLE freed a slot
    });

    it('hands over admin: old secret dies at once, code is single-use and expires', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      await submit(await guest(deps, ev.eventId), 1);
      const p = await player();
      await p.start();
      const offer = await cmd.createHandoverOffer(deps, admin);
      expect((await snap(deps, ev.eventId)).event.state).toBe('TRANSFERRING');
      await expectCode(
        cmd.claimHandover(deps, { eventId: ev.eventId, code: 'WRONGWRONGWRONG0' }),
        'UNAUTHORISED',
      );
      const claimed = await cmd.claimHandover(deps, { eventId: ev.eventId, code: offer.code });
      const s = await snap(deps, ev.eventId);
      expect(s.event.state).toBe('PAUSED');
      expect(s.event.nowPlaying).toBeNull(); // the partly played song is consumed
      expect(s.event.lease).toBeNull();
      await expectCode(cmd.pause(deps, admin), 'UNAUTHORISED');
      await expectCode(
        cmd.claimHandover(deps, { eventId: ev.eventId, code: offer.code }),
        'UNAUTHORISED',
      );
      await expectCode(cmd.heartbeat(deps, p.lease), 'STALE_LEASE');
      await cmd.resume(deps, { eventId: ev.eventId, adminSecret: claimed.adminSecret });
      // recovery secret survives handover and can take control back
      const rec = await cmd.recoverAdmin(deps, {
        eventId: ev.eventId,
        recoverySecret: ev.recoverySecret,
      });
      await expectCode(
        cmd.pause(deps, { eventId: ev.eventId, adminSecret: claimed.adminSecret }),
        'UNAUTHORISED',
      );
      await cmd.pause(deps, { eventId: ev.eventId, adminSecret: rec.adminSecret });
    });

    it('rejects an expired handover code, and a cancelled one', async () => {
      const { deps, ev, admin } = await setup();
      const offer = await cmd.createHandoverOffer(deps, admin);
      deps.clock.advance(11 * 60_000);
      await expectCode(
        cmd.claimHandover(deps, { eventId: ev.eventId, code: offer.code }),
        'UNAUTHORISED',
      );
      const second = await cmd.createHandoverOffer(deps, admin);
      await cmd.resume(deps, admin); // cancels the transfer
      expect((await snap(deps, ev.eventId)).event.state).toBe('ACTIVE');
      await expectCode(
        cmd.claimHandover(deps, { eventId: ev.eventId, code: second.code }),
        'UNAUTHORISED',
      );
    });

    it('ends terminally with a carry-over list, then archives', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      await submit(a, 1);
      await submit(b, 2, 'bachata');
      await submit(a, 3);
      const p = await player();
      await p.start();
      const ended = await cmd.endEvent(deps, admin);
      expect(ended.carryOver.map((c) => c.title)).toEqual(['Song 2', 'Song 3']);
      const s = await snap(deps, ev.eventId);
      expect(s.event.state).toBe('ENDED');
      expect(s.event.nowPlaying).toBeNull();
      expect(s.event.preview.items).toEqual([]);
      await expectCode(cmd.resume(deps, admin), 'EVENT_ENDED');
      await expectCode(cmd.endEvent(deps, admin), 'EVENT_ENDED');
      await expectCode(cmd.claimLease(deps, admin), 'EVENT_ENDED');
      await cmd.archive(deps, admin);
      expect((await snap(deps, ev.eventId)).event.state).toBe('ARCHIVED');
    });

    it('imports a snapshot as seeded system requests with reproducible per-style shuffle', async () => {
      const { deps, ev, admin } = await setup();
      const rules = (await snap(deps, ev.eventId)).event.rules;
      const recommendations = Array.from({ length: 8 }, (_, i) => ({
        title: `Seed ${i}`,
        artist: 'X',
        style: (i % 2 ? 'bachata' : 'salsa') as 'salsa' | 'bachata',
        durationMs: 200_000,
        sourceUrl: null,
      }));
      const snapshot = { formatVersion: 1 as const, name: 'Old night', rules, recommendations };
      const order = async (seed: number) => {
        const r = await cmd.importSnapshot(deps, {
          snapshot,
          shuffle: true,
          seed,
          timezone: 'UTC',
          plannedDurationMin: 240,
        });
        const s = await snap(deps, r.eventId);
        return { r, s, titles: s.requests.map((q) => q.title) };
      };
      const one = await order(7);
      const two = await order(7);
      const other = await order(8);
      expect(one.titles).toEqual(two.titles);
      expect(one.titles).not.toEqual(other.titles);
      expect(one.s.requests.every((q) => q.ownerId === 'system-seed')).toBe(true);
      // Style slots keep their positions.
      expect(one.s.requests.map((q) => q.style)).toEqual(recommendations.map((q) => q.style));
      expect(one.s.event.state).toBe('DRAFT');
      expect(one.s.event.importSeed).toBe(7);
      expect(one.r.adminSecret).not.toBe(admin.adminSecret);

      // Seeds follow the genre rules like anyone else, so they keep playing without a guest.
      const started = { eventId: one.r.eventId, adminSecret: one.r.adminSecret };
      await cmd.startEvent(deps, started);
      const p = await cmd.claimLease(deps, started);
      const lease = { eventId: one.r.eventId, leaseToken: p.leaseToken, epoch: p.lease.epoch };
      let s = await snap(deps, one.r.eventId);
      const first = s.event.reservation!.requestId;
      await cmd.reportStarted(deps, { ...lease, requestId: first });
      await cmd.reportFinished(deps, { ...lease, requestId: first, outcome: 'PLAYED' });
      s = await snap(deps, one.r.eventId);
      expect(s.event.reservation).not.toBeNull();
    });

    it('imports only selected, enabled-style songs and de-duplicates them', async () => {
      const { deps, ev } = await setup();
      const rules = (await snap(deps, ev.eventId)).event.rules;
      const song = (title: string, style: 'salsa' | 'chacha') => ({
        title,
        artist: null,
        style,
        durationMs: null,
        sourceUrl: null,
      });
      const r = await cmd.importSnapshot(deps, {
        snapshot: {
          formatVersion: 1,
          name: 'n',
          rules,
          recommendations: [
            song('A', 'salsa'),
            song('a', 'salsa'),
            song('B', 'chacha'),
            song('C', 'salsa'),
          ],
        },
        selectedIndexes: [0, 1, 2],
        timezone: 'UTC',
        plannedDurationMin: 120,
      });
      expect(r.seeded).toBe(1);
    });

    it('lets anyone with the room code join, and refuses an ended event', async () => {
      const { deps, ev, admin } = await setup();
      const j = await cmd.joinEvent(deps, { eventId: ev.eventId, nickname: 'Ana' });
      expect(j.participantId).toBeTruthy();
      await cmd.endEvent(deps, admin);
      await expectCode(cmd.joinEvent(deps, { eventId: ev.eventId }), 'EVENT_ENDED');
    });

    it('enforces the break limits: half of the time, spacing, steps of ten minutes', async () => {
      const deps = makeDeps(await make());
      const mk = (planned: number | undefined, spec: Array<[number, number]>) =>
        cmd.createEvent(deps, {
          timezone: 'UTC',
          ...(planned ? { plannedDurationMin: planned } : {}),
          breaks: spec.map(([startMin, m]) => ({ startMin, durationSec: m * 60 })),
        });
      await mk(120, [[60, 10]]);
      await mk(120, [
        [30, 20],
        [70, 20],
      ]); // two breaks, 20 minutes of music between them
      await expectCode(
        mk(120, [
          [40, 30],
          [70, 30],
        ]),
        'VALIDATION',
      ); // back to back: nothing between them
      await expectCode(
        mk(120, [
          [20, 30],
          [60, 30],
          [100, 30],
        ]),
        'VALIDATION',
      ); // over half
      await expectCode(mk(undefined, [[60, 10]]), 'VALIDATION'); // needs a planned time
      await expectCode(mk(120, [[60, 15]]), 'VALIDATION'); // not a ten-minute step
      await expectCode(mk(120, [[55, 10]]), 'VALIDATION'); // not on the 10-minute grid
      await mk(60, [[20, 20]]);
      await expectCode(mk(60, [[10, 30]]), 'VALIDATION'); // only 10 minutes of music before it
    });

    it('gives each part of the evening its own styles', async () => {
      const deps = makeDeps(await make());
      const ev = await cmd.createEvent(deps, {
        timezone: 'UTC',
        plannedDurationMin: 120,
        breaks: [{ startMin: 60, durationSec: 600 }],
        segments: [{ enabledStyles: ['salsa'] }, { enabledStyles: ['chacha', 'other'] }],
      });
      expect(ev.rules.segments.map((s) => s.enabledStyles)).toEqual([
        ['salsa'],
        ['chacha', 'other'],
      ]);
      await expectCode(
        cmd.createEvent(deps, {
          timezone: 'UTC',
          plannedDurationMin: 120,
          breaks: [{ startMin: 60, durationSec: 600 }],
          segments: [{ enabledStyles: ['salsa'] }], // one part short
        }),
        'VALIDATION',
      );
      const admin = { eventId: ev.eventId, adminSecret: ev.adminSecret };
      await cmd.startEvent(deps, admin);
      const g = await guest(deps, ev.eventId);
      const h = await guest(deps, ev.eventId);
      await expectCode(
        cmd.submitRequest(deps, { ...g, style: 'bachata', track: track(1) }),
        'VALIDATION',
      ); // allowed in no part of the evening
      const early = await cmd.submitRequest(deps, { ...g, style: 'chacha', track: track(2) });
      const salsa = await cmd.submitRequest(deps, { ...h, style: 'salsa', track: track(3) });
      const s = await snap(deps, ev.eventId);
      // The cha-cha song came first but is only allowed after the break; salsa is reserved now.
      expect(s.state(salsa.request.id)).toBe('RESERVED_NEXT');
      const brk = s.event.breaks[0]!;
      expect(s.state(early.request.id)).toBe('QUEUED');
      const at = s.event.preview.items.find((i) => i.requestId === early.request.id)!;
      expect(at.predictedStartMs!).toBeGreaterThanOrEqual(brk.startsAt! + 600_000); // after the break
    });

    it('stops reserving songs that would run into a break, and resumes after it', async () => {
      // 2 h event, a 10-minute break tapped at the midpoint: music until 1:00, break 1:00-1:10.
      const { deps, ev, admin, submit, player } = await setup({
        plannedDurationMin: 120,
        breaks: [{ startMin: 60, durationSec: 600 }],
      });
      const brk = (await snap(deps, ev.eventId)).event.breaks[0]!;
      expect(brk.startsAt).toBe(deps.clock.now() + 60 * 60_000);
      deps.clock.advance(57 * 60_000);
      await submit(await guest(deps, ev.eventId), 1, 'salsa', 240_000); // 4 min: ends 1:01 > 1:00
      let s = await snap(deps, ev.eventId);
      expect(s.event.reservation).toBeNull();
      expect(s.event.waitingReason).toMatch(/break/i);
      expect(
        s.event.preview.items.some((i) => i.predictedStartMs! >= brk.startsAt! + 600_000),
      ).toBe(true);
      deps.clock.advance(4 * 60_000); // 1:01
      await cmd.startBreak(deps, { ...admin, breakId: brk.id });
      deps.clock.advance(10 * 60_000);
      await cmd.endBreak(deps, { ...admin, breakId: brk.id });
      s = await snap(deps, ev.eventId);
      expect(s.event.reservation).not.toBeNull();
      await (await player()).start();
    });

    it('treats salsa and non-Latin salsa-compatible as one genre', async () => {
      const { deps, ev } = await setup({ enabledStyles: ['salsa', 'salsa_nl', 'bachata'] });
      const a = await guest(deps, ev.eventId);
      const b = await guest(deps, ev.eventId);
      const c = await guest(deps, ev.eventId);
      await cmd.submitRequest(deps, { ...a, style: 'salsa', track: track(1) });
      await cmd.submitRequest(deps, { ...b, style: 'salsa_nl', track: track(2) });
      await cmd.submitRequest(deps, { ...c, style: 'salsa', track: track(3) });
      const admin = { eventId: ev.eventId, adminSecret: ev.adminSecret };
      const claim = await cmd.claimLease(deps, admin);
      const lease = { eventId: ev.eventId, leaseToken: claim.leaseToken, epoch: claim.lease.epoch };
      for (let i = 0; i < 2; i++) {
        const id = (await snap(deps, ev.eventId)).event.reservation!.requestId;
        await cmd.reportStarted(deps, { ...lease, requestId: id });
        await cmd.reportFinished(deps, { ...lease, requestId: id, outcome: 'PLAYED' });
      }
      const h = (await snap(deps, ev.eventId)).event.history;
      expect(h.lastStyle).toBe('salsa'); // the genre, not the style
      expect(h.runLength).toBe(2);
      expect(h.transitionCount).toBe(0);
      // Run cap of 2 is reached by two salsa-genre songs: a third waits for another genre.
      expect((await snap(deps, ev.eventId)).event.reservation).toBeNull();
    });

    it('single genre: plays oldest first, with no run cap', async () => {
      const { deps, ev, admin } = await setup({ enabledStyles: ['salsa'], masterRunCap: 1 });
      const a = await guest(deps, ev.eventId);
      const ids = [];
      for (const n of ['a1', 'a2', 'a3']) {
        ids.push(
          (await cmd.submitRequest(deps, { ...a, style: 'salsa', track: track(n) })).request.id,
        );
      }
      const claim = await cmd.claimLease(deps, admin);
      const lease = { eventId: ev.eventId, leaseToken: claim.leaseToken, epoch: claim.lease.epoch };
      const order = [];
      for (let i = 0; i < 3; i++) {
        const id = (await snap(deps, ev.eventId)).event.reservation!.requestId;
        await cmd.reportStarted(deps, { ...lease, requestId: id });
        await cmd.reportFinished(deps, { ...lease, requestId: id, outcome: 'PLAYED' });
        order.push(id);
      }
      expect(order).toEqual(ids);
    });

    it('never writes secrets to the audit trail', async () => {
      const { deps, ev, admin, submit, player } = await setup();
      const g = await guest(deps, ev.eventId);
      await submit(g, 1);
      const p = await player();
      await cmd.createHandoverOffer(deps, admin);
      const text = JSON.stringify(await deps.repo.listAudit(ev.eventId));
      for (const secret of [ev.adminSecret, ev.recoverySecret, g.token, p.lease.leaseToken]) {
        expect(text).not.toContain(secret);
      }
      expect(text).toContain('request.submit');
    });

    describe('radio fallback', () => {
      const B = {
        stationId: 'bachata-sensual-radio',
        trackKey: '2026-11-05T14:02:27+00:00',
        title: 'Mix',
      };
      async function radioSetup() {
        const x = await setup();
        await cmd.setRadioFallback(x.deps, { ...x.admin, enabled: true });
        x.deps.clock.advance(5 * 60_000 + 1); // past the start grace
        const p = await x.player();
        return { ...x, p };
      }

      it('waits out the start grace, and refuses once the organiser switches it off', async () => {
        const { deps, admin, player } = await setup();
        const p = await player();
        await expectCode(cmd.reportRadioStarted(deps, { ...p.lease, ...B }), 'VALIDATION'); // grace
        deps.clock.advance(5 * 60_000 + 1);
        await cmd.setRadioFallback(deps, { ...admin, enabled: false });
        await expectCode(
          cmd.reportRadioStarted(deps, { ...p.lease, ...B, title: null }),
          'VALIDATION',
        );
      });

      it('records a radio track once, as a system play that changes the genre history', async () => {
        const { deps, ev, p } = await radioSetup();
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        const v1 = (await snap(deps, ev.eventId)).event;
        expect(v1.radio?.stationId).toBe(B.stationId);
        expect(v1.history).toMatchObject({
          lastStyle: 'bachata',
          runLength: 0,
          transitionCount: 0,
        });
        const again = await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        expect(again.version).toBe(v1.version);
        // The next track on the same station is the same genre: the run does not grow.
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B, trackKey: 'next' });
        const v2 = (await snap(deps, ev.eventId)).event;
        expect(v2.history).toMatchObject({ lastStyle: 'bachata', runLength: 0 });
        expect(v2.history.playedKeys).toEqual([]);
        expect(v2.nowPlaying).toBeNull();
      });

      it('refuses stale leases, unknown or disabled stations and genres the event does not allow', async () => {
        const { deps, p } = await radioSetup();
        await expectCode(
          cmd.reportRadioStarted(deps, { ...p.lease, epoch: 99, ...B }),
          'STALE_LEASE',
        );
        await expectCode(
          cmd.reportRadioStarted(deps, { ...p.lease, ...B, stationId: 'nope' }),
          'VALIDATION',
        );
        await expectCode(
          cmd.reportRadioStarted(deps, { ...p.lease, ...B, stationId: 'salsaviva-live365' }),
          'VALIDATION',
        );
      });

      it('lets a queued song reserve at once, and a queue start closes the radio', async () => {
        const { deps, ev, submit, p } = await radioSetup();
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        const g = await guest(deps, ev.eventId);
        await submit(g, 1, 'salsa');
        const mid = (await snap(deps, ev.eventId)).event;
        expect(mid.reservation).not.toBeNull();
        expect(mid.radio).not.toBeNull(); // still audible until the player hands over
        await expectCode(
          cmd.reportRadioStarted(deps, { ...p.lease, ...B, trackKey: 'x' }),
          'STALE_VERSION',
        );
        await p.start();
        const after = (await snap(deps, ev.eventId)).event;
        expect(after.radio).toBeNull();
        expect(after.nowPlaying).not.toBeNull();
        expect(after.history).toMatchObject({ lastStyle: 'salsa', transitionCount: 1 });
      });

      it('never holds back a guest song of the genre the radio is playing, even with a cap of 1', async () => {
        const x = await setup({ masterRunCap: 1 });
        x.deps.clock.advance(5 * 60_000 + 1);
        const p = await x.player();
        await cmd.reportRadioStarted(x.deps, { ...p.lease, ...B });
        const g = await guest(x.deps, x.ev.eventId);
        await x.submit(g, 1, 'bachata');
        const e = (await snap(x.deps, x.ev.eventId)).event;
        expect(e.reservation).not.toBeNull();
        await p.start();
        expect((await snap(x.deps, x.ev.eventId)).event.history).toMatchObject({
          lastStyle: 'bachata',
          runLength: 1,
        });
      });

      it('fills a genre gap: queued salsa only, cap 1, so radio bachata releases the next salsa', async () => {
        const x = await setup({ masterRunCap: 1 });
        x.deps.clock.advance(5 * 60_000 + 1);
        const g = await guest(x.deps, x.ev.eventId);
        for (const n of [1, 2, 3]) await x.submit(g, n, 'salsa');
        const p = await x.player();
        const first = await p.start();
        await p.finish(first);
        let e = (await snap(x.deps, x.ev.eventId)).event;
        expect(e.reservation).toBeNull(); // salsa again would break the cap: the room would be silent
        await cmd.reportRadioStarted(x.deps, { ...p.lease, ...B });
        e = (await snap(x.deps, x.ev.eventId)).event;
        expect(e.reservation).not.toBeNull(); // the gap is filled and the next salsa is due
        await p.start();
        expect((await snap(x.deps, x.ev.eventId)).event.radio).toBeNull();
      });

      it('does not touch participant quotas and closes on pause, takeover and end', async () => {
        const { deps, ev, admin, p } = await radioSetup();
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        await cmd.pause(deps, admin);
        expect((await snap(deps, ev.eventId)).event.radio).toBeNull();
        await cmd.resume(deps, admin);
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        await cmd.claimLease(deps, { ...admin, takeover: true });
        expect((await snap(deps, ev.eventId)).event.radio).toBeNull();
        await expectCode(cmd.reportRadioStarted(deps, { ...p.lease, ...B }), 'STALE_LEASE');
      });

      it('ending the radio is idempotent and switching the fallback off stops it', async () => {
        const { deps, ev, admin, p } = await radioSetup();
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        await cmd.reportRadioEnded(deps, p.lease);
        const v = (await snap(deps, ev.eventId)).event;
        expect(v.radio).toBeNull();
        expect((await cmd.reportRadioEnded(deps, p.lease)).version).toBe(v.version);
        await cmd.reportRadioStarted(deps, { ...p.lease, ...B });
        await cmd.setRadioFallback(deps, { ...admin, enabled: false });
        expect((await snap(deps, ev.eventId)).event.radio).toBeNull();
      });
    });
  });
}
