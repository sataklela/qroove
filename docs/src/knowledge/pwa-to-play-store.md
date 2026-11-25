# PWA → Play-ready Android app (decision tree)

How Qroove went from a web app (PWA) to an Android app ready for Google Play, phones and TVs, up to
version 0.4.1 (November 2026). Written to be **reused for the next Sataklela app**: read the tree, then
the "Next app" checklist, and copy the Qroove files it points to. Detailed reasoning for the big
choices is in the ADRs linked below.

Status: 0.4.0 submitted to Google Play (closed testing; account `7573277390553804933` pending
verification at the time); 0.4.1 adds R8 shrinking and Android TV.

## The tree

```text
Web app (PWA) works in any browser
│
├─ Q1 Do organisers need things a browser can't do reliably?
│     (screen on in battery saver, survive weak Wi-Fi, scan QR, open room links in an app)
│     └─ YES → build an Android app.  Guests stay on the web (no install for them).
│
├─ Q2 Which wrapper?                                     → ADR 0028 (TWA), ADR 0029 (Capacitor)
│     ├─ Native rewrite ............ no: two codebases, the site and app would drift apart
│     ├─ TWA (site inside Chrome) .. tried, never released: no native keep-awake, no camera
│     │                               plugin, Chrome UI quirks
│     └─ Capacitor ................. CHOSEN
│           └─ Q2a Bundle the web files or load the live site?
│                 └─ Remote URL (server.url = live site) CHOSEN: same origin, so cookies,
│                    CSRF, SSE, YouTube referrer checks and the service worker work unchanged;
│                    every web deploy updates the app; offline start → bundled error page.
│
├─ Q3 Sign-in: Google blocks OAuth inside WebViews
│     └─ Custom Tab + one-time code (60 s, single use) back via custom scheme → app redeems
│        it for the same cookie.  (apps/server/src/api/appHandoff.ts)
│
├─ Q4 Weak network: can we cache the music?
│     ├─ Cache YouTube/Spotify audio ... NO, never (their terms; repo rule)
│     └─ Reserve the next song early + play locally + report later (outbox), max 2 songs
│        without the server; auto-skip unplayable songs.   (apps/web/src/player/outbox.ts)
│
├─ Q5 Native features without making site and app differ
│     └─ One module, apps/web/src/shared/native.ts: every function has a web fallback.
│
├─ Q6 Signing & versions
│     ├─ Release key created once on the server (/srv/qroove/secrets/, + owner's offline backup),
│     │  NEVER regenerated; 4 GitHub secrets for CI; cert SHA-256 in ANDROID_CERT_SHA256.
│     └─ versionCode = major*10000 + minor*100 + patch from apps/web/package.json.
│
├─ Q7 How to test on a real device from a VPS with no KVM (no emulator)?
│     └─ Phone: Wireless debugging + Tailscale → adb from the VPS → adb forward the WebView
│        devtools socket → Playwright connectOverCDP.  (runbook/android.md)
│        TV/projector without Wireless debugging: one-off USB `adb tcpip 5555`.
│        Emulators: GitHub-hosted runners have KVM → run them in CI.
│
├─ Q8 Distribution before Play
│     ├─ GitHub Release (APK + SHA256SUMS) built by CI on a v* tag.
│     └─ Download on sataklela.com/case-studies/qroove, shown to Android visitors only
│        (user-agent check, Vary: User-Agent, private/no-store so no cache serves it to others).
│
├─ Q9 Google Play
│     ├─ Upload format ....... AAB (CI builds it next to the APK)
│     ├─ Signing ............. Play App Signing; our key = upload key; append Play's signing
│     │                        SHA-256 to assetlinks (comma list) after the first upload
│     ├─ Target SDK .......... 36 (Play's minimum for new apps is 35 in 2026)
│     ├─ Listing ............. icon 512, feature graphic 1024×500, ≥2 phone screenshots,
│     │                        privacy URL, terms URL (/terms added for this)
│     ├─ App access .......... "Yes, restricted" (room codes/QR) + instructions: no login needed,
│     │                        host an event to get a code
│     ├─ Advertising ID ...... No (checked merged manifest + dex for AD_ID / AdvertisingIdClient)
│     ├─ Data safety ......... from docs/src/privacy.md
│     ├─ Release notes ....... en-GB + nl/de/et/fr (Play auto-translation via Gemini is fine)
│     └─ Console warnings .... "no deobfuscation file" → R8 in 0.4.1 (map embedded in AAB);
│                               "no native debug symbols" → expected: only Google's prebuilt,
│                               stripped libraries (ML Kit barcode, CameraX)
│
└─ Q10 Android TV / projectors (0.4.1)
      ├─ Show on TV home ..... LEANBACK_LAUNCHER filter, 320×180 banner, camera/touchscreen
      │                        required=false (CAMERA permission otherwise hides the app on TV)
      ├─ Detect TV ........... MainActivity adds "LeanbackShell" to the WebView UA in TV mode;
      │                        web isTv() (also ?tv=1 for browsers/laptops on projectors)
      ├─ Remote control ...... WICG spatial-navigation polyfill (TV only), page's main action
      │                        gets focus (data-tv-focus), Back closes sheets first
      ├─ Test ................ Android 11 TV emulator in CI (runner has KVM) drives a debug build
      │                        pointed at the branch server; browser TV test at 960×540
      └─ 10-foot layout ...... overscan-safe padding (48/27 dp), bigger type and targets,
                               always-visible focus ring, host screen with a large join QR
```

