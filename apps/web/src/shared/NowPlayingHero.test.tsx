import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { artSrc, NowPlayingHero } from './NowPlayingHero';

const track = {
  requestId: 'r1',
  title: 'Despacito',
  artist: 'Luis Fonsi',
  style: 'salsa',
  durationMs: 200_000,
  artworkUrl: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
  ownerNickname: 'Mango Pelican',
} as const;

afterEach(cleanup);

describe('NowPlayingHero', () => {
  it('shows the song, who it is for, and how far it has played', () => {
    const startedAt = Date.now() - 50_000;
    render(<NowPlayingHero track={{ ...track }} startedAt={startedAt} />);
    expect(screen.getByText('Despacito')).toBeTruthy();
    expect(screen.getByText('for Mango Pelican')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Song progress' });
    expect(Number(bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(24);
  });
  it('shows the idle text when nothing plays', () => {
    render(<NowPlayingHero track={null} idle={<p>Nothing is playing right now.</p>} />);
    expect(screen.getByText('Nothing is playing right now.')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('artSrc', () => {
  it('uses the bare 16:9 YouTube frame instead of the letterboxed thumbnail', () => {
    expect(artSrc('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe(
      'https://i.ytimg.com/vi/abc/mqdefault.jpg',
    );
    expect(artSrc('https://i.scdn.co/image/xyz')).toBe('https://i.scdn.co/image/xyz');
  });
});
