import { useEffect } from 'react';
import { isApp, nativeKeepAwake } from '../shared/native';

/**
 * Keeps the screen on while `on` (Screen Wake Lock). The browser drops the lock whenever the page
 * is hidden, so it is taken again each time the page comes back. Best effort: a browser without
 * the API, or a phone in battery-saver mode, simply refuses.
 */
export function useScreenAwake(on: boolean): void {
  // In the app the screen is kept on natively, which also holds in battery-saver mode.
  useEffect(() => {
    if (!on || !isApp()) return;
    void nativeKeepAwake(true);
    return () => void nativeKeepAwake(false);
  }, [on]);
  useEffect(() => {
    if (!on || isApp() || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let asking = false;
    let over = false;
    const take = async () => {
      if (over || asking || document.visibilityState !== 'visible') return;
      if (lock && !lock.released) return;
      asking = true;
      try {
        const l = await navigator.wakeLock.request('screen');
        if (over) void l.release().catch(() => undefined);
        else lock = l;
      } catch {
        /* refused: the screen follows the phone's own timeout */
      } finally {
        asking = false;
      }
    };
    void take();
    document.addEventListener('visibilitychange', take);
    return () => {
      over = true;
      document.removeEventListener('visibilitychange', take);
      void lock?.release().catch(() => undefined);
    };
  }, [on]);
}
