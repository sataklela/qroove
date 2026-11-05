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

/**
 * Reads one Zeno `streamTitle` event. Zeno gives the title only, with no track start time, so the
 * title itself stands in for the identity of one play (a new title is a new play).
 */
export function parseZenoEvent(data: unknown): RadioStatus {
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(String(data)) as Record<string, unknown>;
  } catch {
    /* not JSON: treated as no title */
  }
  const title =
    typeof o.streamTitle === 'string' && o.streamTitle.trim()
      ? o.streamTitle.trim().slice(0, 200)
      : null;
  return { online: title !== null, title, startTime: title ? `t:${title}`.slice(0, 40) : null };
}

/** Zeno's feed is server-sent events: open it, take the first message, close it. */
async function fetchZenoStatus(s: RadioStation, signal?: AbortSignal): Promise<RadioStatus> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal?.addEventListener('abort', stop);
  const timer = setTimeout(stop, 8000);
  try {
    const r = await fetch(
      `https://api.zeno.fm/mounts/metadata/subscribe/${encodeURIComponent(s.providerStationId)}`,
      { credentials: 'omit', headers: { Accept: 'text/event-stream' }, signal: ctl.signal },
    );
    if (!r.ok || !r.body) throw new Error(`status ${r.status}`);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error('feed closed');
      buf += dec.decode(value, { stream: true });
      if (buf.length > 8192) throw new Error('feed too large');
      for (const block of buf.split('\n\n').slice(0, -1)) {
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (data) return parseZenoEvent(data);
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    ctl.abort();
  }
}

export async function fetchRadioStatus(
  s: RadioStation,
  signal?: AbortSignal,
): Promise<RadioStatus> {
  if (s.provider === 'zeno') return fetchZenoStatus(s, signal);
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
