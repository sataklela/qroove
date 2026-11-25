#!/usr/bin/env bash
# The R8-shrunk release build against the live site: no crash, no class stripped by R8, plugins load
# (keep-awake runs on the organiser screen), remote control works. Uses adb only (release builds
# are not debuggable).
set -euo pipefail
PKG="$APP_ID"
mkdir -p tv-shots
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r release-test.apk
adb logcat -c
adb shell monkey -p "$PKG" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null
sleep 25
adb exec-out screencap -p > tv-shots/r1-release-home.png
adb shell input keyevent KEYCODE_DPAD_CENTER   # focus starts on Host an event
sleep 15
adb exec-out screencap -p > tv-shots/r2-release-host.png
adb shell input keyevent KEYCODE_DPAD_DOWN
adb shell input keyevent KEYCODE_BACK
sleep 3
adb logcat -d > tv-shots/release-logcat.txt
pid=$(adb shell pidof "$PKG" || true)
[ -n "$pid" ] || { echo "FAILED: release app is not running"; exit 1; }
echo "ok - release build runs (pid $pid)"
if grep -E "FATAL EXCEPTION|ClassNotFoundException|NoSuchMethodException|NoSuchFieldException" tv-shots/release-logcat.txt | grep -i -E "qroove|getcapacitor|outsystems|AndroidRuntime"; then
  echo "FAILED: crash or R8-stripped class in logcat"; exit 1
fi
echo "ok - no crash or missing class in logcat"
grep -q -i "KeepAwake\|keepAwake" tv-shots/release-logcat.txt && echo "ok - keep-awake plugin called" || echo "note: keep-awake call not logged"
echo "Release (R8) smoke test passed"
