import { describe, expect, it } from 'vitest';
import type { EventPublicView } from '@qroove/contracts';
import { queueRows, radioGap } from './queueRows';

const view = (over: Partial<EventPublicView> = {}) =>
  ({
    state: 'ACTIVE',
    radioFallback: true,
    nowPlaying: null,
    runIndicator: null,
    breaks: [],
    queue: [],
    preview: { revision: 1, items: [], stoppedReason: 'EXHAUSTED', computedAt: 0 },
    rules: {
      segments: [
        {
          enabledStyles: ['salsa', 'bachata'],
          runCaps: { salsa: 2, bachata: 2 },
        },
      ],
    },
    ...over,
  }) as unknown as EventPublicView;

describe('radio gap in the queue', () => {
  it('shows a radio row when the queue is empty', () => {
    const rows = queueRows(view());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('radio');
  });
  it('shows nothing when radio is off or the event is not live', () => {
    expect(radioGap(view({ radioFallback: false }))).toBeNull();
    expect(radioGap(view({ state: 'PAUSED' }))).toBeNull();
  });
});
