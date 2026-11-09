# Transfer ownership

Qroove is a CSR initiative of Sataklela OÜ. Today the repository, Railway project and Firebase project sit in
a personal account; this page moves them to a company organisation without downtime. The brand and
repository URL live in one place, `packages/config/src/brand.ts` (`repoUrl`), so no code changes beyond that
constant are needed.

## Order of work

1. **GitHub.** Settings → General → Danger zone → Transfer, to the company organisation. GitHub redirects the
   old URL. Then set `BRAND.repoUrl` in `packages/config/src/brand.ts`, run `pnpm test`, and deploy.
2. **Railway.** Project → Settings → Transfer to the company workspace (the service, variables, domain and
   deployments move together). Re-authorise the Railway GitHub integration under the new GitHub owner and
   reconnect the repository in the service's Source settings so auto-deploy keeps working.
3. **Firebase / Google Cloud.** Add the company owners to the project's IAM (Owner), confirm they can sign in,
   then remove the personal account. Check the project's billing and contact details.
4. **Cloudflare.** Already in the company account; nothing to move. The records are the `qroove` CNAME and the
   `_railway-verify.qroove` TXT (see [DNS](/runbook/dns-cloudflare)). If the Railway project moves, check
   `railway domain` still shows the same CNAME target.
5. **Rotate secrets** (after the move, in Railway variables):

   | Secret                         | How                                                                                                                                                                                  |
   | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `COOKIE_SECRET`                | New random value. Organisers' CSRF tokens reset; sessions stay valid                                                                                                                 |
   | `FIREBASE_SERVICE_ACCOUNT_B64` | New key, see [Firebase](/runbook/firebase); delete the old key                                                                                                                       |
   | `CRON_SECRET`                  | New random value; update any caller of `/api/internal/purge`                                                                                                                         |
   | Spotify client secret          | Rotate in the Spotify developer dashboard; update `SPOTIFY_CLIENT_SECRET`. The redirect URI is `https://qroove.sataklela.com/api/spotify/callback`                                   |
   | Google OAuth client secret     | Rotate in Google Cloud Console → Credentials; update `GOOGLE_CLIENT_SECRET`. The redirect URI is `https://qroove.sataklela.com/api/google/callback` (see the Google sign-in runbook) |

6. **Verify.** Run the smoke test in [Deploy](/runbook/deploy) and check `railway logs` for the start-up
   `retention purge` line.

## Checks before declaring it done

- `grep -ri raunak .` finds nothing except history (the repository URL is the only intended mention and it
  is in `brand.ts`, to be replaced in step 1).
- Nobody outside the company can deploy, read variables or open the Firestore console.
- Copyright and licence notices stay: AGPL-3.0-only, "Sataklela OÜ".
