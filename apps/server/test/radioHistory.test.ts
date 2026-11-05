import { describe, expect, it } from 'vitest';
import { applyRadioPlay } from '../src/domain/history.js';
import type { HistoryDoc } from '../src/db/types.js';

const genres = ['salsa', 'bachata', 'chacha', 'other'];
/** Every small history, so the rule is checked exhaustively rather than by sampling. */
function* histories(): Generator<HistoryDoc> {
  for (const lastStyle of [null, ...genres]) {
    for (let runLength = 0; runLength <= 5; runLength++) {
      for (const transitionCount of [0, 3]) {
        yield { lastStyle, runLength, transitionCount, playedKeys: ['k1', 'k2'] };
      }
    }
  }
}

describe('applyRadioPlay (ADR 0023)', () => {
  it('never extends a run, never touches played keys', () => {
    for (const h of histories()) {
      for (const g of genres) {
        const n = applyRadioPlay(h, g);
        expect(n.playedKeys).toEqual(h.playedKeys);
        if (h.lastStyle === g) expect(n).toEqual(h);
        else expect(n.runLength).toBe(0);
        expect(n.runLength).toBeLessThanOrEqual(h.runLength);
      }
    }
  });
  it('counts a genre change once, and the first play is not a change', () => {
    const empty: HistoryDoc = { lastStyle: null, runLength: 0, transitionCount: 0, playedKeys: [] };
    const a = applyRadioPlay(empty, 'bachata');
    expect(a.transitionCount).toBe(0);
    expect(applyRadioPlay(a, 'salsa')).toMatchObject({
      lastStyle: 'salsa',
      runLength: 0,
      transitionCount: 1,
    });
  });
});
