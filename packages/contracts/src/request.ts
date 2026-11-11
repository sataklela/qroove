import { z } from 'zod';
import { RequestState } from './event.js';
import { StyleId } from './rules.js';

export const Provider = z.enum(['spotify', 'youtube', 'apple', 'manual']);
export type Provider = z.infer<typeof Provider>;

export const RequestView = z.object({
  id: z.string(),
  state: RequestState,
  title: z.string(),
  artist: z.string().nullable(),
  style: StyleId,
  provider: Provider,
  durationMs: z.number().int().nullable(),
  artworkUrl: z.string().nullable(),
  acceptedSeq: z.number().int(),
  position: z.number().int().nullable(),
  predictedStartMs: z.number().int().nullable(),
  uncertain: z.boolean(),
  /** Why the song is not currently reachable, in attendee-facing words. */
  statusText: z.string().nullable(),
});
export type RequestView = z.infer<typeof RequestView>;

export const MyRequests = z.object({
  /** The person's codename at this event. */
  nickname: z.string().nullable(),
  accepted: z.number().int(),
  limit: z.number().int(),
  requests: z.array(RequestView),
});
export type MyRequests = z.infer<typeof MyRequests>;
