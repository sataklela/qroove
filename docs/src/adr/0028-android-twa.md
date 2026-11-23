# ADR 0028 — Android app as a Trusted Web Activity, sideloaded

**Status:** accepted · **Date:** 2026-11-23

## Context

Organisers and guests want an Android app on the home screen. There is no Google Play account; the app is handed out directly (APK download, GitHub Releases, third-party stores such as F-Droid-style repos or APKPure).

## Decision

- **Trusted Web Activity** (`apps/android`, built on Google's `androidbrowserhelper`): the app opens the live site in the phone's Chrome, full screen. No second codebase; every web deploy updates the app.
- Not Capacitor/WebView: the app must run on `qroove.sataklela.com` itself, because event cookies are `SameSite=Strict`, Spotify/Google sign-in redirect back to that origin, and YouTube embeds, Wake Lock and the service worker need a real browser.
- **Our own signing key.** We hold the only release key (no Play App Signing). Its SHA-256 fingerprint goes into `ANDROID_CERT_SHA256` on the server, which serves `/.well-known/assetlinks.json`; Chrome then hides the address bar. Without it the app still works, with a thin URL bar.
- Room links and QR codes (`https://qroove.sataklela.com/...`) open in the app when it is installed (verified app link).
- Without a TWA-capable browser the app falls back to a Custom Tab.
- CI (`.github/workflows/android.yml`) builds the APK; on a `v*` tag with the keystore secrets set it attaches the signed APK and `SHA256SUMS` to the GitHub release.

## Consequences

- **Losing the key means users must uninstall and reinstall** to get updates (Android refuses an update signed by another key). Back it up in two places.
- Updates of the shell are manual (users install a newer APK); the web content updates itself.
- Background audio with the screen off and Android Auto are out of reach; revisit native if needed.
- Moving to Google Play later is possible with the same key (opt out of Play App Signing or upload this key).
