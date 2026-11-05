# Organiser guide

You run an event from your phone. There is no account: control belongs to the browser that created the event (or that took it over by a handover).

## Create an event

Open **Create an event** from the home page (`/new`). Everything is set by spinning drums, tapping swatches and
looking at one bar. There is no name to type: the event gets a generated name of three neutral words, such as
_Mango Octopus Rye_ ([ADR 0013](/adr/0013-generated-event-names)).

- **Three drums in a row:** _Total duration_ (0:15, 0:30, 0:45, 1:00, 1:30, 2:00, 2:30, 3:00, 3:30, 4:00, then whole
  hours to 8:00; starts at 2:00), _Songs in a row_ and _Songs per person_. The clock starts when you open the organiser page: the event starts by itself (the **Start event** button is only there if that failed). Pause is there if you want it.
- **Synced parameters:** while the switch at the top is on, choosing a new total duration also sets songs per person to
  5 for every 15 minutes (never below 5, never above 50 or the most the event may hold). Switch it off to set the two
  independently. Switching it back on changes nothing by itself; the next duration change recalculates.
- **Genres:** one card each for Salsa, Bachata and Cha-cha, with its _non-Latin-compatible_ version as a separate switch
  underneath, and _Other (Musicality Exercise)_ on its own. Salsa, bachata and their non-Latin styles start selected;
  cha-cha is an extra. Colours: red salsa, blue bachata, amber cha-cha, purple Other; non-Latin styles are striped. A
  style and its non-Latin version count as one genre, and each switch is independent of its parent.
- **Visual event progression:** above the bar, a ratio badge, an approximate song count and the rotation drawn
  song by song from the same scheduler the queue uses, with a legend and the same sequence written out ("The rotation as
  text"). The count is a rough guide (one song every 3.5 to 5 minutes of music); the real number depends on what people add.
- **The bar:** the whole evening, always as wide as the screen, with the minutes written above every part and every
  break. **Press and hold a part** to add a 10-minute break in the middle of it (on the 10-minute grid). **Drag a
  break** to move it; drag its **end handle** to make it longer or shorter (10 to 30 minutes, one direction only).
  Tap a break and press ✕ to remove it. You cannot go past the limits: at most 3 breaks, together at most half of
  the time, and at least 20 minutes of music before, between and after, so breaks never touch.
- **Parts of the evening:** each break splits the bar. **Tap a part** of the bar to give it its own styles and
  numbers; new parts start as copies of the one they came from. A song waits for a part that allows its style.
- **Songs in a row** is 1 to 3 (default 1, applied to every genre), and songs per person defaults to 20, in steps of 5, up to 5 for each 15 planned minutes. Under the ratio
  summary you can give each genre its own number; the default is an equal split, and no genre may get less than 1
  part in 10 of the total.
- **Playlists (optional, ♫ +):** paste one link per style from Spotify, YouTube Music, YouTube or Apple Music. The
  songs load into **one list**, mixed so no playlist sits behind another, and you sort it exactly like a guest does:
  drag by the grip, swipe left to remove, swipe right to send a song to the top. Only what fits in the planned time
  minus one minute can be queued (the minutes used are shown); the rest is greyed out below a dashed line and is not
  added. If you add any songs, every genre in the event needs at least one of them: a salsa song or a non-Latin
  salsa song both count for salsa. These are public web pages, so the import is best effort and long playlists are
  cut short.

## After you create it

Pressing **Create event** takes you straight to the organiser page: this browser is signed in automatically and the
secret never appears on screen. There is no link or recovery code to save. The catch is that control belongs to
this browser: if you clear its data or switch phones, you cannot get back in on your own. To change devices on
purpose, use **Hand over** (below) before you leave.

## Run the event

![The organiser page](/screens/admin-dashboard.png){width=280}

- **Starting the event** (automatic when you open the organiser page) locks the rules. After that nothing on the page changes them.
- **Playback:** what is playing, what is next, the style run, and why the queue is waiting if it is. **Pause**
  keeps the next song reserved; **Resume** carries on. **Skip** (with confirmation) ends the current song; it still
  counts as played for fairness and for its owner's quota.
  The organiser page is one screen with three pages you **swipe between sideways** (the dots at the bottom show where
  you are and also work as buttons). Only the queue list scrolls up and down.

- **Playing (first page):** now playing, next, the genre run, why the queue is waiting, and the controls: **Start**,
  **Pause** and **Resume** (icons), **Skip** (two taps; it still counts as played) and **Start break / End break**
  when a break is due. Under them is the queue on its own blue-grey background: every request with its contributor's
  tag. **Remove** (two taps) frees that person's slot. A song marked _Possible duplicate_ is held until you choose
  **Distinct** or **Reject**.
- **Invite (swipe left):** the permanent room code as two triplets (`ABC-123`) for reading out or typing, and a QR
  code as a non-verbal backup. Both open the same page.
- **More (swipe again):** the player, **Hand over**, **Time** (extend the end), **Rules** (read-only) and **End the
  event**.

## Hand over to someone else

**Hand over admin** creates a link that works once, for 10 minutes. Send it privately. When the new organiser
opens it, your access ends immediately, playback pauses, the song in progress counts as played, and they resume
when ready. Changed your mind? Use **Cancel handover and resume**.

If you lose access (a handover, a cleared browser) the organiser page says so; ask the current organiser to hand the
event over to you.

## End the event

**Swipe to More → End the event → End event → Yes, end the event now.** Two separate taps, nothing to type. Ending is
permanent. Songs that never played appear under **Queue** as **Carry over to a new event**: choose which to keep,
optionally shuffle within each style, and create the next event with the same planned time. Carried songs fit in
that time minus one minute. The copies belong to a neutral "system" contributor that follows the same fairness
rules, and you can remove any before starting.

## Past events

`/h/<code>` shows a read-only playlist of everything requested at an event: titles, artists and styles, no names.

## Playing Spotify songs

On the organiser page, a song with a Spotify link plays in Spotify's own player when no local file matches. Use a browser signed in to Spotify Premium, or Spotify offers only a 30-second preview; Qroove then refuses to start the song and offers the link and **Mark started**. You still need the licences to play music at your venue.
