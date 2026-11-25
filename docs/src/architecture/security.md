# Security

## Credentials

| Credential       | Form                                                          | Stored                        |
| ---------------- | ------------------------------------------------------------- | ----------------------------- |
| Participant      | 32 random bytes, sent as `Bearer id:token`                    | SHA-256 only                  |
| Admin capability | 32 random bytes in the URL **fragment**                       | SHA-256 only (`adminGrants`)  |
| Recovery secret  | 32 random bytes, returned by the API but not shown in the app | SHA-256 only, role `recovery` |
| Player lease     | 32 random bytes + monotonic epoch                             | SHA-256 only                  |
| Handover code    | 16 Crockford characters, single use, 10 min                   | SHA-256 only                  |

The admin URL keeps its secret in the fragment, which browsers never send, so it does not reach logs or
referrers. The page exchanges it once at `POST /admin/session` for an HttpOnly, `SameSite=Strict` cookie scoped
to `/api/events/<id>` (and `Secure` in production). Handover revokes every earlier admin grant server-side, so a
stale admin cannot return by refreshing. The app creates the event and signs the creating browser in directly
(`/a/<id>#k=…` is opened by the client itself), so the link and the recovery secret are never displayed; the
recovery endpoint still exists for operators who read the create response.

## CSRF and origin

Cookie-authenticated, state-changing requests must carry an `Origin` equal to `PUBLIC_BASE_URL` (plus
`localhost` origins outside production) **and** `X-Qroove-CSRF`. The header must match the readable `qc_` cookie
(double submit) and an HMAC of the admin secret keyed by `COOKIE_SECRET`, so a token from another session is
rejected. Player and attendee calls use bearer-style credentials in headers/body, which a cross-site page cannot
attach.

## Rate limits

In-process sliding windows (one instance in production): 120/min/IP for the whole API; event create and import
5/hour/IP; join 20/min/IP; submit 10/min/participant and 30/min/IP; resolve-link 20/min/IP; admin session,
handover claim and recovery 10/min/IP. `trustProxy` is on so the IP is the client's, not the proxy's (Cloudflare and Coolify's Traefik). Request
bodies are capped at 16 KB.

## Outbound requests (SSRF)

The server never fetches a user-supplied URL. `parseLink` accepts only allowlisted hosts, extracts an id, and the
provider then builds the request URL itself. `fetchJson` additionally refuses any host outside a fixed set
(`api.spotify.com`, `accounts.spotify.com`, `open.spotify.com`, `itunes.apple.com`, `www.youtube.com`), requires
https, forbids redirects, times out after 3 s and stops reading at 256 KB. `spotify.link` short links are
refused because following them would need a redirect.

## Headers and logging

Helmet sets a strict CSP (`'self'`, with documented exceptions for `/docs` and for the official Spotify and YouTube players, ADR 0017 and 0019) and sends only the origin as a cross-origin referrer. Responses that carry
secrets or personal state send `Cache-Control: no-store`. Pino redacts `authorization`, cookies and `token` or
`secret` fields, and the audit trail never stores secrets.
