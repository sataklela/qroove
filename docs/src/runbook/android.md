# Android app

The Android app (`apps/mobile`) is a Capacitor shell that opens the live site
(`https://qroove.sataklela.com`) in a WebView, with native extras: sign-in in a Custom Tab, a QR
scanner, room links that open the app, and the screen kept on. See [ADR 0029](/adr/0029-android-capacitor).
It runs on phones, tablets and Android TV / projectors (Android 8 or later). It is distributed as an APK
(GitHub Releases, and the sataklela.com case study for Android visitors) and as an AAB on Google Play
(see [Google Play release](/runbook/google-play)).

## Build

Needs Node, pnpm, JDK 21 and the Android SDK (platform 36, build-tools 36). On the VPS: JDK from
apt, SDK in `/opt/android-sdk`.

```sh
pnpm install
cd apps/mobile
echo "sdk.dir=/opt/android-sdk" > android/local.properties
pnpm exec cap sync android
cd android
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk (for testing)
./gradlew assembleRelease    # signed if a keystore is configured, else *-unsigned.apk
```

`versionName` comes from `apps/web/package.json`; `versionCode` is `major*10000 + minor*100 + patch`
(override with `QROOVE_VERSION_CODE`). **Bump the web version before each APK you hand out**, or
phones will not update. Icons and splash: `node scripts/android-icons.mjs`.

## Release key (once — never regenerate)

The key lives on the VPS in `/srv/qroove/secrets/` (`qroove-release.jks`, passwords in
`keystore.env`, mode 600) and in the owner's offline backup. Local builds read
`apps/mobile/android/keystore.properties` (gitignored):

```properties
storeFile=/srv/qroove/secrets/qroove-release.jks
storePassword=…
keyAlias=qroove
keyPassword=…
```

CI reads the GitHub secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Link the app to the site

Room links and QR codes (`/e/…`, `/a/…`, `/admin/…`, `/claim/…`, `/h/…`) open the app when the
site vouches for it. Put the key's SHA-256 (colon form) into `ANDROID_CERT_SHA256` on the Coolify
app (comma-separate several, e.g. old and new key) and redeploy. Check:

```sh
keytool -list -v -keystore /srv/qroove/secrets/qroove-release.jks -alias qroove | grep SHA256
curl https://qroove.sataklela.com/.well-known/assetlinks.json
```

## Publish

1. Bump `apps/web/package.json`, merge, tag `vX.Y.Z` and push the tag.
2. The **Android** workflow attaches `qroove-X.Y.Z.apk` and `SHA256SUMS` to the GitHub release.
3. Share the release link or upload the same APK to the third-party store(s). Always the same key.

Users allow "Install unknown apps" for their browser or file manager the first time.

## Check on a phone

With wireless debugging on, from the VPS (through Tailscale): `adb pair <ip>:<port>`,
`adb connect <ip>:<port>`, `adb install -r app-debug.apk`. The WebView can be driven with
Playwright: `adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof com.sataklela.qroove)`
then `chromium.connectOverCDP('http://localhost:9222')`. Simulate a network drop with CDP network
emulation in the WebView, not by switching Wi-Fi off (that drops adb too).

- A room QR (camera app, or **Scan QR** in the app) opens the room in the app.
- **Google** sign-in under My YouTube playlist goes out to a Custom Tab and comes back signed in;
  **More → Spotify** likewise.
- Host an event; songs advance with no tap; the screen stays on.
- Turn the network off mid-song: the next song starts on time; one more follows; then
  "No network: waiting to reconnect". Network back: the organiser and guest views catch up.

## Android TV QA

- **Emulator:** the `android-tv` job in `.github/workflows/android.yml` boots an Android 11 TV emulator
  on GitHub's runners (they have KVM; the VPS does not), installs a debug build pointed at the branch's
  own server, and drives it with D-pad key events (`tests/android-tv/smoke.mjs`). Screenshots are in the
  `android-tv-screens` artifact.
- **Browser:** `tests/e2e/tv.spec.ts` runs the web TV mode at 960×540 with arrow keys only.
- **Real TV / projector:** if Developer options has **Wireless debugging**, pair as with a phone. If it
  only has **USB debugging** (common on Android 11 TVs and projectors), connect a laptop by USB once,
  run `adb tcpip 5555`, unplug, then `adb connect <tailscale-ip>:5555` from the VPS. It lasts until the
  device restarts.
