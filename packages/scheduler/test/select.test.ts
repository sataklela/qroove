import { describe, expect, it } from 'vitest';
import {
  applyPlay,
  EMPTY_HISTORY,
  selectNext,
  type Candidate,
  type HistoryState,
} from '../src/index.js';
import { RULES, cand } from './helpers.js';

function drain(cs: Candidate[]): string[] {
  let h: HistoryState = EMPTY_HISTORY;
  let rest = cs;
  const out: string[] = [];
  for (;;) {
    const { pick } = selectNext(rest, h, RULES);
    if (!pick) return out;
    out.push(pick.requestId);
    h = applyPlay(h, pick);
    rest = rest.filter((c) => c !== pick);
  }
}

describe('selectNext', () => {
  it('one person may play back to back, up to the genre cap', () => {
    const cs = [
      cand('A', 'salsa', 1),
      cand('A', 'salsa', 2),
      cand('B', 'bachata', 3),
      cand('B', 'bachata', 4),
    ];
    expect(drain(cs)).toEqual(['A-s1', 'A-s2', 'B-b3', 'B-b4']);
  });
  it('one person with two genres keeps the music going', () => {
    const cs = [cand('A', 'salsa', 1), cand('A', 'bachata', 2), cand('A', 'salsa', 3)];
    expect(drain(cs)).toEqual(['A-s1', 'A-b2', 'A-s3']);
  });
  it('filler songs wait behind requests of the same genre, however old they are', () => {
    const filler = { priority: 1 };
    const cs = [
      cand('seed', 'salsa', 1, filler),
      cand('seed', 'bachata', 2, filler),
      cand('seed', 'salsa', 3, filler),
      cand('A', 'salsa', 4),
      cand('B', 'bachata', 5),
    ];
    const rules = { enabledStyles: ['salsa', 'bachata'], runCaps: { salsa: 1, bachata: 1 } };
    let h: HistoryState = EMPTY_HISTORY;
    let rest = cs;
    const out: string[] = [];
    for (;;) {
      const { pick } = selectNext(rest, h, rules);
      if (!pick) break;
      out.push(pick.requestId);
      h = applyPlay(h, pick);
      rest = rest.filter((c) => c !== pick);
    }
    // Requests first, genres still alternating; then the filler in its own order.
    expect(out).toEqual(['A-s4', 'B-b5', 'seed-s1', 'seed-b2', 'seed-s3']);
  });
  it('a filler song still fills a genre turn no request can take', () => {
    const cs = [cand('seed', 'bachata', 1, { priority: 1 }), cand('A', 'salsa', 2)];
    const h = applyPlay(applyPlay(EMPTY_HISTORY, cand('X', 'salsa', 0)), cand('X', 'salsa', 0));
    expect(selectNext(cs, h, RULES).pick?.requestId).toBe('seed-b1');
  });
  it('no candidates', () => {
    expect(selectNext([], EMPTY_HISTORY, RULES).reason).toBe('NO_CANDIDATES');
  });
  it('cap 2 blocks a third salsa, then the oldest eligible request wins', () => {
    const cs = [
      cand('A', 'salsa', 1),
      cand('B', 'salsa', 2),
      cand('C', 'salsa', 3),
      cand('D', 'bachata', 4),
      cand('E', 'bachata', 5),
      cand('F', 'bachata', 6),
    ];
    expect(drain(cs)).toEqual(['A-s1', 'B-s2', 'D-b4', 'C-s3', 'E-b5', 'F-b6']);
  });
  it('scenario 1: A/B/C salsa, D/E bachata', () => {
    const cs = [
      cand('A', 'salsa', 1),
      cand('B', 'salsa', 2),
      cand('D', 'bachata', 3),
      cand('E', 'bachata', 4),
      cand('C', 'salsa', 5),
    ];
    expect(drain(cs)).toEqual(['A-s1', 'B-s2', 'D-b3', 'E-b4', 'C-s5']);
  });
  it('a skipped-after-start track counts as a play', () => {
    let h = applyPlay(EMPTY_HISTORY, cand('A', 'salsa', 1));
    h = applyPlay(h, cand('B', 'salsa', 2));
    const sel = selectNext([cand('C', 'salsa', 3), cand('D', 'bachata', 4)], h, RULES);
    expect(sel.pick?.requestId).toBe('D-b4');
    expect(sel.blocked).toEqual([{ requestId: 'C-s3', reason: 'RUN_CAP' }]);
  });
  it('tie-break prefers a style different from the last', () => {
    const h = applyPlay(EMPTY_HISTORY, cand('Z', 'salsa', 0));
    const a = cand('A', 'salsa', 5);
    const b = cand('B', 'bachata', 5);
    expect(selectNext([a, b], h, RULES).pick?.style).toBe('bachata');
  });
  it('is deterministic and independent of input order', () => {
    const cs = [
      cand('A', 'salsa', 1),
      cand('B', 'bachata', 2),
      cand('C', 'salsa', 3),
      cand('D', 'bachata', 4),
    ];
    expect(drain(cs)).toEqual(drain([...cs].reverse()));
    expect(drain(cs)).toEqual(drain(cs));
  });
});