## Decisions at a glance

| #   | Question              | Options considered                         | Chosen                                             | Why                                                        | Where                               |
| --- | --------------------- | ------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------- |
| 1   | App at all?           | Stay PWA · app                             | App for organisers                                 | Keep-awake, weak network, QR, app links                    | ADR 0029                            |
| 2   | Wrapper               | Native · TWA · Capacitor                   | Capacitor                                          | One codebase; native plugins; TWA lacked them              | ADR 0028, 0029                      |
| 3   | Assets                | Bundled · remote URL                       | Remote URL                                         | Same origin keeps auth/SSE/embeds working; instant updates | `apps/mobile/capacitor.config.json` |
| 4   | OAuth                 | WebView · Custom Tab                       | Custom Tab + one-time code                         | Google blocks WebView sign-in                              | `appHandoff.ts`                     |
| 5   | Offline music         | Cache audio · reserve ahead                | Reserve ahead + outbox (2 songs)                   | Caching breaks YouTube/Spotify terms                       | `outbox.ts`, ADR 0029               |
| 6   | Native calls          | Direct plugin use · one wrapper            | `native.ts` with web fallbacks                     | Site and app never differ                                  | `apps/web/src/shared/native.ts`     |
| 7   | Key                   | Per-build · one kept key                   | One key on the server, never regenerated           | Updates need the same key                                  | `runbook/android.md`                |
| 8   | Versions              | Manual · derived                           | Derived from `package.json`                        | One number to bump                                         | `app/build.gradle`                  |
| 9   | Device QA             | Emulator · real device                     | Real phone over Tailscale + CDP; TV emulator in CI | VPS has no KVM                                             | `runbook/android.md`                |
| 10  | Pre-Play distribution | Store · direct                             | GitHub Release + Android-only case-study download  | Works before Play approval                                 | sataklela PR #76                    |
| 11  | Play package          | APK · AAB                                  | AAB (+ APK for sideload)                           | Play requires AAB                                          | `.github/workflows/android.yml`     |
| 12  | Play signing          | Upload our key as app key · Google-managed | Google-managed, ours = upload key                  | Default, recoverable                                       | `runbook/google-play.md`            |
| 13  | App links on Play     | One cert · both                            | Both SHA-256s in `ANDROID_CERT_SHA256`             | Play re-signs the app                                      | `apps/server/src/app.ts`            |
| 14  | App access            | No · Yes + instructions                    | Yes + "no login needed" steps                      | Codes/QR count as restricted                               | `runbook/google-play.md`            |
| 15  | AD_ID                 | Yes · No                                   | No                                                 | Verified absent in manifest and code                       | this page                           |
| 16  | Shrinking             | Off · R8                                   | R8 from 0.4.1                                      | Smaller (AAB 20.5 → 15.5 MB), clears warning               | Qroove PR #26                       |
| 17  | Terms                 | None · page                                | `/terms` in app + docs                             | Play listing and users                                     | Qroove PR #27                       |
| 18  | TV                    | Separate app · same app                    | Same app, TV mode                                  | One build, one listing                                     | Qroove 0.4.1                        |

