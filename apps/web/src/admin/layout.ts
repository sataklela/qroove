import { useSyncExternalStore } from 'react';
import { isTv } from '../shared/native';

/**
 * How the organiser console is arranged:
 * - `portrait`: phones and upright tablets; swipe between Playing, Invite and More.
 * - `split`: landscape tablets, laptops and monitors; the QR sits beside the queue, controls below it.
 * - `wall`: TVs, projectors and very wide screens; everything on one screen, the QR shrunk to a corner.
 * TV WebViews often report only 960×540 CSS px, so a TV is `wall` whatever its size.
 */
export type ConsoleLayout = 'portrait' | 'split' | 'wall';

const KEY = 'qroove.wall';
export const SPLIT_QUERY = '(orientation: landscape) and (min-width: 900px) and (min-height: 600px)';
export const WALL_QUERY = '(orientation: landscape) and (min-width: 1920px)';

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readForced(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' ? true : v === '0' ? false : null;
  } catch {
    return null;
  }
}

/** Big-screen view on (true), off (false) or automatic (null). Remembered on this device. */
export function setWallForced(v: boolean | null) {
  try {
    if (v === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
  forced = v;
  emit();
}

let forced: boolean | null = null;
let primed = false;
function prime() {
  if (primed || typeof window === 'undefined') return;
  primed = true;
  forced = readForced();
  // ?wall=1 turns big-screen view on, ?wall=0 off, ?wall=auto back to automatic.
  const q = new URLSearchParams(location.search).get('wall');
  if (q === '1' || q === '0') setWallForced(q === '1');
  else if (q === 'auto') setWallForced(null);
}

const match = (q: string) =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(q).matches
    : false;

export function currentLayout(): ConsoleLayout {
  prime();
  if (forced === true) return 'wall';
  if (forced === null && (isTv() || match(WALL_QUERY))) return 'wall';
  if (match(SPLIT_QUERY) || (forced === false && match(WALL_QUERY))) return 'split';
  return 'portrait';
}

export const wallForced = (): boolean | null => {
  prime();
  return forced;
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  const mqs =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? [SPLIT_QUERY, WALL_QUERY].map((q) => window.matchMedia(q))
      : [];
  mqs.forEach((m) => m.addEventListener?.('change', cb));
  return () => {
    listeners.delete(cb);
    mqs.forEach((m) => m.removeEventListener?.('change', cb));
  };
}

export function useConsoleLayout(): ConsoleLayout {
  return useSyncExternalStore(subscribe, currentLayout, () => 'portrait');
}

export function useWallForced(): boolean | null {
  return useSyncExternalStore(subscribe, wallForced, () => null);
}

/** Test hook: forget what was read, so the next call reads storage and the URL again. */
export function resetLayoutForTests() {
  primed = false;
  forced = null;
}
