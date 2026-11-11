import {
  DEFAULT_ENABLED_STYLES,
  RULE_DEFAULTS,
  formatRoomCode,
  type GenreId,
} from '@qroove/config';
import {
  DomainError,
  RulesSnapshot,
  defaultRules,
  defaultSegment,
  validateBreaks,
  type BreakSpec,
  type SegmentInput,
  type StyleId,
} from '@qroove/contracts';
import { SYSTEM_SEED_ID } from '../db/types.js';
import type {
  AdminGrantDoc,
  EventDoc,
  NewEventBundle,
  ParticipantDoc,
  RecordingKeyDoc,
  RequestDoc,
} from '../db/types.js';
import type { Deps } from './context.js';
import { EMPTY_HISTORY_DOC } from './history.js';
import { sha256 } from './ids.js';
import { manualKey } from './keys.js';

export interface RuleInput {
  /** Defaults for every segment that is not given explicitly. */
  enabledStyles?: readonly StyleId[] | undefined;
  /** "Most songs in a row" for every genre, unless `ratio` overrides a genre. */
  masterRunCap?: number | undefined;
  /** Per-genre ratio parts (keys are genre ids). */
  ratio?: Partial<Record<StyleId, number>> | undefined;
  /** One per stretch between breaks. */
  segments?: ReadonlyArray<SegmentInput> | undefined;
  submissionLimit?: number | undefined;
}

/**
 * Builds and validates a rules snapshot with one segment per stretch between breaks: explicit
 * segments first, then the event-level defaults, then `base`'s segment, then global defaults.
 */
export function buildRules(
  input: RuleInput,
  segmentCount: number,
  base?: RulesSnapshot,
): RulesSnapshot {
  if (input.segments && input.segments.length !== segmentCount) {
    throw new DomainError('VALIDATION', 'Choose styles for each part of the evening.');
  }
  const hasDefaults =
    input.enabledStyles !== undefined ||
    input.masterRunCap !== undefined ||
    input.ratio !== undefined;
  const enabled = input.enabledStyles ?? base?.segments[0]?.enabledStyles ?? DEFAULT_ENABLED_STYLES;
  const master =
    input.masterRunCap ?? base?.segments[0]?.masterRunCap ?? RULE_DEFAULTS.masterRunCap;
  const segments = Array.from({ length: segmentCount }, (_, i) => {
    const given = input.segments?.[i];
    if (given) {
      return defaultSegment(
        given.enabledStyles,
        given.masterRunCap ?? master,
        (given.ratio ?? {}) as Partial<Record<GenreId, number>>,
      );
    }
    const kept = base?.segments[i];
    if (kept && !hasDefaults) return kept;
    return defaultSegment(enabled, master, (input.ratio ?? {}) as Partial<Record<GenreId, number>>);
  });
  const rules: RulesSnapshot = {
    ...defaultRules(),
    segments,
    submissionLimit:
      input.submissionLimit ?? base?.submissionLimit ?? RULE_DEFAULTS.submissionLimit,
  };
  const parsed = RulesSnapshot.safeParse(rules);
  if (!parsed.success) throw new DomainError('VALIDATION', parsed.error.issues[0]?.message);
  return parsed.data;
}

export interface BreakInput {
  label?: string | undefined;
  /** Offset from the start of the event, minutes, a multiple of 10. */
  startMin: number;
  durationSec: number;
}

/** Validates against the planned time (hard limits) and creates the break specs, in time order. */
export function buildBreaks(
  deps: Deps,
  breaks: ReadonlyArray<BreakInput> = [],
  plannedMin: number | null = null,
): BreakSpec[] {
  const problem = validateBreaks(
    plannedMin,
    breaks.map((b) => ({ startMin: b.startMin, durationMin: b.durationSec / 60 })),
  );
  if (problem) throw new DomainError('VALIDATION', problem);
  return [...breaks]
    .sort((a, b) => a.startMin - b.startMin)
    .map((b) => ({
      id: deps.ids.breakId(),
      label: b.label ?? `${Math.round(b.durationSec / 60)}-minute break`,
      durationSec: b.durationSec,
      startMin: b.startMin,
      startsAt: null,
      actualStart: null,
      actualEnd: null,
    }));
}

