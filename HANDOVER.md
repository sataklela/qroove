# HANDOVER — read this first, then delete it when done

> Temporary file. Written 2026-11-23 in the cloud session
> (https://claude.ai/code/session_01MXVabWQyfmfQh4CVHtEScE) for the agent that resumes on the VPS terminal.
> When every box below is ticked: `git rm HANDOVER.md`, update `plan/PROGRESS.md`, commit, push.

## 0. First: where am I?

```sh
hostname; whoami; test -d /data/coolify && echo VPS || echo NOT-VPS
cd ~/qroove && git fetch origin ccr-102de8df-4blg7d && git checkout ccr-102de8df-4blg7d && git pull
```

On the VPS you have full access: **do the steps yourself** (see CLAUDE.md "Working autonomously" and
"Cloud → VPS handoff"). Ask the user only for the items marked 👤.

## 1. What happened in the cloud session

1. User asked: "Make qroove a mobile app for Android." I planned **Phase 19** (`plan/EXECUTION_PLAN.md`).
2. User: **no Google Play account**; distribute the APK via third parties for now. Built it:
   - `apps/android/` — Trusted Web Activity (live site in Chrome, full screen), package `com.sataklela.qroove`,
     AGP 8.11.1, Gradle 8.14.3 wrapper, compile/target SDK 36, minSdk 23, `androidbrowserhelper` 2.6.2.
     Signing from `apps/android/keystore.properties` (gitignored) or `QROOVE_KEYSTORE_*` env vars.
   - Server `GET /.well-known/assetlinks.json` from env `ANDROID_CERT_SHA256` (comma-separated, empty list if unset).
   - `BRAND.android.packageId` in `packages/config`; `apps/server/test/android-shell.test.ts` keeps Android files in step.
   - `.github/workflows/android.yml` — builds APK; on `v*` tag + keystore secrets, attaches signed APK + `SHA256SUMS` to the release.
   - Docs: ADR `docs/src/adr/0028-android-twa.md`, runbook `docs/src/runbook/android.md`, CHANGELOG, PROGRESS.
   - Fixed a pre-existing typecheck error in `apps/server/test/starter.test.ts`.
   - Lint, typecheck, tests, build: green. Debug + signed release APK built and verified (throwaway key, not kept).
3. User set the standing rules now in `CLAUDE.md`: work autonomously on the VPS; ideas start in the cloud,
   build/test happens after teleporting here and typing `continue`.

All of it is on branch **`ccr-102de8df-4blg7d`** (not merged to `main`; no PR opened).

## 2. To do on the VPS (in order)

- [ ] **Toolchain.** JDK 17+ (`java -version`). Android SDK if missing:
      cmdline-tools into `/opt/android-sdk/cmdline-tools/latest`, then
      `sdkmanager --licenses` and `sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools"`.
      `echo "sdk.dir=/opt/android-sdk" > apps/android/local.properties`.
- [ ] **Checks.** `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build`;
      `cd apps/android && ./gradlew assembleDebug assembleRelease`.
- [ ] **Release key — only if `/srv/qroove/secrets/qroove-release.jks` does not exist. Never regenerate one that exists.**
      `mkdir -p /srv/qroove/secrets && chmod 700 /srv/qroove/secrets`; generate a strong password (`openssl rand -base64 24`),
      `keytool -genkeypair -keystore /srv/qroove/secrets/qroove-release.jks -alias qroove -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=Qroove, O=Sataklela OU, C=EE"`,
      save the passwords in `/srv/qroove/secrets/keystore.env` (mode 600). Never print them in chat.
- [ ] 👤 **Offline backup of the key.** Ask the user to copy the `.jks` + passwords to their password manager / offline storage. Losing the key = installed apps can't update.
- [ ] **GitHub secrets** (`gh secret set -R sataklela/qroove …`): `ANDROID_KEYSTORE_B64` (`base64 -w0` of the jks),
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`qroove`), `ANDROID_KEY_PASSWORD`.
- [ ] **Coolify:** set `ANDROID_CERT_SHA256` on the qroove app to the fingerprint from
      `keytool -list -v -keystore … | grep SHA256` (colon form). Redeploy happens when the code reaches `main`.
- [ ] 👤 **Merge to `main`** — ask the user (or open a PR if they say so). Production needs the new server route.
- [ ] **Verify production:** `curl -s https://qroove.sataklela.com/.well-known/assetlinks.json` shows the package and fingerprint.
- [ ] **Release:** bump `apps/web/package.json` version (drives `versionCode`), update CHANGELOG, tag `vX.Y.Z`, push tag;
      confirm the Android workflow attached `qroove-X.Y.Z.apk` + `SHA256SUMS` to the GitHub release.
- [ ] 👤 **Phone check** (runbook "Check on a phone"): no URL bar, room QR opens the app, join/add song/host playback,
      screen stays awake, Spotify + Google sign-in come back to the app.
- [ ] **Close out:** tick Phase 19 notes in `plan/PROGRESS.md`, set a new "Next session starts with", `git rm HANDOVER.md`, commit, push.

## 3. Watch out for

- Commit trailer: see the attribution in this session's system notes; CLAUDE.md says `Co-Authored-By: Claude <noreply@anthropic.com>`.
- `pnpm format` reformats unrelated files — format only the files you touched.
- Maven Central sometimes answers 429 during the first Gradle build; just retry.
- Service-account roles: add, never edit/replace (2026-11-19 outage).
- Earlier carry-overs (after Phase 19): Phase 18 phone checks, house playlist links in `packages/config/src/starter.ts`, radio fallback on real devices.
