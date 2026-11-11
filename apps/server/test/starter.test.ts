import { describe, expect, it } from 'vitest';
import { createStarter } from '../src/ingestion/starter.js';

const list = (prefix: string, n: number) => ({
  tracks: Array.from({ length: n }, (_, i) => ({
    title: `${prefix}${i}`,
    artist: 'A',
    durationMs: 200_000,
    sourceUrl: null,
  })),
});

describe('starter songs', () => {
  const lists: Record<string, ReturnType<typeof list>> = {
    s1: list('s1-', 30),
    s2: list('s2-', 30),
    nl: list('nl-', 30),
    b: list('b-', 30),
  };
  const starter = createStarter({
    resolvePlaylist: async (u) => lists[u]!,
    now: () => 0,
    playlists: { salsa: ['s1', 's2'], salsa_nl: ['nl'], bachata: ['b'], chacha: ['b'] },
  });

  it('mixes every list of a genre, keeps each song’s own style, and alternates genres', async () => {
    const out = await starter.pick(['salsa', 'salsa_nl', 'bachata'], () => 0.37, 9e9);
    expect(out).toHaveLength(20);
    const salsa = out.filter((s) => s.style.startsWith('salsa'));
    expect(salsa).toHaveLength(10);
    expect(new Set(salsa.map((s) => s.title.split('-')[0])).size).toBeGreaterThan(1);
    expect(
      salsa.filter((s) => s.style === 'salsa_nl').every((s) => s.title.startsWith('nl-')),
    ).toBe(true);
    expect(out[0]!.style.startsWith('salsa')).not.toBe(out[1]!.style.startsWith('salsa'));
  });

  it('adds nothing for a style that is not enabled', async () => {
    const out = await starter.pick(['bachata'], () => 0.5, 9e9);
    expect(out.every((s) => s.style === 'bachata')).toBe(true);
  });
});
