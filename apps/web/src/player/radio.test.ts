import { describe, expect, it } from 'vitest';
import { parseRadioStatus, radioTrackKey } from './radio';

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
