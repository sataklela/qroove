import { describe, expect, it, vi } from 'vitest';
import { parseRadioStatus, parseZenoEvent, radioTrackKey, watchStall } from './radio';

describe('parseRadioStatus', () => {
  it('reads the documented Radio.co shape', () => {
    const s = parseRadioStatus({
      status: 'online',
      current_track: { title: ' Some Mix ', start_time: '2026-11-05T14:02:27+00:00' },
    });
    expect(s).toEqual({ online: true, title: 'Some Mix', startTime: '2026-11-05T14:02:27+00:00' });
    expect(radioTrackKey(s)).toBe('2026-11-05T14:02:27+00:00');
  });
  it('copes with missing or malformed data, never inventing a title', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      {},
      { status: 'offline' },
      { status: 'online', current_track: { title: 5 } },
    ]) {
      const s = parseRadioStatus(bad);
      expect(s.title).toBeNull();
      expect(s.startTime).toBeNull();
    }
    expect(radioTrackKey(parseRadioStatus({}))).toBe('live');
    expect(parseRadioStatus({ status: 'offline' }).online).toBe(false);
  });
  it('cuts very long titles', () => {
    const t = parseRadioStatus({
      status: 'online',
      current_track: { title: 'a'.repeat(999) },
    }).title;
    expect(t).toHaveLength(200);
  });
});

describe('parseZenoEvent', () => {
  it('reads streamTitle and uses it as the identity of the play', () => {
    const s = parseZenoEvent('{"mount":"x","streamTitle":" Fania All Stars - Mi Gente "}');
    expect(s).toEqual({
      online: true,
      title: 'Fania All Stars - Mi Gente',
      startTime: 't:Fania All Stars - Mi Gente',
    });
    expect(radioTrackKey(s)).toBe('t:Fania All Stars - Mi Gente');
  });
  it('treats empty, malformed or non-string titles as no title', () => {
    for (const bad of ['', 'nope', '{}', '{"streamTitle":""}', '{"streamTitle":5}']) {
      const s = parseZenoEvent(bad);
      expect(s).toEqual({ online: false, title: null, startTime: null });
    }
  });
});

describe('watchStall', () => {
  it('reports a stream whose position stops moving, and keeps quiet while it plays', () => {
    vi.useFakeTimers();
    try {
      const a = { currentTime: 0 };
      const onStall = vi.fn();
      const stop = watchStall(a, 1000, onStall);
      for (let i = 0; i < 5; i += 1) {
        a.currentTime += 1;
        vi.advanceTimersByTime(1000);
      }
      expect(onStall).not.toHaveBeenCalled();
      // One still check may be a short buffer gap; two in a row is a stall.
      vi.advanceTimersByTime(1000);
      expect(onStall).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(onStall).toHaveBeenCalledTimes(1);
      // Still silent: asked again after two more checks, not on every one.
      vi.advanceTimersByTime(1000);
      expect(onStall).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1000);
      expect(onStall).toHaveBeenCalledTimes(2);
      stop();
      vi.advanceTimersByTime(10_000);
      expect(onStall).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
