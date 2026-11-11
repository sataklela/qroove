import { EVENT_LIMITS, RULE_DEFAULTS } from '@qroove/config';

/** The planned times on offer: quarter hours at first, then whole hours (all valid for the API). */
export const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 210, 240, 300, 360, 420, 480].filter(
  (m) =>
    m >= EVENT_LIMITS.minDurationMin &&
    m <= EVENT_LIMITS.maxDurationMin &&
    m % EVENT_LIMITS.durationStepMin === 0,
);

/** "Songs in a row" a new or running event may choose. */
export const RUN_CAPS = Array.from({ length: RULE_DEFAULTS.maxNewRunCap }, (_, i) => i + 1);

/** Songs per person on offer for a planned time: steps of five up to its ceiling. */
export const limitChoices = (maxLimit: number) =>
  Array.from(
    { length: maxLimit / RULE_DEFAULTS.submissionStep },
    (_, i) => (i + 1) * RULE_DEFAULTS.submissionStep,
  );
