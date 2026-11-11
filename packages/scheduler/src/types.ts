/** Style identifiers are opaque strings here so the scheduler stays dependency-free. */
export type StyleId = string;

export interface Candidate {
  requestId: string;
  ownerId: string;
  /** What the scheduler counts runs and changes by: the genre. */
  style: StyleId;
  /** The exact style (e.g. a non-Latin variant), when the rules allow only some variants of a genre. */
  variant?: string;
  acceptedSeq: number;
  canonicalKey: string;
  durationMs: number | null;
  playable: boolean;
  /** Lower plays first within a genre's turn: 0 (default) for requests, 1 for filler songs. */
  priority?: number;
}

export interface HistoryState {
  lastStyle: StyleId | null;
  runLength: number;
  transitionCount: number;
  playedKeys: ReadonlySet<string>;
}

/** The subset of the frozen rules snapshot the scheduler needs. */
export interface SchedulerRules {
  enabledStyles: readonly StyleId[];
  /** Exact styles allowed; when set, a candidate with a `variant` outside it is not eligible. */
  allowedVariants?: readonly string[];
  runCaps: Readonly<Record<StyleId, number>>;
}

export type Ineligibility =
  'RUN_CAP' | 'ALREADY_PLAYED' | 'STYLE_DISABLED' | 'NOT_PLAYABLE' | 'WOULD_EXCEED_END';

export type Eligibility = { ok: true } | { ok: false; reason: Ineligibility };

export interface EligibilityContext {
  /** Playable window left (ms) when a fixed end time is enforced; null/absent = unbounded. */
  remainingMs?: number | null;
  /** Recordings still waiting in the pool; a gated song that left the pool (withdrawn) stops blocking. */
  poolKeys?: ReadonlySet<string>;
}

/** Duration assumed (and flagged uncertain) when a recording's length is unknown. */
export const DEFAULT_DURATION_MS = 4 * 60 * 1000;

/** Run cap used for a style with no configured cap (conservative). */
export const FALLBACK_RUN_CAP = 1;

export const EMPTY_HISTORY: HistoryState = {
  lastStyle: null,
  runLength: 0,
  transitionCount: 0,
  playedKeys: new Set(),
};
