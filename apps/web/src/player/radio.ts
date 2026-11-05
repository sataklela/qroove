import type { RadioStation } from '@qroove/config';

/** What the station's public status feed says is on air. */
export interface RadioStatus {
  online: boolean;
  title: string | null;
  /** Provider start time of the current track: the identity of one play. */
  startTime: string | null;
}

/**
 * Parses Radio.co's public `/stations/{id}/status` JSON. The text is untrusted: it is only ever
 * rendered as text, and is cut to a sane length. Anything unexpected gives `online: false`.
 */
export function parseRadioStatus(json: unknown): RadioStatus {
  const o = (json ?? {}) as Record<string, unknown>;
  const cur = (o.current_track ?? {}) as Record<string, unknown>;
  const title =
    typeof cur.title === 'string' && cur.title.trim() ? cur.title.trim().slice(0, 200) : null;
  const start =
    typeof cur.start_time === 'string' && cur.start_time ? cur.start_time.slice(0, 40) : null;
  return { online: o.status === 'online', title, startTime: start };
}

export async function fetchRadioStatus(
  s: RadioStation,
  signal?: AbortSignal,
): Promise<RadioStatus> {
  const r = await fetch(
    `https://public.radio.co/stations/${encodeURIComponent(s.providerStationId)}/status`,
    {
      credentials: 'omit',
      ...(signal ? { signal } : {}),
    },
  );
  if (!r.ok) throw new Error(`status ${r.status}`);
  return parseRadioStatus(await r.json());
}

/** One play of one station; `live` when the feed gives no start time. */
export const radioTrackKey = (s: RadioStatus | null): string => s?.startTime ?? 'live';
