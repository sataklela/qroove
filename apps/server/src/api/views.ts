import type {
  AdminRequestView,
  AdminState,
  EventPublicView,
  MyRequests,
  RequestView,
  StyleId,
  TrackView,
} from '@qroove/contracts';
import { radioStation } from '@qroove/config';
import { SYSTEM_SEED_ID, type EventAggregate, type RequestDoc } from '../db/types.js';
import { radioEnabled, radioHoldUntil } from '../domain/commands/radio.js';
import { segmentIndexAt } from '../domain/history.js';
import { sha256 } from '../domain/ids.js';

const QUEUE_LIMIT = 50;

function trackView(r: RequestDoc, nicknames: Record<string, string | null>): TrackView {
  return {
    requestId: r.id,
    title: r.title,
    artist: r.artist,
    style: r.style,
    durationMs: r.durationMs,
    artworkUrl: r.artworkUrl,
    ownerNickname: nicknames[r.ownerId] ?? null,
  };
}

/** Radio on air, only while the player's lease is alive (a closed tab must not leave it showing). */
function radioView(e: EventAggregate['event'], now: number): EventPublicView['radio'] {
  const r = e.radio;
  const station = r ? radioStation(r.stationId) : undefined;
  if (!r || !station || !e.lease || e.lease.expiresAt <= now) return null;
  return { stationName: station.name, genre: r.genre, title: r.title, startedAt: r.startedAt };
}

/** Sanitised: request ids and display nicknames only — no participant ids or tokens. */
export function publicView(agg: EventAggregate, now: number): EventPublicView {
  const { event: e, requests, nicknames } = agg;
  const byId = new Map(requests.map((r) => [r.id, r]));
  const np = e.nowPlaying ? byId.get(e.nowPlaying.requestId) : undefined;
  const queue = e.preview.items.slice(0, QUEUE_LIMIT).flatMap((it) => {
    const r = byId.get(it.requestId);
    return r ? [{ ...trackView(r, nicknames), position: it.position, overflow: it.overflow }] : [];
  });
  const last = e.history.lastStyle;
  const seg = e.rules.segments[segmentIndexAt(e, now)] ?? e.rules.segments[0]!;
  const cap = last ? (seg.runCaps[last as keyof typeof seg.runCaps] ?? 1) : null;
  return {
    id: e.id,
    name: e.name,
    slug: e.publicSlug,
    state: e.state,
    timezone: e.timezone,
    endAt: e.endAt,
    serverNow: now,
    version: e.version,
    rules: e.rules,
    nowPlaying:
      np && e.nowPlaying
        ? {
            track: {
              ...trackView(np, nicknames),
              durationMs: e.nowPlaying.durationMs ?? np.durationMs,
            },
            startedAt: e.nowPlaying.startedAt,
          }
        : null,
    radioFallback: radioEnabled(e),
    radio: radioView(e, now),
    radioHoldUntil: radioHoldUntil(e),
    waitingReason: e.waitingReason,
    runIndicator:
      last && cap !== null && e.history.runLength > 0
        ? { style: last as StyleId, runLength: e.history.runLength, cap }
        : null,
    breaks: e.breaks,
    preview: e.preview,
    queue,
  };
}

function statusText(r: RequestDoc, agg: EventAggregate): string | null {
  const paused = agg.event.state === 'PAUSED' || agg.event.state === 'TRANSFERRING';
  switch (r.state) {
    case 'PENDING_METADATA':
      return r.possibleDuplicate ? 'Possible duplicate — needs review' : 'Looking up this song';
    case 'INELIGIBLE_TEMPORARILY':
      return 'Waiting for a different genre to play';
    case 'OVERFLOW':
      return 'Beyond planned end — admin must extend';
    case 'RESERVED_NEXT':
      return paused ? 'Session paused' : 'Up next';
    case 'PLAYING':
      return 'Playing now';
    case 'QUEUED':
      return paused ? 'Session paused' : null;
    case 'UNAVAILABLE':
      return 'We could not find this song';
    case 'REJECTED':
      return 'Removed by the organiser';
    default:
      return null;
  }
}

export function requestView(r: RequestDoc, agg: EventAggregate): RequestView {
  const item = agg.event.preview.items.find((i) => i.requestId === r.id);
  return {
    id: r.id,
    state: r.state,
    title: r.title,
    artist: r.artist,
    style: r.style,
    provider: r.provider,
    durationMs: r.durationMs,
    artworkUrl: r.artworkUrl,
    acceptedSeq: r.acceptedSeq,
    position: item?.position ?? null,
    predictedStartMs: item?.predictedStartMs ?? null,
    uncertain: item?.uncertain ?? false,
    statusText: statusText(r, agg),
  };
}

export function myRequests(agg: EventAggregate, participantId: string): MyRequests {
  const mine = agg.requests.filter((r) => r.ownerId === participantId);
  return {
    nickname: agg.nicknames[participantId] ?? null,
    accepted: mine.filter((r) => !['WITHDRAWN', 'REJECTED', 'UNAVAILABLE'].includes(r.state))
      .length,
    limit: agg.event.rules.submissionLimit,
    requests: mine.map((r) => requestView(r, agg)),
  };
}

export function adminState(agg: EventAggregate, now: number, baseUrl: string): AdminState {
  const requests: AdminRequestView[] = agg.requests.map((r) => ({
    id: r.id,
    state: r.state,
    title: r.title,
    artist: r.artist,
    style: r.style,
    ownerNickname: agg.nicknames[r.ownerId] ?? null,
    ownerLabel: sha256(`${agg.event.id}:${r.ownerId}`).slice(0, 4).toUpperCase(),
    starter: r.ownerId === SYSTEM_SEED_ID,
    acceptedSeq: r.acceptedSeq,
    possibleDuplicate: r.possibleDuplicate,
    removedReason: r.removedReason,
    sourceUrl: r.sourceUrl,
    durationMs: r.durationMs,
  }));
  const l = agg.event.lease;
  return {
    view: { ...publicView(agg, now), rules: agg.event.rules },
    requests,
    lease: l ? { epoch: l.epoch, expiresAt: l.expiresAt } : null,
    rulesHash: agg.event.rulesHash,
    rules: agg.event.rules,
    plannedDurationMin: agg.event.plannedDurationMin,
    guestsFirst: agg.event.guestsFirst !== false,
    joinUrl: `${baseUrl}/e/${agg.event.publicSlug}`,
  };
}
