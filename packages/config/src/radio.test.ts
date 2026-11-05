import { describe, expect, it } from 'vitest';
import { RADIO_STATIONS, chooseRadioStation, type RadioStation } from './radio.js';

const st = (id: string, genre: RadioStation['genre'], enabled = true): RadioStation => ({
  id,
  name: id,
  genre,
  streamUrl: `https://example.test/${id}`,
  provider: 'radio.co',
  providerStationId: id,
  siteUrl: 'https://example.test',
  enabled,
  verifiedNote: '',
});
const base = { lastGenre: null, runLength: 0, runCap: 2 } as const;

describe('chooseRadioStation', () => {
  const stations = [st('s', 'salsa'), st('b', 'bachata'), st('o', 'other'), st('c', 'chacha')];

  it('starts with salsa when there is no history', () => {
    expect(chooseRadioStation({ ...base, allowedGenres: ['bachata', 'salsa'], stations })?.id).toBe(
      's',
    );
  });
  it('follows the priority salsa, bachata, other, chacha', () => {
    const all = ['salsa', 'bachata', 'chacha', 'other'] as const;
    const un = (ids: string[]) => new Set(ids);
    const pick = (u: string[]) =>
      chooseRadioStation({ ...base, allowedGenres: all, unavailable: un(u), stations })?.id;
    expect(pick([])).toBe('s');
    expect(pick(['s'])).toBe('b');
    expect(pick(['s', 'b'])).toBe('o');
    expect(pick(['s', 'b', 'o'])).toBe('c');
    expect(pick(['s', 'b', 'o', 'c'])).toBeUndefined();
  });
  it('never offers a genre the event does not allow', () => {
    expect(
      chooseRadioStation({ ...base, allowedGenres: ['chacha'], stations: [st('s', 'salsa')] }),
    ).toBeNull();
  });
  it('skips stations that are not enabled', () => {
    expect(
      chooseRadioStation({
        ...base,
        allowedGenres: ['salsa', 'bachata'],
        stations: [st('s', 'salsa', false), st('b', 'bachata')],
      })?.id,
    ).toBe('b');
  });
  it('tries a genre that just hit its cap last', () => {
    const input = {
      allowedGenres: ['salsa', 'bachata'] as const,
      lastGenre: 'salsa' as const,
      runLength: 2,
      runCap: 2,
      stations,
    };
    expect(chooseRadioStation(input)?.id).toBe('b');
    expect(chooseRadioStation({ ...input, stations: [st('s', 'salsa')] })?.id).toBe('s');
  });
  it('ships only verified, https stations as enabled', () => {
    for (const s of RADIO_STATIONS.filter((x) => x.enabled)) {
      expect(s.streamUrl.startsWith('https://')).toBe(true);
      expect(s.verifiedNote).toMatch(/2026-/);
    }
    expect(RADIO_STATIONS.find((s) => s.genre === 'salsa')?.enabled).toBe(false);
  });
});
