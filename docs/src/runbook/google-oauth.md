# Google sign-in (YouTube playlists)

Needed once, in Google Cloud Console, in the same project that holds `YOUTUBE_API_KEY`. Everything here is done by a person: it cannot be scripted from the repo.

## 1. Enable the API

APIs & Services → Library → **YouTube Data API v3** → Enable (already on if the playback key works).

## 2. Consent screen

APIs & Services → OAuth consent screen (Google Auth platform → Branding / Audience / Data access):

| Field              | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| App name           | Qroove                                                               |
| User support email | a Sataklela contact address                                          |
| App logo           | `brand/` avatar (optional; adding one triggers brand verification)   |
| App home page      | `https://qroove.sataklela.com`                                       |
| Privacy policy     | `https://qroove.sataklela.com/privacy`                               |
| Authorised domain  | `sataklela.com`                                                      |
| Audience           | **External**, publishing status **Testing**                          |
| Data access        | add scope `https://www.googleapis.com/auth/youtube.readonly`         |
| Test users         | the Google accounts of people who should be able to log in (max 100) |

In Testing mode the login screen shows an "unverified app" warning and refresh tokens last 7 days, after which a guest simply logs in again.

## 3. OAuth client

Credentials → Create credentials → OAuth client ID → **Web application**.

- Authorised JavaScript origins: `https://qroove.sataklela.com`
- Authorised redirect URIs: `https://qroove.sataklela.com/api/google/callback` (add `http://localhost:3000/api/google/callback` for local work)

## 4. Railway

```
railway variables --service web --set GOOGLE_CLIENT_ID=... --set GOOGLE_CLIENT_SECRET=...
railway up --ci --service web
```

Until both are set the _Log in with Google_ link does not appear and only the public-channel lookup works.

## 5. Going public (optional)

Publish the app (Audience → Publish) and submit for verification. `youtube.readonly` is a sensitive scope: Google asks for the privacy policy, a scope justification and a short demo video of the login and playlist list. Until it is approved, only test users can log in.

## Rotating

Create a new secret on the client, update `GOOGLE_CLIENT_SECRET`, redeploy, then delete the old secret.