## Gotchas that cost time

- **Google sign-in inside a WebView is blocked**: use a Custom Tab; cookies there are not shared
  with the WebView, hence the one-time code.
- **YouTube's "confirm you're not a bot" wall** for datacenter IPs: YouTube playback can't be tested
  from the VPS browser; test on a phone or laptop.
- **R8 and reflection**: Capacitor finds plugins by reflection; keep rules in
  `proguard-rules.pro`; the barcode plugin needs `-dontwarn com.google.gson.annotations.SerializedName`.
  Always smoke-test a shrunk build on a device before release.
- **Spatial-navigation polyfill hooks keys on window `load`**: when loaded later (dynamic import),
  catch its `load` listener and run it (see `setUpTv` in `native.ts`).
- **TV WebViews are old**: the Android 11 TV image ships WebView 90 (real projectors may too). It has
  no `color-mix()` (buttons lost their background → invisible text) and no `dvh` units; added
  `@supports not (color: color-mix(...))` fallbacks and `vh` before every `dvh`. Playwright's
  `connectOverCDP` also fails on it, so the TV smoke test speaks raw CDP over a WebSocket.
- **`focus()` silently fails** on controls inside a closed `<details>` or disabled: try candidates
  until one really takes focus.
- **CSS class on `<body>`**: `.console` matched both `body.console` and `div.console`; scope selectors.
- **Projector with Android 11 and no Wireless debugging menu**: network adb needs one USB
  `adb tcpip 5555`; an open port may be another service (here a casting server).
- **VS Code CLI self-update** left the tunnel running the deleted old binary:
  `XDG_RUNTIME_DIR=/run/user/0 systemctl --user restart code-tunnel`.
- **`sataklela.com` redirects to `www`** (use `curl -L`); behind Coolify `req.url` is the container
  address, so redirects must be relative.
- **GitHub API 502s** during merges: retry with the REST API; check the branch still exists.

## Next app: the checklist

1. Confirm the app is needed (Q1). If only installability is wanted, a PWA may be enough.
2. Copy `apps/mobile/` (Capacitor, remote URL), `native.ts`, the Custom Tab sign-in handoff and the
   assetlinks route; change the package id in the brand config.
3. Create the release key **once** on the server; record where it lives; add the CI secrets.
4. Copy `.github/workflows/android.yml` (APK + AAB + SHA256SUMS on `v*` tags).
5. Set up real-device QA (Tailscale + wireless adb) using `runbook/android.md`.
6. Write the user guide (`guide/android.md` pattern) and, if wanted, the Android-only download on
   sataklela.com (`lib/qroove-release.ts` pattern).
7. Play: follow `runbook/google-play.md` (same developer account for every Sataklela app):
   listing assets, privacy + terms URLs, app access, data safety, AD_ID, content rating, closed test.
8. Turn on R8 with keep rules; smoke-test the shrunk build on a device.
9. TV (optional): leanback filter, banner, optional camera/touch, TV mode in the web app.
10. Add or update this page's tree, and the org index (`sataklela/docs/knowledge/README.md`).
