/* global document */
// Android TV emulator smoke test (CI job `android-tv`). The debug app points at the server running on
// the CI host (10.0.2.2:3100 from inside the emulator); Playwright drives its WebView over CDP while
// the remote is simulated with `adb shell input keyevent`.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PKG = process.env.APP_ID;
const OUT = 'tv-shots';
mkdirSync(OUT, { recursive: true });
const sh = (c) => execSync(c, { encoding: 'utf8' }).trim();
const adb = (c) => sh(`adb ${c}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (k) => {
  adb(`shell input keyevent KEYCODE_${k}`);
  await sleep(700);
};
let n = 0;
const shot = (name) =>
  sh(`adb exec-out screencap -p > ${OUT}/${String(++n).padStart(2, '0')}-${name}.png`);
const check = (ok, msg) => {
  if (!ok) throw new Error(`FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
};

// 1. It is a TV app: listed for the TV launcher.
const leanback = adb(
  `shell cmd package query-activities -a android.intent.action.MAIN -c android.intent.category.LEANBACK_LAUNCHER`,
);
check(leanback.includes(PKG), 'shows on the Android TV home screen (LEANBACK_LAUNCHER)');

// 2. Launch it like the TV launcher does.
adb(`shell monkey -p ${PKG} -c android.intent.category.LEANBACK_LAUNCHER 1`);
let pid = '';
for (let i = 0; i < 30 && !pid; i++) {
  await sleep(1000);
  pid = sh(`adb shell pidof ${PKG} || true`);
}
check(!!pid, 'launches');
await sleep(8000);
shot('launched');

// 3. Attach to the WebView.
let page;
for (let i = 0; i < 20 && !page; i++) {
  try {
    adb(`forward tcp:9222 localabstract:webview_devtools_remote_${pid}`);
    const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    page = browser
      .contexts()[0]
      ?.pages()
      .find((p) => p.url().startsWith('http'));
  } catch {
    await sleep(1500);
  }
}
check(!!page, 'WebView reachable over CDP');
await page.waitForFunction(() => document.documentElement.dataset.tv === '1', null, {
  timeout: 30_000,
});
check(
  (await page.evaluate(() => navigator.userAgent)).includes('LeanbackShell'),
  'TV mode from the UI mode (user agent marker)',
);
const focused = () =>
  page.evaluate(() =>
    (
      document.activeElement?.getAttribute('aria-label') ??
      document.activeElement?.textContent ??
      ''
    ).trim(),
  );
await page.waitForFunction(
  () => document.activeElement?.textContent?.includes('Host an event'),
  null,
  { timeout: 20_000 },
);
check(true, 'focus starts on "Host an event"');
shot('home');

// 4. The D-pad moves focus, and comes back.
await key('DPAD_RIGHT');
check(!(await focused()).includes('Host an event'), 'D-pad right moves focus');
await key('DPAD_LEFT');
check((await focused()).includes('Host an event'), 'D-pad left moves it back');

// 5. OK hosts an event; the join QR stays on screen.
await key('DPAD_CENTER');
await page.waitForURL(/\/admin\//, { timeout: 30_000 });
await page.waitForSelector('.tv-join .qr', { timeout: 30_000 });
check(true, 'OK hosts an event; big-screen join QR shown');
await sleep(3000);
shot('host');
for (const k of ['DPAD_DOWN', 'DPAD_DOWN', 'DPAD_UP', 'DPAD_RIGHT']) {
  await key(k);
  check((await focused()) !== '', `focus kept after ${k}`);
}
shot('host-moved');

// 6. Back leaves the organiser page (no sheet open) without closing the app.
await key('BACK');
await sleep(2000);
check(sh(`adb shell pidof ${PKG} || true`) !== '', 'Back keeps the app running');
shot('after-back');
console.log('Android TV smoke test passed');
process.exit(0);
