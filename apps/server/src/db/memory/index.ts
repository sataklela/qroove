import type { YouTubeMatchDoc } from '../types.js';
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

interface Store {
  event: EventDoc;
  participants: Map<string, ParticipantDoc>;
  requests: Map<string, RequestDoc>;
  recordingKeys: Map<string, RecordingKeyDoc>;
  playback: Map<number, PlaybackDoc>;
  grants: Map<string, AdminGrantDoc>;
  offers: Map<string, HandoverOfferDoc>;
  audit: AuditDoc[];
  idempotency: Map<string, IdempotencyDoc>;
}

const clone = <T>(v: T): T => structuredClone(v);
const bySeq = (a: RequestDoc, b: RequestDoc) =>
  a.acceptedSeq - b.acceptedSeq || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export class MemoryRepository implements Repository {
  private readonly stores = new Map<string, Store>();
  private readonly slugs = new Map<string, string>();
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly subs = new Map<string, Set<(e: EventDoc) => void>>();

  async runInTransaction<T>(eventId: string, fn: (tx: EventTx) => Promise<T>): Promise<T> {
    const prev = this.tails.get(eventId) ?? Promise.resolve();
    const run = prev.then(async () => {
      const tx = new MemoryTx(this.stores.get(eventId) ?? null);
      const result = await fn(tx);
      tx.commit();
      if (tx.eventWritten) this.notify(eventId);
      return result;
    });
    this.tails.set(
      eventId,
      run.catch(() => undefined),
    );
    return run;
  }

  async createEvent(b: NewEventBundle): Promise<boolean> {
    const slug = b.event.publicSlug;
    if (this.slugs.has(slug)) return false;
    this.slugs.set(slug, b.event.id);
    this.stores.set(b.event.id, {
      event: clone(b.event),
      participants: new Map((b.participants ?? []).map((p) => [p.id, clone(p)])),
      requests: new Map((b.requests ?? []).map((r) => [r.id, clone(r)])),
      recordingKeys: new Map((b.recordingKeys ?? []).map((k) => [k.key, clone(k)])),
      playback: new Map(),
      grants: new Map(b.adminGrants.map((g) => [g.id, clone(g)])),
      offers: new Map(),
      audit: [],
      idempotency: new Map(),
    });
    return true;
  }

  async findEventBySlug(slug: string): Promise<EventDoc | null> {
    const id = this.slugs.get(slug);
    const s = id ? this.stores.get(id) : undefined;
    return s ? clone(s.event) : null;
  }

  async getEventPublic(eventId: string): Promise<EventAggregate | null> {
    const s = this.stores.get(eventId);
    if (!s) return null;
    return {
      event: clone(s.event),
      requests: [...s.requests.values()].sort(bySeq).map(clone),
      nicknames: Object.fromEntries([...s.participants.values()].map((p) => [p.id, p.nickname])),
    };
  }

  subscribe(eventId: string, cb: (event: EventDoc) => void): () => void {
    const set = this.subs.get(eventId) ?? new Set();
    set.add(cb);
    this.subs.set(eventId, set);
    return () => set.delete(cb);
  }

  async listAudit(eventId: string): Promise<AuditDoc[]> {
    return clone(this.stores.get(eventId)?.audit ?? []);
  }

  private matches = new Map<string, YouTubeMatchDoc>();

  async getYouTubeMatch(spotifyId: string): Promise<YouTubeMatchDoc | null> {
    const m = this.matches.get(spotifyId);
    return m ? clone(m) : null;
  }

  async putYouTubeMatch(spotifyId: string, match: YouTubeMatchDoc): Promise<void> {
    this.matches.set(spotifyId, clone(match));
  }

  private ledger: NameLedger = structuredClone(EMPTY_NAME_LEDGER);

  async updateNameLedger<T>(fn: (l: NameLedger) => { ledger: NameLedger; result: T }): Promise<T> {
    const { ledger, result } = fn(clone(this.ledger));
    this.ledger = clone(ledger);
    return result;
  }

  async purge(c: PurgeCutoffs): Promise<PurgeReport> {
    const r: PurgeReport = {
      draftsDeleted: 0,
      participantsDeleted: 0,
      auditDeleted: 0,
      idempotencyDeleted: 0,
    };
    for (const [id, s] of [...this.stores]) {
      const e = s.event;
      if (e.state === 'DRAFT' && e.createdAt < c.draftsBefore) {
        this.stores.delete(id);
        this.slugs.delete(e.publicSlug);
        this.subs.delete(id);
        r.draftsDeleted++;
        continue;
      }
      if (e.endedAt !== null && e.endedAt < c.participantsEndedBefore) {
        r.participantsDeleted += s.participants.size;
        s.participants.clear();
      }
      const audit = s.audit.filter((a) => a.at >= c.auditBefore);
      r.auditDeleted += s.audit.length - audit.length;
      s.audit = audit;
      for (const [k, i] of s.idempotency) {
        if (i.at < c.idempotencyBefore) {
          s.idempotency.delete(k);
          r.idempotencyDeleted++;
        }
      }
    }
    return r;
  }

  async close(): Promise<void> {}

  private notify(eventId: string) {
    const s = this.stores.get(eventId);
    if (!s) return;
    for (const cb of this.subs.get(eventId) ?? []) cb(clone(s.event));
  }
}

