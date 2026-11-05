import type {
  BreakSpec,
  EventState,
  PlaybackOutcome,
  Preview,
  Provider,
  RequestState,
  RulesSnapshot,
  StyleId,
} from '@qroove/contracts';

/** Scheduler history in storable form (`playedKeys` is a Set inside the scheduler). */
export interface HistoryDoc {
  lastStyle: string | null;
  runLength: number;
  transitionCount: number;
  playedKeys: string[];
}

export interface LeaseDoc {
  controllerHash: string;
  epoch: number;
  claimedAt: number;
  heartbeatAt: number;
  expiresAt: number;
}

/** Aggregate root: every command reads this first and bumps `version`. All times are epoch ms. */
export interface EventDoc {
  id: string;
  name: string;
  publicSlug: string;
  state: EventState;
  timezone: string;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
  endAt: number | null;
  /** Planned time in minutes (oven-timer style); `endAt` is derived from it when the event starts. */
  plannedDurationMin: number | null;
  breaks: BreakSpec[];
  rules: RulesSnapshot;
  rulesHash: string | null;
  version: number;
  acceptedSeq: number;
  playbackSeq: number;
  /** Monotonic fencing counter; never reset when a lease is released. */
  leaseEpoch: number;
  history: HistoryDoc;
  reservation: { requestId: string; reservedAt: number; leaseEpoch: number } | null;
  nowPlaying: {
    requestId: string;
    startedAt: number;
    durationMs: number | null;
    playbackSeq: number;
  } | null;
  lease: LeaseDoc | null;
  waitingReason: string | null;
  preview: Preview;
  adminGrantVersion: number;
  /** The single outstanding handover offer while TRANSFERRING. */
  transferOfferId: string | null;
  importSeed: number | null;
}

export interface ParticipantDoc {
  id: string;
  tokenHash: string;
  nickname: string | null;
  joinedAt: number;
  lastSeenAt: number;
  acceptedCount: number;
}

export interface RequestDoc {
  id: string;
  ownerId: string;
  state: RequestState;
  title: string;
  artist: string | null;
  style: StyleId;
  provider: Provider;
  canonicalKey: string;
  sourceUrl: string | null;
  durationMs: number | null;
  artworkUrl: string | null;
  /** False while metadata is pending or when no playable source exists. */
  playable: boolean;
  /** Every exact recording key this request claims (canonical first). */
  keys: string[];
  /** Version-insensitive key; a collision with another request means human review. */
  looseKey: string | null;
  /** Held for admin review because it may be the same recording as an earlier request. */
  possibleDuplicate: boolean;
  acceptedSeq: number;
  createdAt: number;
  updatedAt: number;
  removedReason: string | null;
}

export interface RecordingKeyDoc {
  key: string;
  requestId: string;
  /** `released` keys (withdrawn/rejected before playing) can be requested again. */
  state: 'active' | 'consumed' | 'released';
}

export interface PlaybackDoc {
  seq: number;
  requestId: string;
  ownerId: string;
  style: StyleId;
  startedAt: number;
  endedAt: number | null;
  outcome: PlaybackOutcome | null;
}

export interface AdminGrantDoc {
  /** sha256 of the secret — the secret itself is never stored. */
  id: string;
  role: 'admin' | 'recovery';
  issuedAt: number;
  revokedAt: number | null;
}

export interface HandoverOfferDoc {
  /** sha256 of the one-time code. */
  id: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface AuditDoc {
  action: string;
  actorRole: 'admin' | 'recovery' | 'participant' | 'player' | 'system';
  at: number;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
}

export interface IdempotencyDoc {
  key: string;
  response: unknown;
  at: number;
}

export interface RequestFilter {
  ownerId?: string;
  states?: readonly RequestState[];
}

/** Everything a read model needs, without tokens. */
export interface EventAggregate {
  event: EventDoc;
  requests: RequestDoc[];
  nicknames: Record<string, string | null>;
}

export interface NewEventBundle {
  event: EventDoc;
  adminGrants: AdminGrantDoc[];
  participants?: ParticipantDoc[];
  requests?: RequestDoc[];
  recordingKeys?: RecordingKeyDoc[];
}

/** Absolute cut-offs (epoch ms) computed by the caller, so adapters never read the clock. */
export interface PurgeCutoffs {
  /** DRAFT events created before this are deleted entirely. */
  draftsBefore: number;
  /** For events that ended before this, participants (token hashes, nicknames) are deleted. */
  participantsEndedBefore: number;
  auditBefore: number;
  idempotencyBefore: number;
}

export interface PurgeReport {
  draftsDeleted: number;
  participantsDeleted: number;
  auditDeleted: number;
  idempotencyDeleted: number;
}

/**
 * Global record of generated event names. `used` holds the ordered word triples already handed
 * out this cycle (encoded as indices into the word list); `last` is the most recent name's words.
 */
export interface NameLedger {
  used: number[];
  last: string[] | null;
  /** How many times every permutation has been exhausted. */
  cycle: number;
}

/** A cached Spotify-song to YouTube-video match. An empty list records "looked, found nothing". */
export interface YouTubeMatchDoc {
  videoIds: string[];
  checkedAt: number;
}

export const EMPTY_NAME_LEDGER: NameLedger = { used: [], last: null, cycle: 0 };