export interface DraftInput {
  /** Absent: the event is known by its room code alone (ADR 0026). */
  name?: string;
  timezone: string;
  rules: RulesSnapshot;
  plannedDurationMin: number | null;
  breaks: BreakSpec[];
  importSeed?: number | null;
}

export interface DraftSecrets {
  adminSecret: string;
  recoverySecret: string;
}

export function newDraft(
  deps: Deps,
  input: DraftInput,
): {
  event: EventDoc;
  adminGrants: AdminGrantDoc[];
  secrets: DraftSecrets;
} {
  const now = deps.clock.now();
  const secrets = { adminSecret: deps.ids.secret(), recoverySecret: deps.ids.secret() };
  const slug = deps.ids.slug();
  const event: EventDoc = {
    id: deps.ids.eventId(),
    name: input.name ?? formatRoomCode(slug),
    publicSlug: slug,
    state: 'DRAFT',
    timezone: input.timezone,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    endAt: null,
    plannedDurationMin: input.plannedDurationMin,
    breaks: input.breaks,
    rules: input.rules,
    rulesHash: null,
    version: 1,
    acceptedSeq: 0,
    playbackSeq: 0,
    leaseEpoch: 0,
    history: structuredClone(EMPTY_HISTORY_DOC),
    reservation: null,
    nowPlaying: null,
    lease: null,
    waitingReason: null,
    preview: { revision: 1, items: [], stoppedReason: 'EXHAUSTED', computedAt: now },
    adminGrantVersion: 1,
    transferOfferId: null,
    importSeed: input.importSeed ?? null,
  };
  const grant = (secret: string, role: AdminGrantDoc['role']): AdminGrantDoc => ({
    id: sha256(secret),
    role,
    issuedAt: now,
    revokedAt: null,
  });
  return {
    event,
    adminGrants: [grant(secrets.adminSecret, 'admin'), grant(secrets.recoverySecret, 'recovery')],
    secrets,
  };
}

/** Inserts a draft, regenerating the slug on the (rare) collision. */
export async function insertDraft(
  deps: Deps,
  make: () => NewEventBundle & { secrets: DraftSecrets },
): Promise<{ bundle: NewEventBundle; secrets: DraftSecrets }> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const { secrets, ...bundle } = make();
    if (await deps.repo.createEvent(bundle)) return { bundle, secrets };
  }
  throw new Error('Could not allocate a unique event slug');
}

export interface SeedSong {
  title: string;
  artist: string | null;
  style: StyleId;
  durationMs: number | null;
  sourceUrl: string | null;
}

export { SYSTEM_SEED_ID };
export const MAX_SEEDS = 150;

/** Pre-queued songs (imported playlists, carry-over) belong to one synthetic participant. */
export function seedRows(deps: Deps, event: EventDoc, songs: readonly SeedSong[]) {
  const now = event.createdAt;
  const requests: RequestDoc[] = songs.map((s, i) => ({
    id: deps.ids.requestId(),
    ownerId: SYSTEM_SEED_ID,
    state: 'QUEUED',
    title: s.title,
    artist: s.artist,
    style: s.style,
    provider: 'manual',
    canonicalKey: manualKey(s.title, s.artist),
    keys: [manualKey(s.title, s.artist)],
    looseKey: null,
    possibleDuplicate: false,
    sourceUrl: s.sourceUrl,
    durationMs: s.durationMs,
    artworkUrl: null,
    playable: true,
    acceptedSeq: i + 1,
    createdAt: now,
    updatedAt: now,
    removedReason: null,
  }));
  event.acceptedSeq = requests.length;
  const participants: ParticipantDoc[] = [
    {
      id: SYSTEM_SEED_ID,
      tokenHash: '',
      nickname: null,
      joinedAt: now,
      lastSeenAt: now,
      acceptedCount: requests.length,
    },
  ];
  const recordingKeys: RecordingKeyDoc[] = requests.map((q) => ({
    key: q.canonicalKey,
    requestId: q.id,
    state: 'active',
  }));
  return { participants, requests, recordingKeys };
}
