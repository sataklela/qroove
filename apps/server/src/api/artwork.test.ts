import { describe, expect, it } from 'vitest';
import { artworkOf } from './views.js';

describe('artworkOf', () => {
  it('keeps stored artwork', () => {
    expect(artworkOf({ artworkUrl: 'https://x/a.jpg', sourceUrl: null })).toBe('https://x/a.jpg');
  });
  it('falls back to the YouTube thumbnail', () => {
    expect(
      artworkOf({ artworkUrl: null, sourceUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
    ).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg');
    expect(artworkOf({ artworkUrl: null, sourceUrl: 'https://youtu.be/dQw4w9WgXcQ?t=3' })).toBe(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    );
  });
  it('is null when there is nothing', () => {
    expect(artworkOf({ artworkUrl: null, sourceUrl: 'https://open.spotify.com/track/x' })).toBeNull();
  });
});
