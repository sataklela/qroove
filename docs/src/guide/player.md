# Player guide

The organiser's device plays the music. There is no separate player page: the organiser page takes the player role by
itself, and a second device with organiser access takes over from the first. After a handover, the new organiser's device
becomes the player.

## Pausing and skipping

**Pause At End of Current Song** lets the song finish, then holds the queue. **Resume Playback** starts the next song. **Skip** asks twice, because the song is lost and the queue changes.

## Starting

Tap **Log in with Spotify** once on the organiser's device, with a Premium account that is on the pilot list. The page then plays the music itself. If that cannot start on your device, Spotify's embedded player is used instead.

If Spotify cannot play a song in full (no Premium login, a refused account, or only a 30-second preview), the page plays the same recording from YouTube instead, in YouTube's own embedded player. Nothing changes on screen except a line saying so. If YouTube shows an advert, it plays as YouTube serves it; Qroove does not mute, skip or change it. It needs `YOUTUBE_API_KEY` on the server; without it Spotify's behaviour is unchanged.

Press **Start playing** at the top of the organiser page. Browsers need one tap before they play sound; after that, songs
start by themselves. **Keep the page open**, because the music stops if you leave it.

Under **More** you will find an optional test chime and **Sound check and audio files**, where you can pick files or a
folder. They are read in the browser and **never uploaded**.

Each requested song is matched to a file by the same artist/title/version fingerprint the server uses for
duplicates, so `Marc Anthony - Vivir Mi Vida.mp3` matches a request for "Vivir Mi Vida (feat. X)" by Marc
Anthony. Embedded tags are read first, with the file name (`Artist - Title`) as the fallback. If either side
has no artist the match is shown as _probable (title only)_. A "Live" or "Remix" version never matches the
studio request. You can also pick a file for a single song by hand.

## Playing

- The song reserved next is shown with its match status. Press **Start** once: the first tap unlocks audio
  on phones and tablets. After that, the next reserved songs start by themselves.
- A song counts as played only when audio actually begins (the browser's `playing` event) and is finished
  when the file ends. A song that fails to play after starting is recorded as skipped.
- **A song that cannot play here is skipped by itself** (its video blocks embedding, Spotify offers only a
  preview, the file will not open): it is taken out of the queue, its requester gets the slot back and sees
  "Skipped: it could not be played here", and the next song starts with no tap. Only if the server cannot be
  reached does the card fall back to manual mode for it.
- After a reload or an app restart the playing song carries on from where it should be (YouTube and local
  files; a Spotify song needs **Mark ended**).
- **Manual mode** (no matching file): open the requester's link, play it however you are allowed to, then
  press **Mark started** and, when it finishes, **Mark ended**. A manually started song counts for fairness
  and duplicates like any other. Qroove never marks a song ended because a timer ran out, and it cannot
  promise ad-free playback for a link.
- The lock screen and Bluetooth headset buttons can play and pause.
- **The screen stays on** for as long as this device is the player of a running event: during songs, between
  them and while the radio plays. It needs the Qroove page to be the one on screen, and the browser to allow
  it (a phone in battery-saver mode usually refuses, and then the phone's own screen timeout applies). Keep
  the phone on a charger.

## Lease and handover

The player holds a lease that it renews every 10 seconds. If another device claims it, this one stops
immediately and says _Another device took over playback_. A song cannot be handed over mid-track, because
the file may exist only on the old device; the new device starts at the next song once its owner has
checked it has the music. Reloading the page keeps the lease for the browser tab.

## Radio fallback

Radio fallback keeps the room playing when no guest song is due. It is on by default; the _Radio fallback_ tick box is on the **More** page (swipe to the third page). It begins at once when the page opens unless a guest song is already queued; if the browser refuses sound without a tap, a single **Start radio** button appears. From then on it starts whenever nothing is due, including when one genre is held back by the run limit: the other genre's station fills the gap so the balance catches up. Pause fades it out over 4 seconds and Resume fades it back in over 4 seconds (the sound simply ends on an iPhone, which ignores volume changes). The player shows the station, the genre and the track title (or "track
information unavailable"). When a guest song becomes due it starts when the station's current track ends,
at the latest after 4 minutes, or at once if you press **Play the queued song now**. The station may play
hour-long DJ mixes, which is why the 4-minute limit exists. Guests see "Radio fallback" on _Now playing_.
Radio tracks are not anyone's request and never use anyone's allowance; they can change the genre the
queue sees as last played but never count toward a run. Stations are listed in `packages/config/src/radio.ts`.
Only Bachata Sensual Radio is on; see [ADR 0023](/adr/0023-radio-fallback).

A station is a live connection, so it is more fragile than a song when the phone sleeps. If its sound
stops without an error for about 16 seconds, the player connects to it again by itself; if the browser
refused to start sound while the page was out of view, it tries once more when you return to the page.

## Tips

- **Bluetooth:** connect and choose the output in the device's own settings before the sound check; the
  browser cannot choose or fix the route. Disable sleep and keep the device charging.
- **iPhone and iPad:** audio only starts after a tap, and playback can be suspended if the screen locks or
  the tab is in the background. A laptop with local files is more reliable than a phone.
- **Remember on this device** copies the files into the browser's private storage so you need not choose
  them again. Only use it if the music owner allows copies, and untick it to delete them. Browsers may
  remove stored files at any time; just choose them again.

## Rights

Only play recordings you are licensed to play at the venue. Public performance may need licences beyond
owning the file or having a streaming subscription; check with the society or venue before using Qroove at
a live event.
