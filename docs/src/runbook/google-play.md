# Google Play release

Qroove ships on Google Play from the **Sataklela OÜ developer account** (account number
`7573277390553804933`, Play Console → [play.google.com/console](https://play.google.com/console)).
The same account publishes every Sataklela app. The APK on GitHub Releases and the case study stays
as well (ADR 0029).

**Status (2026-11-25):** account created, identity verification pending at Google. Nothing can be
published until it clears. Everything below that does not need the console is ready.

## What is ready in the repo

| Item                       | Where                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Signed app bundle (`.aab`) | CI `android.yml` builds `qroove-<version>.aab` next to the APK on every `v*` tag      |
| Package name               | `com.sataklela.qroove` (`BRAND.android`) — cannot change after the first upload       |
| Target / min SDK           | 36 / 26 (Play requires target ≥ 35 for new apps in 2026)                              |
| App icon 512×512           | `apps/mobile/play/icon-512.png`                                                       |
| Feature graphic 1024×500   | `apps/mobile/play/feature-graphic-1024x500.png`                                       |
| Phone screenshots          | `apps/mobile/play/phone-*.png` (replace with in-event shots: queue, player, add song) |
| Privacy policy URL         | `https://qroove.sataklela.com/docs/privacy`                                           |

## Signing: Play App Signing

Play requires Play App Signing. Use our existing key as the **upload key** and let Google create the
app signing key (the default). Never regenerate `/srv/qroove/secrets/qroove-release.jks`: it still
signs the APKs on GitHub and is the upload key.

After the first upload, copy **Setup → App signing → App signing key certificate → SHA-256** and
**append** it to the Coolify variable `ANDROID_CERT_SHA256` (comma-separated, keep the existing one),
then redeploy. Otherwise room links will not open the Play-installed app.

Note: a Play install and a GitHub APK install are signed differently, so one cannot update the other.
Users switching must uninstall first (the Android guide already covers "App not installed").

## First release, step by step (once verification clears)

1. **Create app:** name _Qroove_, app, free, default language English (UK).
2. **App content:**
   - Privacy policy: URL above.
   - Ads: no ads.
   - App access: all functions available without login (Google sign-in is optional).
   - Content rating questionnaire: category _Utility/Productivity_ (music queue); no violence, sexual
     content, gambling; users can interact (song requests show a random codename) — answer yes to
     "users can share content", no to unrestricted chat.
   - Target audience: 18+ (event organisers and dancers); not designed for children.
   - Data safety (from `docs/src/privacy.md`): collects _app activity_ (song requests) and _device
     ids_ (random participant id), not shared, encrypted in transit, deletable (purged 30 days after
     the event). Optional Google sign-in: stores an encrypted YouTube token server-side for playlist
     reading. No location, contacts, payments, analytics or ads.
   - Government / financial / health features: none.
3. **Store listing:** short description (≤80):
   _A fair song queue for dance socials: guests request, everyone gets a turn._
   Full description: from `docs/src/index.md` (guests join by QR, fair rotation, organiser player with
   YouTube/Spotify/local files, gapless and works through weak Wi-Fi). Graphics from `apps/mobile/play/`.
   Category _Music & Audio_. Contact e-mail: the Sataklela support address.
4. **Testing first (required for new personal accounts; recommended anyway):** create a **closed
   test** track, upload `qroove-<version>.aab` from the GitHub release, add ≥12 testers for 14 days
   if the console asks for it, then apply for production.
5. Append the Play signing SHA-256 to `ANDROID_CERT_SHA256` (see above) and check
   `https://qroove.sataklela.com/.well-known/assetlinks.json` lists both.
6. Bump `apps/web/package.json` version for every upload (drives `versionCode`; Play rejects repeats).

Publishing to any track is an "ask first" action (CLAUDE.md): the owner confirms each release.

## Play console warnings

- _No deobfuscation file_: fixed from 0.4.1 (R8 map is embedded in the AAB).
- _Native code without debug symbols_: expected and harmless. The `.so` files are Google's prebuilt,
  stripped libraries (barcode scanner, CameraX); there are no symbols to upload.
- Shrinking can break code found by reflection: after each build, smoke-test on a phone (open, Scan QR,
  Google sign-in round trip, keep-awake, back button) before uploading.

## Android TV listing

The same app and bundle serve TVs (from 0.4.1). In Play Console: **Release → Advanced settings →
Form factors → Android TV → Add**, then opt in. Provide the TV banner
(`apps/mobile/play/tv-banner-320x180.png`) and at least one TV screenshot (1920×1080):
`apps/mobile/play/tv-1-home-1920x1080.png`, `tv-2-host-1920x1080.png` (from the CI emulator; the
`android-tv-screens` artifact has fresh ones each run). Google reviews TV apps separately:
everything must work with the D-pad, and the app must not require touch or a camera (both are
declared optional).
