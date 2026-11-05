import { DomainError } from '@qroove/contracts';
import { RADIO_DEFAULTS, radioStation } from '@qroove/config';
import {
  LEASE_TTL_MS,
  audit,
  commit,
  loadWork,
  requireAdmin,
  runCommand,
  type CommandOpts,
  type Deps,
} from '../context.js';
import { applyRadioPlay, rulesAt } from '../history.js';
import { requireLive } from '../lifecycle.js';
import { breakInProgress } from '../recompute.js';
import { checkLease } from './player.js';

interface LeaseInput {
  eventId: string;
  leaseToken: string;
  epoch: number;
}

/** The organiser's switch; absent on older events means the configured default. */
export const radioEnabled = (e: { radioFallback?: boolean | null }): boolean =>
  e.radioFallback ?? RADIO_DEFAULTS.enabledByDefault;

/** Until when radio must wait after the event started, if nothing has played yet; else null. */
export function radioHoldUntil(e: {
  startedAt: number | null;
  history: { lastStyle: string | null };
}): number | null {
  return e.startedAt !== null && e.history.lastStyle === null
    ? e.startedAt + RADIO_DEFAULTS.startGraceMs
    : null;
}

export function setRadioFallback(
  deps: Deps,
  input: CommandOpts & { eventId: string; adminSecret: string; enabled: boolean },
) {
  return runCommand(deps, input.eventId, input, async (c) => {
    await requireAdmin(c.tx, input.adminSecret);
    requireLive(c.event.state);
    const w = await loadWork(c);
    w.event = {
      ...c.event,
      radioFallback: input.enabled,
      ...(input.enabled ? {} : { radio: null }),
    };
    audit(c, 'radio.setting', 'admin', { enabled: input.enabled });
    return { ok: true as const, version: commit(c, w) };
  });
}

/**
 * The player reports that a radio track is audible (ADR 0023). Idempotent on station + track key:
 * a repeated report changes nothing, so polling the same track never counts twice. A queue song
 * always has priority: radio may start only when nothing is playing or reserved.
 */
export function reportRadioStarted(
  deps: Deps,
  input: LeaseInput & { stationId: string; trackKey: string; title: string | null },
) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    const l = checkLease(c.event, input);
    const e = c.event;
    if (e.radio?.stationId === input.stationId && e.radio.trackKey === input.trackKey) {
      return { ok: true as const, version: e.version };
    }
    requireLive(e.state);
    if (e.state !== 'ACTIVE') throw new DomainError('EVENT_NOT_ACTIVE');
    if (!radioEnabled(e)) throw new DomainError('VALIDATION', 'Radio fallback is switched off.');
    const station = radioStation(input.stationId);
    if (!station?.enabled) throw new DomainError('VALIDATION', 'Unknown radio station.');
    const w = await loadWork(c);
    if (breakInProgress(w)) throw new DomainError('EVENT_NOT_ACTIVE');
    if (e.nowPlaying || e.reservation) throw new DomainError('STALE_VERSION');
    const hold = radioHoldUntil(e);
    if (hold !== null && c.now < hold) {
      throw new DomainError('VALIDATION', 'Radio starts a few minutes after the event begins.');
    }
    if (!rulesAt(e, c.now).enabledStyles.includes(station.genre)) {
      throw new DomainError('VALIDATION', 'This event does not allow that genre.');
    }
    w.event = {
      ...e,
      history: applyRadioPlay(e.history, station.genre),
      radio: {
        stationId: station.id,
        genre: station.genre,
        trackKey: input.trackKey.slice(0, 64),
        title: input.title ? input.title.slice(0, 200) : null,
        startedAt: c.now,
        leaseEpoch: l.epoch,
      },
      lease: { ...l, heartbeatAt: c.now, expiresAt: c.now + LEASE_TTL_MS },
    };
    audit(c, 'radio.started', 'player', { stationId: station.id, trackKey: input.trackKey });
    return { ok: true as const, version: commit(c, w) };
  });
}

/** Idempotent: the radio stopped (handover to a queue song, failure, or organiser action). */
export function reportRadioEnded(deps: Deps, input: LeaseInput) {
  return runCommand(deps, input.eventId, {}, async (c) => {
    checkLease(c.event, input);
    if (!c.event.radio) return { ok: true as const, version: c.event.version };
    const w = await loadWork(c);
    w.event = { ...c.event, radio: null };
    audit(c, 'radio.ended', 'player', { stationId: c.event.radio.stationId });
    return { ok: true as const, version: commit(c, w) };
  });
}
