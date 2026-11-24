# Android app

Qroove works in any phone browser, and guests never need anything else. The Android app is for
**organisers who run the music from an Android phone**. It is the same Qroove, with a few extras:

- the screen stays on while you host, even in battery saver;
- songs carry on through a weak or dropped connection (up to 2 songs), then catch up;
- room QR codes and links open straight in the app, and **Scan QR** is on the home screen;
- the playing song picks up where it was if the app is closed and reopened.

Everything you can do in the app you can also do in the browser, and the other way round. An
organiser in the app and guests in their browsers (or the reverse) see the same event.

Needs **Android 8 or later**. Not on Google Play yet.

## Install

1. On your Android phone, open **[sataklela.com/case-studies/qroove](https://sataklela.com/case-studies/qroove)**
   and tap **Download for Android**. (The button is only shown on Android phones.)
2. When the download finishes, tap the file `qroove-….apk` (in the notification, or in **Files →
   Downloads**).
3. Android says the app is from an unknown source. Tap **Settings**, switch on **Allow from this
   source** for your browser (or Files app), go back and tap **Install**. You only do this once.
4. If Play Protect asks to scan the app, let it. If it says the app is unrecognised, tap **More
   details → Install anyway**. Qroove is open source and signed by Sataklela; it is unrecognised
   only because it is not on Google Play.
5. Open **Qroove** from your app drawer.

Optional check: the case study page shows the file's SHA-256 next to the download. The same list
is in `SHA256SUMS` on the [GitHub release](https://github.com/sataklela/qroove/releases/latest).

## Update

Most changes need no update: the app shows the live site, so it picks up fixes the next time it
opens. When a new app version is out, download it from the same page and install it over the old
one. Your events and sign-ins stay.

## Use it

- **Host:** tap **Host an event**. Keep Qroove open on screen while the music plays.
- **Join a room:** tap **Scan QR**, or type the code, or open the room link from a message.
- **Sign in:** under **Add a song → My YouTube playlist → Google**. The sign-in opens in a browser
  tab and brings you back to the app. Spotify (pilot accounts only) is under **More**.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| No **Download for Android** button | It is only shown on Android phones. On a computer or iPhone, use [qroove.sataklela.com](https://qroove.sataklela.com) in the browser instead. |
| "App not installed" or "conflicts with an existing package" | An older test copy signed differently is installed. Uninstall **Qroove** (long-press the icon → **Uninstall**), then install again. |
| "There was a problem parsing the package" | The download did not finish. Delete the file and download it again on Wi-Fi. Check the phone has Android 8 or later. |
| Blocked by Play Protect | Tap **More details → Install anyway**. If there is no such option, open the Play Store → profile → **Play Protect → settings** and allow it for this install, then switch it back on. |
| Install button greyed out | Close any screen overlay (chat bubbles, screen dimmers, blue-light filters) and try again. |
| A room link opens the browser, not the app | Open **Settings → Apps → Qroove → Open by default**, switch on **Open supported links**, and make sure `qroove.sataklela.com` is ticked. |
| Google sign-in does not come back to the app | Make sure Chrome (or your default browser) is installed and up to date, then try again. If it keeps failing, close the browser tab and sign in again from the app. |
| "No network: playing on" | Expected on a weak connection: the next song still plays and the app catches up when the network returns. After 2 songs without a connection it waits. Move closer to the Wi-Fi or switch to mobile data. |
| A song is skipped with "could not be played here" | Its video does not allow playing outside YouTube (or Spotify offered only a preview). Qroove moves on to the next song by itself; the requester gets their slot back. |
| The screen turns off | Keep Qroove on screen (not in the background) and the phone on a charger. Some phones also need **Settings → Battery → Qroove → Unrestricted**. |
| Music stops when you switch apps | Android may pause web audio in the background. Come back to Qroove and keep it on screen while you host. |
| Blank or "can't reach Qroove" screen | No connection at first start. Connect to the internet and reopen the app. |

Still stuck? Open the site in the phone's browser instead (it does everything the app does), and
[open an issue](https://github.com/sataklela/qroove/issues) with your phone model and Android
version.
