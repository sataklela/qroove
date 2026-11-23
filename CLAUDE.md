# Qroove — agent guide

Fair collaborative music queue PWA (plus Android app) for dance socials. A CSR initiative of Sataklela OÜ (AGPL-3.0).

**Every session:** read `plan/PROGRESS.md`, then §0–§5 of `plan/EXECUTION_PLAN.md` and only the section for the
current phase. Product rules live in `plan/SPEC.md` — read only the sections the phase references.

- Stack: pnpm workspaces · TypeScript strict · React+Vite PWA · Fastify · Firestore (behind `Repository` port) · VitePress docs at `/docs` · Android TWA shell (`apps/android`) · hosted on **Coolify** on the Sataklela VPS (Railway retired 2026-11-19) · Cloudflare DNS.
- MCP servers (`.mcp.json`): `railway` (legacy), `firebase`, `cloudflare`. CLI `firebase` installed globally.
- Commands: `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm docs:dev`; Android: `cd apps/android && ./gradlew assembleDebug assembleRelease`.
- Never: hardcode brand/repo strings outside `packages/config` (Android files are checked against `BRAND` by `apps/server/test/android-shell.test.ts`); import `firebase-admin` outside `apps/server/src/db/firestore`; call `Date.now()` in domain/scheduler; stream/rip audio.
- End of phase: lint + typecheck + tests + build green, docs + CHANGELOG updated, PROGRESS updated, commit (`Co-Authored-By: Claude <noreply@anthropic.com>`), push.

## Working autonomously (standing rule)

The user prefers that you **do the needful yourself** and only stop for things that genuinely need a human
(paying, legal/identity, a decision about the product, or something irreversible that is not already described here).

- **Where you run.** Ideally on the VPS terminal (`ssh deploy@64.247.186.195`, user `deploy` has passwordless sudo
  and Docker; see `docs/migration/railway-to-vps.md` → "Platform: Coolify"). There you may: install toolchains
  (JDK, Android SDK at `/opt/android-sdk`), read/set Coolify app environment variables and redeploy, read logs
  (`/var/log/cool-poll.log`, Coolify dashboard/API), run `curl` checks against production, and manage
  secrets kept on the server. In a cloud sandbox without that access, do everything possible locally and list
  the server steps precisely in PROGRESS "Blocked / needs user".
- **Do without asking:** code, tests, docs, branches, commits, pushes to the working branch, installing dev
  tools, building APKs, setting non-destructive env vars the docs call for (e.g. `ANDROID_CERT_SHA256`), redeploying
  through the normal pipeline, verifying in production.
- **Ask first:** merging to `main` when not asked, deleting data or backups, rotating/removing existing
  credentials or service-account roles (_add roles, never edit/replace_ — see the 2026-11-19 outage), DNS changes
  that could take the site down, spending money, publishing to any store.
- **Secrets** live only on the server (`/srv/qroove/secrets/`, mode 600, owned by `deploy`) or in GitHub/Coolify
  secrets — never in git, chat or logs. Record _where_ a secret lives in the runbook, never its value.
- Leave the next session a clear "Next session starts with:" line in `plan/PROGRESS.md`.

## Android app (Phase 19, ADR 0028)

- Trusted Web Activity distributed as an APK **outside Google Play** (GitHub Releases / third-party stores).
  Runbook: `docs/src/runbook/android.md`.
- Release key: generate once on the VPS into `/srv/qroove/secrets/qroove-release.jks` (+ an offline backup the
  user keeps), put its SHA-256 into Coolify `ANDROID_CERT_SHA256`, and the four `ANDROID_*` GitHub secrets
  (`gh secret set`) so `.github/workflows/android.yml` signs tagged releases. **Never regenerate an existing key** —
  installed apps could no longer update.
- Bump `apps/web/package.json` version before every APK handed out (it drives `versionCode`).
- Verify: `curl https://qroove.sataklela.com/.well-known/assetlinks.json` lists the fingerprint.
