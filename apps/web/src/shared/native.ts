import { Capacitor } from '@capacitor/core';

/**
 * The Android app (ADR 0029) is this same site in a Capacitor WebView. Everything native goes
 * through here, and every function does the plain web thing when the page runs in a browser, so the
 * site and the app never differ in what they can do. Plugins load only inside the app.
 */
export const isApp = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** An Android phone browsing the site (not the app): it can be offered the app. */
export const isAndroidBrowser = (): boolean =>
  !isApp() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

/**
 * Google/Spotify sign-in. Google refuses sign-in inside an app's WebView, so the app opens it in a
 * Chrome Custom Tab with `app=1`; the server then sends a one-time code back into the app (see
 * `listenForAppLinks`). In a browser this is an ordinary link.
 */
export async function openSignIn(href: string): Promise<void> {
  if (!isApp()) {
    window.location.assign(href);
    return;
  }
  const { Browser } = await import('@capacitor/browser');
  const url = new URL(href, window.location.origin);
  url.searchParams.set('app', '1');
  await Browser.open({ url: url.toString(), presentationStyle: 'popover' });
}

/** Swaps a sign-in code for the session cookie in this WebView, then lands where sign-in began. */
async function redeem(code: string) {
  const r = await fetch('/api/app/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  }).catch(() => null);
  const j = (await r?.json().catch(() => null)) as { ok?: boolean; back?: string | null } | null;
  const back = j?.back && j.back.startsWith('/') ? j.back : window.location.pathname;
  window.location.assign(back);
}

/** Handles links that open the app: sign-in returns and room links / QR codes for this site. */
export function handleAppUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.host === 'auth') {
    const code = u.searchParams.get('code');
    if (code) void redeem(code);
    void import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => undefined);
    return true;
  }
  if (u.protocol === 'https:' && u.host === window.location.host) {
    window.location.assign(`${u.pathname}${u.search}${u.hash}`);
    return true;
  }
  return false;
}

/** Called once at start-up. Does nothing in a browser. */
export async function listenForAppLinks(): Promise<void> {
  if (!isApp()) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('appUrlOpen', (e) => void handleAppUrl(e.url));
  const launch = await App.getLaunchUrl().catch(() => undefined);
  if (launch?.url && !launch.url.startsWith(window.location.origin)) handleAppUrl(launch.url);
}

/** Scans a room QR code with the camera (app only). Returns the room path, or null. */
export async function scanRoomCode(): Promise<string | null> {
  if (!isApp()) return null;
  const { CapacitorBarcodeScanner, CapacitorBarcodeScannerTypeHint } =
    await import('@capacitor/barcode-scanner');
  const r = await CapacitorBarcodeScanner.scanBarcode({
    hint: CapacitorBarcodeScannerTypeHint.QR_CODE,
  }).catch(() => null);
  return roomPathFrom(r?.ScanResult ?? '');
}

/** A room link from a QR code (`https://<this site>/e/CODE`), or a bare 6-letter code. */
export function roomPathFrom(text: string): string | null {
  const t = text.trim();
  if (/^[A-Za-z0-9]{6}$/.test(t)) return `/e/${t.toUpperCase()}`;
  try {
    const u = new URL(t);
    if (u.host !== window.location.host) return null;
    return /^\/e\/[A-Za-z0-9_-]{1,64}$/.test(u.pathname) ? u.pathname : null;
  } catch {
    return null;
  }
}

/** The app keeps the screen on natively (also in battery saver); the site uses Wake Lock. */
export async function nativeKeepAwake(on: boolean): Promise<boolean> {
  if (!isApp()) return false;
  const { KeepAwake } = await import('@capacitor-community/keep-awake');
  await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => undefined);
  return true;
}
