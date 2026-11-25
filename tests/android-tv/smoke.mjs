// Android TV emulator smoke test (CI job `android-tv`). The debug app points at the server running on
// the CI host (10.0.2.2:3100 from inside the emulator); Playwright drives its WebView over CDP while
// the remote is simulated with `adb shell input keyevent`.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

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

// 3. Attach to the WebView (debug builds expose webview_devtools_remote_<pid>). Plain CDP over a
// WebSocket: TV WebViews are often old (Android 11 emulator: WebView 90), too old for Playwright.
console.log(
  'WebView:',
  sh(`adb shell dumpsys package com.google.android.webview | grep versionName | head -1 || true`),
);
let ws;
let last = '';
for (let i = 0; i < 20 && !ws; i++) {
  try {
    const sockets = sh(
      `adb shell cat /proc/net/unix | grep -o 'webview_devtools_remote_[0-9]*' | sort -u || true`,
    ).split('\n');
    const name = sockets.find((s) => s.endsWith(`_${pid}`)) ?? sockets[0];
    if (!name) throw new Error('no devtools socket yet');
    adb(`forward tcp:9222 localabstract:${name}`);
    const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
    last = targets.map((t) => `${t.type} ${t.url}`).join(', ');
    const t = targets.find((x) => x.type === 'page' && x.url.startsWith('http'));
    if (t) {
      ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((ok, no) => ((ws.onopen = ok), (ws.onerror = no)));
    }
  } catch (e) {
    ws = undefined;
    last = String(e).slice(0, 200);
  }
  if (!ws) await sleep(1500);
}
if (!ws) console.log('last attach attempt:', last);
check(!!ws, 'WebView reachable over CDP');
let id = 0;
const waiting = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  waiting.get(msg.id)?.(msg);
  waiting.delete(msg.id);
};
/** Evaluates an expression in the page and returns its value. */
const js = (expression) =>
  new Promise((ok) => {
    const n = ++id;
    waiting.set(n, (msg) => ok(msg.result?.result?.value));
    ws.send(
      JSON.stringify({
        id: n,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true },
      }),
    );
  });
const until = async (expression, what, ms = 30_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    if (await js(expression)) return check(true, what);
  }
  check(false, what);
};
const focused = () =>
  js(
    `(() => { const a = document.activeElement; return a && a !== document.body ? (a.getAttribute('aria-label') || a.textContent || '').trim() : ''; })()`,
  );

await until(`document.documentElement.dataset.tv === '1'`, 'TV mode is on');
check(
  (await js('navigator.userAgent')).includes('LeanbackShell'),
  'TV mode from the UI mode (user agent marker)',
);
await until(
  `(document.activeElement?.textContent || '').includes('Host an event')`,
  'focus starts on "Host an event"',
);
check(
  (await js(`getComputedStyle(document.querySelector('.landing-host')).backgroundImage`)) !==
    'none',
  'buttons keep their background on this WebView',
);
shot('home');

// 4. The D-pad moves focus, and comes back.
await key('DPAD_RIGHT');
check(!(await focused()).includes('Host an event'), 'D-pad right moves focus');
await key('DPAD_LEFT');
check((await focused()).includes('Host an event'), 'D-pad left moves it back');

// 5. OK hosts an event; the join QR stays on screen.
await key('DPAD_CENTER');
await until(`location.pathname.startsWith('/admin/')`, 'OK hosts an event');
await until(`!!document.querySelector('.tv-join .qr')`, 'big-screen join QR shown');
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
