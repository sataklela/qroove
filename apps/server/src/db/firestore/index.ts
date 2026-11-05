import { createHash } from 'node:crypto';
import type { YouTubeMatchDoc } from '../types.js';
import type { DocumentReference, Firestore, Query, Transaction } from 'firebase-admin/firestore';
import type { EventTx, Repository } from '../ports.js';
import { EMPTY_NAME_LEDGER } from '../types.js';
import type {
  AdminGrantDoc,
  AuditDoc,
  EventAggregate,
  EventDoc,
  HandoverOfferDoc,
  IdempotencyDoc,
  NameLedger,
  NewEventBundle,
  PurgeCutoffs,
  PurgeReport,
  ParticipantDoc,
  PlaybackDoc,
  RecordingKeyDoc,
  RequestDoc,
  RequestFilter,
} from '../types.js';

/**
 * Storage notes: all times are epoch-ms numbers (no Firestore Timestamps), so the domain never sees
 * adapter types. Client-supplied keys (recording keys, idempotency keys) are hashed into doc ids
 * because they may contain `/`.
 */
const hashId = (s: string) => createHash('sha256').update(s).digest('hex');
const bySeq = (a: RequestDoc, b: RequestDoc) =>
  a.acceptedSeq - b.acceptedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class FirestoreRepository implements Repository {
  constructor(private readonly db: Firestore) {}

  private event(id: string) {
    return this.db.collection('events').doc(id);
  }

  /**
   * Transactions on one event are queued in-process first. Every command rewrites the same event
   * document, so concurrent transactions would just abort and retry each other (measured: p95 > 50 s
   * with 25 simultaneous submitters). Production runs one instance, so the queue removes the
   * contention; Firestore transactions still guarantee correctness if a second instance appears.
   */
  private readonly tails = new Map<string, Promise<unknown>>();

  runInTransaction<T>(eventId: string, fn: (tx: EventTx) => Promise<T>): Promise<T> {
    const prev = this.tails.get(eventId) ?? Promise.resolve();
    const run = prev.then(() => this.transact(eventId, fn));
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(eventId, tail);
    void tail.then(() => {
      if (this.tails.get(eventId) === tail) this.tails.delete(eventId);
    });
    return run;
  }

  private async transact<T>(eventId: string, fn: (tx: EventTx) => Promise<T>): Promise<T> {
    const ref = this.event(eventId);
    return this.db.runTransaction(
      async (t) => {
        const tx = new FirestoreTx(t, ref);
        const result = await fn(tx);
        tx.flush();
        return result;
      },
      { maxAttempts: 10 },
    );
  }

  async createEvent(b: NewEventBundle): Promise<boolean> {
    const slugRef = this.db.collection('slugs').doc(b.event.publicSlug);
    const ref = this.event(b.event.id);
    return this.db.runTransaction(async (t) => {
      if ((await t.get(slugRef)).exists) return false;
      t.set(slugRef, { eventId: b.event.id });
      t.set(ref, b.event);
      for (const p of b.participants ?? []) t.set(ref.collection('participants').doc(p.id), p);
      for (const r of b.requests ?? []) t.set(ref.collection('requests').doc(r.id), r);
      for (const k of b.recordingKeys ?? [])
        t.set(ref.collection('recordingKeys').doc(hashId(k.key)), k);
      for (const g of b.adminGrants) t.set(ref.collection('adminGrants').doc(g.id), g);
      return true;
    });
  }

  async findEventBySlug(slug: string): Promise<EventDoc | null> {
    const s = await this.db.collection('slugs').doc(slug).get();
    if (!s.exists) return null;
    const e = await this.event((s.data() as { eventId: string }).eventId).get();
    return e.exists ? (e.data() as EventDoc) : null;
  }

  async getEventPublic(eventId: string): Promise<EventAggregate | null> {
    const ref = this.event(eventId);
    const [e, reqs, parts] = await Promise.all([
      ref.get(),
      ref.collection('requests').get(),
      ref.collection('participants').get(),
    ]);
    if (!e.exists) return null;
    return {
      event: e.data() as EventDoc,
      requests: reqs.docs.map((d) => d.data() as RequestDoc).sort(bySeq),
      nicknames: Object.fromEntries(
        parts.docs.map((d) => {
          const p = d.data() as ParticipantDoc;
          return [p.id, p.nickname];
        }),
      ),
    };
  }

  subscribe(eventId: string, cb: (event: EventDoc) => void): () => void {
    return this.event(eventId).onSnapshot((snap) => {
      if (snap.exists) cb(snap.data() as EventDoc);
    });
  }

  async listAudit(eventId: string): Promise<AuditDoc[]> {
    const snap = await this.event(eventId).collection('audit').get();
    return snap.docs.map((d) => d.data() as AuditDoc).sort((a, b) => a.at - b.at);
  }

  async updateNameLedger<T>(fn: (l: NameLedger) => { ledger: NameLedger; result: T }): Promise<T> {
    const ref = this.db.collection('meta').doc('eventNames');
    return this.db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const current = snap.exists
        ? (snap.data() as NameLedger)
        : structuredClone(EMPTY_NAME_LEDGER);
      const { ledger, result } = fn(current);
      t.set(ref, ledger);
      return result;
    });
  }

  async getYouTubeMatch(spotifyId: string): Promise<YouTubeMatchDoc | null> {
    const snap = await this.db.collection('ytMatch').doc(spotifyId).get();
    return snap.exists ? (snap.data() as YouTubeMatchDoc) : null;
  }

  async putYouTubeMatch(spotifyId: string, match: YouTubeMatchDoc): Promise<void> {
    await this.db.collection('ytMatch').doc(spotifyId).set(match);
  }

  async purge(c: PurgeCutoffs): Promise<PurgeReport> {
    const r: PurgeReport = {
      draftsDeleted: 0,
      participantsDeleted: 0,
      auditDeleted: 0,
      idempotencyDeleted: 0,
    };
    const events = await this.db
      .collection('events')
      .select('state', 'createdAt', 'endedAt', 'publicSlug')
      .get();
    for (const doc of events.docs) {
      const e = doc.data() as Pick<EventDoc, 'state' | 'createdAt' | 'endedAt' | 'publicSlug'>;
      const ref = doc.ref;
      if (e.state === 'DRAFT' && e.createdAt < c.draftsBefore) {
        await this.db.recursiveDelete(ref);
        await this.db.collection('slugs').doc(e.publicSlug).delete();
        r.draftsDeleted++;
        continue;
      }
      if (e.endedAt !== null && e.endedAt < c.participantsEndedBefore) {
        r.participantsDeleted += await this.deleteAll(ref.collection('participants'));
      }
      r.auditDeleted += await this.deleteAll(
        ref.collection('audit').where('at', '<', c.auditBefore),
      );
      r.idempotencyDeleted += await this.deleteAll(
        ref.collection('idempotency').where('at', '<', c.idempotencyBefore),
      );
    }
    return r;
  }

  private async deleteAll(q: Query): Promise<number> {
    let n = 0;
    for (;;) {
      const snap = await q.limit(400).get();
      if (snap.empty) return n;
      const batch = this.db.batch();
      for (const d of snap.docs) batch.delete(d.ref);
      await batch.commit();
      n += snap.size;
    }
  }

  async close(): Promise<void> {
    await this.db.terminate();
  }
}

