# Privacy

Qroove needs no account. This page says what is stored and for how long.

## What is stored

| Data                                            | Why                                      | Notes                                       |
| ----------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| A random participant id and a hash of its token | So you can see and remove your own songs | The token itself lives only in your browser |
| Codename (given when the page opens)            | Shows the organiser who added each song  | Two random words; you type nothing          |
| Songs you request (title, artist, style, link)  | To run the queue                         | Link tracking parameters are stripped       |
| Audit records                                   | To resolve disputes                      | Actions and ids; never secrets              |
| Your IP address                                 | Rate limiting, in server memory only     | Not written to the database                 |

No audio is stored, uploaded or streamed by Qroove. There are no advertising or analytics trackers.

## Retention

Participant records (token hashes) and nicknames are deleted 30 days after an event ends, abandoned drafts after
7 days and audit records after 90 days. A purge job runs on the server at start-up and every 6 hours.
Exported snapshots contain songs only, never people. Organisers can end an event at any time, which makes it
read-only.

## Third parties

If an organiser logs in with Spotify, a login token is kept in an encrypted cookie on that device for up to 30 days, and is not stored by Qroove. Searching sends your search words to Spotify. Looking up a song link sends only the song id to Spotify, Apple (iTunes Lookup) or YouTube. Hosting is on
a server Sataklela rents and runs itself, and the database on Google Cloud Firestore (EU multi-region).

## Google user data

Signing in with Google (scope `youtube.readonly`) is optional and only lets a guest pick songs from their own YouTube playlists. The full disclosures — what is accessed, how it is used, sharing, protection, retention and deletion, and Limited Use compliance — are on the app's [privacy page](https://qroove.sataklela.com/privacy). In short: playlist names and ids, video ids, titles, channel names and lengths are read on request and not stored; the refresh token is sealed (AES-256-GCM) in an HttpOnly cookie on the guest's device for up to 180 days and never stored server-side; nothing is sold or shared.
