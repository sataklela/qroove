# Qroove — agent guide

Fair collaborative music queue PWA (plus Android app) for dance socials. A CSR initiative of Sataklela OÜ (AGPL-3.0).

**Cardinal rule — knowledge first.** Before researching or designing anything from scratch, search the org
knowledge base (index: `sataklela/docs/knowledge/README.md` in the `sataklela` repo), then this repo's `docs/src/knowledge/`,
ADRs and runbooks for an existing decision tree. Reuse or extend it. When you make a new multi-step decision, add or
update its decision tree and index entry in the same PR. (PWA → Play app: `docs/src/knowledge/pwa-to-play-store.md`.)

**Every session:** read `plan/PROGRESS.md`, then §0–§5 of `plan/EXECUTION_PLAN.md` and only the section for the
current phase. Product rules live in `plan/SPEC.md` — read only the sections the phase references.

- Stack: pnpm workspaces · TypeScript strict · React+Vite PWA · Fastify · Firestore (behind `Repository` port) · VitePress docs at `/docs` · Android app: Capacitor shell around the live site (`apps/mobile`, ADR 0029) · hosted on **Coolify** on the Sataklela VPS (Railway retired 2026-11-19) · Cloudflare DNS.
- MCP servers (`.mcp.json`): `railway` (legacy), `firebase`, `cloudflare`. CLI `firebase` installed globally.
- Commands: `pnpm dev`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm docs:dev`; Android: `cd apps/mobile && pnpm exec cap sync android && cd android && ./gradlew assembleDebug assembleRelease`.
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

## Android app (Phases 19–20, ADR 0029)

- Capacitor 8 shell (`apps/mobile`) whose WebView opens `https://qroove.sataklela.com`; APK on GitHub Releases and
  the sataklela.com case study; AAB for Google Play (`runbook/google-play.md`). Runbook: `docs/src/runbook/android.md`.
- Native features only through `apps/web/src/shared/native.ts` (web fallback for each), so site and app never differ.
- Sign-in in the app: Custom Tab + one-time code (`apps/server/src/api/appHandoff.ts`).
- Gapless/weak network: next song reserved while one plays; player outbox (`apps/web/src/player/outbox.ts`),
  at most 2 songs without the server. **Never cache YouTube/Spotify audio.**
- Release key: `/srv/qroove/secrets/qroove-release.jks` (+ owner's offline backup); its SHA-256 in Coolify
  `ANDROID_CERT_SHA256`; four `ANDROID_*` GitHub secrets for `.github/workflows/android.yml`. **Never regenerate an existing key.**
- Bump `apps/web/package.json` version before every APK handed out (it drives `versionCode`).
- Real-device QA: wireless adb from the VPS (see runbook); the VPS has no KVM, so no emulator.
