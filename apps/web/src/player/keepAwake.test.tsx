import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScreenAwake } from './keepAwake';

function Probe({ on }: { on: boolean }) {
  useScreenAwake(on);
  return null;
}

function fakeWakeLock() {
  const locks: Array<{ released: boolean; release: () => Promise<void> }> = [];
  const request = vi.fn(async () => {
    const l = {
      released: false,
      release: async () => {
        l.released = true;
      },
    };
    locks.push(l);
    return l;
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
  return { locks, request };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'wakeLock');
});

describe('useScreenAwake', () => {
  it('holds a screen lock only while on, and lets it go afterwards', async () => {
    const { locks, request } = fakeWakeLock();
    const view = render(<Probe on={false} />);
    expect(request).not.toHaveBeenCalled();
    view.rerender(<Probe on />);
    await waitFor(() => expect(locks).toHaveLength(1));
    expect(request).toHaveBeenCalledWith('screen');
    view.rerender(<Probe on={false} />);
    await waitFor(() => expect(locks[0]!.released).toBe(true));
  });

  it('takes the lock again when the page comes back after the browser dropped it', async () => {
    const { locks } = fakeWakeLock();
    render(<Probe on />);
    await waitFor(() => expect(locks).toHaveLength(1));
    // Still held: coming back to the page does not ask twice.
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(locks).toHaveLength(1);
    locks[0]!.released = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(locks).toHaveLength(2));
  });

  it('does nothing in a browser without the API', () => {
    expect(() => render(<Probe on />)).not.toThrow();
  });
});
