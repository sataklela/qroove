import { describe, expect, it } from 'vitest';
import { parseCookies } from '../src/security/tokens';

describe('parseCookies', () => {
  it('reads encoded cookies', () => {
    expect(parseCookies('a=1; b=x%20y')).toEqual({ a: '1', b: 'x y' });
  });

  it('skips a cookie that is not URI-encoded instead of throwing (500 on every admin call)', () => {
    expect(parseCookies('junk=100%; q_admin=tok%2B1; other=%E0%A4%A')).toEqual({
      q_admin: 'tok+1',
    });
  });
});
