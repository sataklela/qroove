# Android app

The Android app (`apps/android`) is a Trusted Web Activity: the live site in Chrome, full screen. See [ADR 0028](/adr/0028-android-twa). It is distributed outside Google Play.

## Build

Needs JDK 17+ and the Android SDK (platform 36, build-tools 36).

```sh
cd apps/android
echo "sdk.dir=$ANDROID_HOME" > local.properties
./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk (installable for testing)
./gradlew assembleRelease    # signed if a keystore is configured, else *-unsigned.apk
```

`versionName` comes from `apps/web/package.json`; `versionCode` is `major*10000 + minor*100 + patch` (override with `QROOVE_VERSION_CODE`). **Bump the web version before each APK you hand out**, or phones will not update.

## Release key (once)

```sh
keytool -genkeypair -keystore qroove-release.jks -alias qroove \
  -keyalg RSA -keysize 4096 -validity 10000
```

Keep the `.jks` and passwords in the password manager **and** one offline backup. Then either create `apps/android/keystore.properties` (gitignored):

```properties
storeFile=/absolute/path/qroove-release.jks
storePassword=…
keyAlias=qroove
keyPassword=…
```

or set the GitHub secrets `ANDROID_KEYSTORE_B64` (`base64 -w0 qroove-release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Link the app to the site (hides the URL bar)

```sh
keytool -list -v -keystore qroove-release.jks -alias qroove | grep SHA256
```

Set the fingerprint (colon form, e.g. `3B:CC:…`) as `ANDROID_CERT_SHA256` on the server (Coolify → environment variables; comma-separate several, e.g. old and new key). Redeploy, then check:

```sh
curl https://qroove.sataklela.com/.well-known/assetlinks.json
```

Google's checker: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://qroove.sataklela.com&relation=delegate_permission/common.handle_all_urls`.

## Publish

1. Bump `apps/web/package.json` version, merge, tag `vX.Y.Z` and push the tag.
2. The **Android** workflow attaches `qroove-X.Y.Z.apk` and `SHA256SUMS` to the GitHub release.
3. Share the release link, or upload the same APK to the third-party store(s). Always the same key.

Users must allow "Install unknown apps" for their browser or file manager the first time.

## Check on a phone

- Opens with no address bar (if there is one, assetlinks or the fingerprint is wrong; clear Chrome data after fixing).
- Scanning a room QR code with the camera offers to open Qroove.
- Join, add a song, host playback, screen stays awake, Spotify and Google sign-in come back to the app.
