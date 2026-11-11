/** "~4 min" from a predicted start; null when there is no reliable prediction to show. */
export function etaText(startMs: number | null, uncertain: boolean, serverNow: number) {
  if (startMs === null || uncertain) return null;
  return `~${Math.max(1, Math.round((startMs - serverNow) / 60_000))} min`;
}
