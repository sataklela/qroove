import { z } from 'zod';
import { RulesSnapshot, StyleId } from './rules.js';

export const EventState = z.enum([
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'TRANSFERRING',
  'ENDED',
  'ARCHIVED',
]);
export type EventState = z.infer<typeof EventState>;

export const RequestState = z.enum([
  'PENDING_METADATA',
  'QUEUED',
  'INELIGIBLE_TEMPORARILY',
  'RESERVED_NEXT',
  'PLAYING',
  'PLAYED',
  'SKIPPED',
  'WITHDRAWN',
  'REJECTED',
  'UNAVAILABLE',
  'OVERFLOW',
]);
export type RequestState = z.infer<typeof RequestState>;

export const BreakSpec = z.object({
  id: z.string(),
  label: z.string().max(60),
  durationSec: z.number().int().min(1).max(3600),
  /** Offset from the start of the event, a multiple of 10 minutes. */
  startMin: z.number().int().min(0).max(480),
  startsAt: z.number().int().nullable(),
  actualStart: z.number().int().nullable(),
  actualEnd: z.number().int().nullable(),
});
export type BreakSpec = z.infer<typeof BreakSpec>;

export const PreviewItem = z.object({
  requestId: z.string(),
  position: z.number().int().min(1),
  predictedStartMs: z.number().int().nullable(),
  uncertain: z.boolean(),
  overflow: z.boolean(),
});
export type PreviewItem = z.infer<typeof PreviewItem>;

export const StoppedReason = z.enum(['EXHAUSTED', 'WAITING_FAIRNESS', 'HORIZON']);

export const Preview = z.object({
  revision: z.number().int(),
  items: z.array(PreviewItem),
  stoppedReason: StoppedReason,
  computedAt: z.number().int(),
});
export type Preview = z.infer<typeof Preview>;

export const TrackView = z.object({
  requestId: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  style: StyleId,
  durationMs: z.number().int().nullable(),
  artworkUrl: z.string().nullable(),
  /** Display-only nickname; never an identifier. */
  ownerNickname: z.string().nullable(),
});
export type TrackView = z.infer<typeof TrackView>;

export const NowPlaying = z.object({ track: TrackView, startedAt: z.number().int() });

/** Radio fallback in the public view (ADR 0023): which station is on, never a URL. */
export const RadioView = z.object({
  stationName: z.string(),
  genre: z.string(),
  title: z.string().nullable(),
  startedAt: z.number().int(),
});
export type RadioView = z.infer<typeof RadioView>;

/** `GET /api/events/:slug/public` — sanitised, no tokens or participant ids. */
export const EventPublicView = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  state: EventState,
  timezone: z.string(),
  endAt: z.number().int().nullable(),
  serverNow: z.number().int(),
  version: z.number().int(),
  rules: RulesSnapshot.nullable(),
  nowPlaying: NowPlaying.nullable(),
  /** The organiser's radio fallback switch, and the radio track on air, if any. */
  radioFallback: z.boolean(),
  radio: RadioView.nullable(),
  /** Radio waits for a first guest song until this time (ms), when nothing has played yet. */
  radioHoldUntil: z.number().int().nullable(),
  waitingReason: z.string().nullable(),
  /** Current run of one style against its cap, so attendees can see why a style may be held. */
  runIndicator: z
    .object({ style: StyleId, runLength: z.number().int(), cap: z.number().int() })
    .nullable(),
  breaks: z.array(BreakSpec),
  preview: Preview,
  queue: z.array(TrackView.extend({ position: z.number().int(), overflow: z.boolean() })),
});
export type EventPublicView = z.infer<typeof EventPublicView>;