class FirestoreTx implements EventTx {
  private readonly writes: Array<() => void> = [];

  constructor(
    private readonly t: Transaction,
    private readonly ref: DocumentReference,
  ) {}

  flush() {
    for (const w of this.writes) w();
  }

  private guard() {
    if (this.writes.length > 0) throw new Error('Transaction read after write: do all reads first');
  }

  private async get<T>(ref: DocumentReference): Promise<T | null> {
    this.guard();
    const s = await this.t.get(ref);
    return s.exists ? (s.data() as T) : null;
  }

  private put(ref: DocumentReference, data: object) {
    this.writes.push(() => void this.t.set(ref, data));
  }

  private col(name: string) {
    return this.ref.collection(name);
  }

  getEvent() {
    return this.get<EventDoc>(this.ref);
  }
  putEvent(doc: EventDoc, opts?: { silent?: boolean }) {
    const version = doc.version + (opts?.silent ? 0 : 1);
    this.put(this.ref, { ...doc, version });
    return version;
  }

  getParticipant(id: string) {
    return this.get<ParticipantDoc>(this.col('participants').doc(id));
  }
  putParticipant(p: ParticipantDoc) {
    this.put(this.col('participants').doc(p.id), p);
  }

  getRequest(id: string) {
    return this.get<RequestDoc>(this.col('requests').doc(id));
  }
  putRequest(r: RequestDoc) {
    this.put(this.col('requests').doc(r.id), r);
  }
  async listRequests(filter: RequestFilter = {}) {
    this.guard();
    let q: Query = this.col('requests');
    if (filter.ownerId !== undefined) q = q.where('ownerId', '==', filter.ownerId);
    if (filter.states !== undefined) {
      if (filter.states.length === 0) return [];
      // Firestore `in` allows 30 values; there are 11 states.
      q = q.where('state', 'in', [...filter.states]);
    }
    const snap = await this.t.get(q);
    return snap.docs.map((d) => d.data() as RequestDoc).sort(bySeq);
  }

  getRecordingKey(key: string) {
    return this.get<RecordingKeyDoc>(this.col('recordingKeys').doc(hashId(key)));
  }
  putRecordingKey(k: RecordingKeyDoc) {
    this.put(this.col('recordingKeys').doc(hashId(k.key)), k);
  }

  getPlayback(seq: number) {
    return this.get<PlaybackDoc>(this.col('playback').doc(String(seq)));
  }
  putPlayback(p: PlaybackDoc) {
    this.put(this.col('playback').doc(String(p.seq)), p);
  }

  appendAudit(a: AuditDoc) {
    this.put(this.col('audit').doc(), a);
  }

  getIdempotency(key: string) {
    return this.get<IdempotencyDoc>(this.col('idempotency').doc(hashId(key)));
  }
  putIdempotency(i: IdempotencyDoc) {
    this.put(this.col('idempotency').doc(hashId(i.key)), i);
  }

  getAdminGrant(id: string) {
    return this.get<AdminGrantDoc>(this.col('adminGrants').doc(id));
  }
  async listAdminGrants() {
    this.guard();
    const snap = await this.t.get(this.col('adminGrants'));
    return snap.docs.map((d) => d.data() as AdminGrantDoc);
  }
  putAdminGrant(g: AdminGrantDoc) {
    this.put(this.col('adminGrants').doc(g.id), g);
  }

  getHandoverOffer(id: string) {
    return this.get<HandoverOfferDoc>(this.col('handoverOffers').doc(id));
  }
  putHandoverOffer(o: HandoverOfferDoc) {
    this.put(this.col('handoverOffers').doc(o.id), o);
  }
}
