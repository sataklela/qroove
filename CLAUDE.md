# Qroove — agent guide

Fair collaborative music queue PWA (plus Android app) for dance socials. A CSR initiative of Sataklela OÜ (AGPL-3.0).

**If `HANDOVER.md` exists at the repo root, read it first and follow it** (it is the handover from a cloud session; delete it when its checklist is done).

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

## Cloud → VPS handoff (teleport)

Work starts in a claude.ai cloud session (idea, plan, code). When it needs real building, testing, server
access or secrets, the user **teleports this same session to the VPS terminal** and types `continue`.

**In the cloud session, when the work reaches "needs the server":**

1. Commit and push everything to the session branch (teleport needs it on GitHub).
2. Update "Next session starts with" in `plan/PROGRESS.md` with exact VPS steps, as commands, in order.
3. Tell the user in one line: _"Ready for the VPS: `cd ~/qroove && claude --teleport` and say continue."_
   Do not hand them a manual checklist that you could run yourself once you're on the VPS.

**On `continue` after a teleport, check where you are first:** `hostname; whoami; test -d /data/coolify && echo VPS`.

- **On the VPS:** you have full access. Do the "needs user" steps from this conversation and PROGRESS yourself
  (install tools, build, test, create keys/secrets, set Coolify variables, redeploy, check production). Use the
  "Ask first" list below for anything outside that. Push results to the same branch and clear the done items from PROGRESS.
- **Still in the cloud:** carry on with whatever works here, and keep the VPS steps queued.

**VPS one-time setup (user, once):** a clone at `~/qroove` with push access (the `deploy` user's GitHub
credentials, not the read-only deploy key), Claude Code installed and logged in to the same claude.ai account,
and `gh` authenticated. Allow full permissions there with
`claude --teleport --dangerously-skip-permissions` or a `permissions.defaultMode` in `~/.claude/settings.json`.
Teleport needs a clean working tree in `~/qroove`.

## Android app (Phase 19, ADR 0028)

- Trusted Web Activity distributed as an APK **outside Google Play** (GitHub Releases / third-party stores).
  Runbook: `docs/src/runbook/android.md`.
- Release key: generate once on the VPS into `/srv/qroove/secrets/qroove-release.jks` (+ an offline backup the
  user keeps), put its SHA-256 into Coolify `ANDROID_CERT_SHA256`, and the four `ANDROID_*` GitHub secrets
  (`gh secret set`) so `.github/workflows/android.yml` signs tagged releases. **Never regenerate an existing key** —
  installed apps could no longer update.
- Bump `apps/web/package.json` version before every APK handed out (it drives `versionCode`).
- Verify: `curl https://qroove.sataklela.com/.well-known/assetlinks.json` lists the fingerprint.
