# Transfer ownership

Qroove is a CSR initiative of Sataklela OÜ. This page moves everything from personal accounts to the
company without downtime. The brand and repository URL live in one place, `packages/config/src/brand.ts`
(`repoUrl`), so no code changes beyond that constant are needed.

**Status (2026-11-25):** GitHub is done (`github.com/sataklela/qroove`, `BRAND.repoUrl` updated); hosting is
on the company VPS under Coolify (Railway retired 2026-11-19); Cloudflare and the Google Play developer
account are the company's. Left: Firebase / Google Cloud IAM, and the secret rotation below.

## Order of work

1. **GitHub.** Done. (Settings → General → Danger zone → Transfer; GitHub redirects the old URL.)
2. **Hosting.** Done: the Coolify app `qroove-web` on the Sataklela VPS (see [Deploy](/runbook/deploy)).
3. **Firebase / Google Cloud.** Add the company owners to the project's IAM (Owner), confirm they can sign in,
   then remove the personal account. **Add roles; never edit or replace existing ones** (the 2026-11-19
   outage). Check the project's billing and contact details.
4. **Cloudflare.** Already in the company account; the record is the proxied `qroove` A record (see
   [DNS](/runbook/dns-cloudflare)).
5. **Rotate secrets** (after the move, in the Coolify app's variables, then redeploy):

   | Secret                         | How                                                                                                                                                                                        |
   | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `COOKIE_SECRET`                | New random value. Organisers' CSRF tokens reset; sessions stay valid                                                                                                                       |
   | `FIREBASE_SERVICE_ACCOUNT_B64` | New key, see [Firebase](/runbook/firebase); delete the old key                                                                                                                             |
   | `CRON_SECRET`                  | New random value; update any caller of `/api/internal/purge`                                                                                                                               |
   | Spotify client secret          | Rotate in the Spotify developer dashboard; update `SPOTIFY_CLIENT_SECRET`. The redirect URI is `https://qroove.sataklela.com/api/spotify/callback`                                         |
   | Google OAuth client secret     | Rotate in Google Cloud Console → Credentials; update `GOOGLE_OAUTH_CLIENT_SECRET`. The redirect URI is `https://qroove.sataklela.com/api/google/callback` (see the Google sign-in runbook) |

   Never rotate the Android release key: app updates need the same key ([Android app](/runbook/android)).

6. **Verify.** Run the smoke test in [Deploy](/runbook/deploy) and check the Coolify logs for the start-up
   `retention purge` line.

## Checks before declaring it done

- `grep -ri raunak .` finds nothing except history (the repository URL is the only intended mention and it
  is in `brand.ts`, to be replaced in step 1).
- Nobody outside the company can deploy, read variables or open the Firestore console.
- Copyright and licence notices stay: AGPL-3.0-only, "Sataklela OÜ".
