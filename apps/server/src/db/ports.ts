import type {
  AdminGrantDoc,
  AuditDoc,
  EventAggregate,
  EventDoc,
  HandoverOfferDoc,
  IdempotencyDoc,
  YouTubeMatchDoc,
  NewEventBundle,
  PurgeCutoffs,
  PurgeReport,
  ParticipantDoc,
  PlaybackDoc,
  RecordingKeyDoc,
  RequestDoc,
  RequestFilter,
} from './types.js';

/**
 * One serialisable transaction scoped to a single event.
 *
 * Contract (identical in every adapter): all reads must happen before the first write. Writes are
 * buffered and flushed when the callback resolves; a read after a write throws.
 */
export interface EventTx {
  getEvent(): Promise<EventDoc | null>;
  /** Stores the doc with `version = doc.version + 1` (or unchanged when `silent`); returns it. */
  putEvent(doc: EventDoc, opts?: { silent?: boolean }): number;

  getParticipant(id: string): Promise<ParticipantDoc | null>;
  putParticipant(p: ParticipantDoc): void;

  getRequest(id: string): Promise<RequestDoc | null>;
  putRequest(r: RequestDoc): void;
  /** Results are ordered by `acceptedSeq`, then id. */
  listRequests(filter?: RequestFilter): Promise<RequestDoc[]>;

  getRecordingKey(key: string): Promise<RecordingKeyDoc | null>;
  putRecordingKey(k: RecordingKeyDoc): void;

  getPlayback(seq: number): Promise<PlaybackDoc | null>;
  putPlayback(p: PlaybackDoc): void;

  appendAudit(a: AuditDoc): void;

  getIdempotency(key: string): Promise<IdempotencyDoc | null>;
  putIdempotency(i: IdempotencyDoc): void;

  getAdminGrant(id: string): Promise<AdminGrantDoc | null>;
  listAdminGrants(): Promise<AdminGrantDoc[]>;
  putAdminGrant(g: AdminGrantDoc): void;

  getHandoverOffer(id: string): Promise<HandoverOfferDoc | null>;
  putHandoverOffer(o: HandoverOfferDoc): void;
}

export interface Repository {
  runInTransaction<T>(eventId: string, fn: (tx: EventTx) => Promise<T>): Promise<T>;
  /** Atomically claims the slug and writes the bundle. Returns false when the slug is taken. */
  createEvent(bundle: NewEventBundle): Promise<boolean>;
  findEventBySlug(slug: string): Promise<EventDoc | null>;
  /** Non-transactional read for read models (public view, export, carry-over). */
  getEventPublic(eventId: string): Promise<EventAggregate | null>;
  /** Called after each committed change to the event doc. */
  subscribe(eventId: string, cb: (event: EventDoc) => void): () => void;
  /** Match cache keyed by the Spotify track id; shared by all events. */
  getYouTubeMatch(spotifyId: string): Promise<YouTubeMatchDoc | null>;
  putYouTubeMatch(spotifyId: string, match: YouTubeMatchDoc): Promise<void>;
  /** Retention: removes expired data across all events. Safe to run repeatedly. */
  purge(cutoffs: PurgeCutoffs): Promise<PurgeReport>;
  close(): Promise<void>;
  /** Audit trail, for tests and the runbook. */
  listAudit(eventId: string): Promise<AuditDoc[]>;
}