class MemoryTx implements EventTx {
  private readonly ops: Array<(s: Store) => void> = [];
  private wrote = false;
  eventWritten = false;

  constructor(private readonly store: Store | null) {}

  commit() {
    if (this.ops.length === 0) return;
    // Memory adapter has no failure mode after the callback; ops apply as one synchronous step.
    for (const op of this.ops) op(this.store!);
  }

  private read<T>(f: (s: Store) => T | undefined): T | null {
    if (this.wrote) throw new Error('Transaction read after write: do all reads first');
    const v = this.store ? f(this.store) : undefined;
    return v === undefined ? null : clone(v);
  }

  private write(op: (s: Store) => void) {
    if (!this.store) throw new Error('Event does not exist');
    this.wrote = true;
    this.ops.push(op);
  }

  async getEvent() {
    return this.read((s) => s.event);
  }
  putEvent(doc: EventDoc, opts?: { silent?: boolean }) {
    const version = doc.version + (opts?.silent ? 0 : 1);
    const next = { ...clone(doc), version };
    this.eventWritten = true;
    this.write((s) => {
      s.event = next;
    });
    return version;
  }

  async getParticipant(id: string) {
    return this.read((s) => s.participants.get(id));
  }
  putParticipant(p: ParticipantDoc) {
    const c = clone(p);
    this.write((s) => void s.participants.set(c.id, c));
  }

  async getRequest(id: string) {
    return this.read((s) => s.requests.get(id));
  }
  putRequest(r: RequestDoc) {
    const c = clone(r);
    this.write((s) => void s.requests.set(c.id, c));
  }
  async listRequests(filter: RequestFilter = {}) {
    return (
      this.read((s) =>
        [...s.requests.values()]
          .filter(
            (r) =>
              (filter.ownerId === undefined || r.ownerId === filter.ownerId) &&
              (filter.states === undefined || filter.states.includes(r.state)),
          )
          .sort(bySeq),
      ) ?? []
    );
  }

  async getRecordingKey(key: string) {
    return this.read((s) => s.recordingKeys.get(key));
  }
  putRecordingKey(k: RecordingKeyDoc) {
    const c = clone(k);
    this.write((s) => void s.recordingKeys.set(c.key, c));
  }

  async getPlayback(seq: number) {
    return this.read((s) => s.playback.get(seq));
  }
  putPlayback(p: PlaybackDoc) {
    const c = clone(p);
    this.write((s) => void s.playback.set(c.seq, c));
  }

  appendAudit(a: AuditDoc) {
    const c = clone(a);
    this.write((s) => void s.audit.push(c));
  }

  async getIdempotency(key: string) {
    return this.read((s) => s.idempotency.get(key));
  }
  putIdempotency(i: IdempotencyDoc) {
    const c = clone(i);
    this.write((s) => void s.idempotency.set(c.key, c));
  }

  async getAdminGrant(id: string) {
    return this.read((s) => s.grants.get(id));
  }
  async listAdminGrants() {
    return this.read((s) => [...s.grants.values()]) ?? [];
  }
  putAdminGrant(g: AdminGrantDoc) {
    const c = clone(g);
    this.write((s) => void s.grants.set(c.id, c));
  }

  async getHandoverOffer(id: string) {
    return this.read((s) => s.offers.get(id));
  }
  putHandoverOffer(o: HandoverOfferDoc) {
    const c = clone(o);
    this.write((s) => void s.offers.set(c.id, c));
  }
}
