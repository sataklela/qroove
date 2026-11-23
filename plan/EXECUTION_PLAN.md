# Qroove — Execution Plan

> **Audience:** Claude Sonnet 5 (medium effort) executing autonomously, one phase per context window.
> **Product spec (source of truth for behaviour):** `plan/SPEC.md`. This file is the source of truth for
> _how_ to build it. Where they conflict, this file wins on technology (Firestore replaces SQLite);
> SPEC wins on product rules (fairness, quota, states, UX).
> **Progress tracker:** `plan/PROGRESS.md` — update it at the end of every phase.

---

## 0. How to execute this plan (read every session)

1. Start each session by reading, in order: `CLAUDE.md`, `plan/PROGRESS.md`, **only** the section of this
   file for the current phase plus §1–§4 (the fixed decisions). Read `plan/SPEC.md` sections only when the
   phase says so (e.g. "SPEC §3.4"). Do not read the whole spec each time — it is ~40 KB.
2. Work only on the current phase. Do not start the next phase in the same session unless the current phase
   is fully done, committed and context budget is clearly ample.
3. Every phase ends with the **Phase Exit Checklist** (§5). A phase is not done until all items pass.
4. If blocked on something only the user can do (logins, DNS, secrets), record it under "Blocked / needs
   user" in `PROGRESS.md`, stub behind an interface or env flag, and continue with what is not blocked.
5. Never invent product rules. If SPEC is ambiguous, pick the most conservative interpretation, implement
   it, and log it in `docs/src/adr/` as a short ADR plus a line in `PROGRESS.md` "Decisions made".
6. Commit at the end of each phase (and at sensible checkpoints) on `main` with conventional commits,
   e.g. `feat(scheduler): ...`. End every commit message with:
   `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Push to `origin main` after each phase.

---

## 1. Fixed decisions (do not revisit)

| Topic                             | Decision                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name                      | **Qroove**. Tagline: "Fair, collaborative music queues for dance socials." Never imply LSU endorsement; LSU Salsa Society is the _pilot community_ only.                                                                                                                                                                                     |
| Owner / brand                     | A **CSR initiative of Sataklela OÜ** (https://sataklela.com). Repo may be transferred from `raunak-h/qroove` to a company org later → no personal names/paths hardcoded; all brand strings in one config module.                                                                                                                             |
| Licence                           | **AGPL-3.0-only** (copyleft, correct for network services). `LICENSE` file at root; SPDX headers not required per file.                                                                                                                                                                                                                      |
| Footer (app AND docs, every page) | `Copyleft 🄯 2026 Sataklela OÜ · A CSR initiative · AGPL-3.0` where "Sataklela OÜ" links to `https://sataklela.com` (`rel="noopener"`, opens same tab). Plus link to `/docs` and source repo URL (from config).                                                                                                                               |
| Language                          | TypeScript strict everywhere. Node 24 (`.nvmrc` = `24`). ESM only.                                                                                                                                                                                                                                                                           |
| Package manager                   | **pnpm 10** workspaces (`corepack enable`).                                                                                                                                                                                                                                                                                                  |
| Front end                         | React 19 + Vite 7 + `vite-plugin-pwa`. No UI framework; hand-written CSS with custom properties. React Router 7 (library mode).                                                                                                                                                                                                              |
| Back end                          | **Fastify 5** single service; serves `/api/*`, the built SPA, and the built docs at `/docs`.                                                                                                                                                                                                                                                 |
| Database                          | **Google Cloud Firestore (Native mode)** via `firebase-admin` (server-side only; browsers never talk to Firestore directly). Firestore security rules = deny all client access.                                                                                                                                                              |
| DB portability                    | All persistence behind a `Repository` port (`apps/server/src/db/ports.ts`). Two adapters: `firestore/` (prod) and `memory/` (tests + local dev without credentials). Domain code never imports `firebase-admin`.                                                                                                                             |
| Realtime                          | Server-Sent Events from Fastify. Fan-out via an in-process `EventBus` port; Firestore adapter additionally subscribes with `onSnapshot` on the event doc so multiple instances stay correct (future-proof; prod runs 1 instance). Polling fallback `GET /public` every 10 s when SSE fails.                                                  |
| Scheduler                         | Pure TS package `packages/scheduler`, zero dependencies, deterministic.                                                                                                                                                                                                                                                                      |
| Contracts                         | `packages/contracts`: zod 4 schemas + inferred types shared by web & server.                                                                                                                                                                                                                                                                 |
| Brand/config                      | `packages/config`: `brand.ts` (name, company, URLs, footer text), `styles.ts` (dance style presets), `defaults.ts` (rule defaults). Web and docs import from here.                                                                                                                                                                           |
| Metadata                          | Adapters behind `MetadataProvider` port: Spotify Web API (client-credentials; enabled only if `SPOTIFY_CLIENT_ID/SECRET` set; `env.ts` also accepts legacy `SPOTIFY_DEV_CLIENT_ID`), Spotify/YouTube oEmbed (keyless), iTunes Lookup API for Apple Music (keyless), manual entry. Allowlisted hosts only (SSRF).                             |
| Playback                          | Local-file player on the designated device (`<input type=file multiple accept="audio/*">`, optional IndexedDB cache) + Manual mode (Mark started / Mark ended). No streaming/ripping, ever (SPEC §0 hard boundaries).                                                                                                                        |
| Docs                              | **VitePress 1.x** in `docs/`, `base: '/docs/'`, built to `docs/.vitepress/dist`, served by Fastify at `/docs`. Public. Includes architecture, ADRs, API reference, runbook, privacy, threat model, and `CHANGELOG` page.                                                                                                                     |
| Changelog                         | Root `CHANGELOG.md` (Keep a Changelog format, SemVer). Docs page `docs/src/changelog.md` includes it via `<!--@include: ../../CHANGELOG.md-->`. Every phase adds entries under `## [Unreleased]`; Phase 10 cuts `0.1.0`.                                                                                                                     |
| Hosting                           | Railway: one service, one instance, Dockerfile build, `main` auto-deploy. Healthcheck `/api/health`.                                                                                                                                                                                                                                         |
| Domain                            | `qroove.sataklela.com` via **Cloudflare** DNS → CNAME to Railway target.                                                                                                                                                                                                                                                                     |
| Testing                           | Vitest (unit/property with `fast-check`, integration against memory repo AND Firestore emulator), Playwright (e2e, mobile Chromium + WebKit).                                                                                                                                                                                                |
| CI                                | GitHub Actions: lint, typecheck, unit, property, integration (emulator), build, e2e (Chromium only in CI).                                                                                                                                                                                                                                   |
| Lint/format                       | ESLint 9 flat config + typescript-eslint, Prettier 3.                                                                                                                                                                                                                                                                                        |
| MCP servers                       | Already configured in `.mcp.json` (project scope): `railway` (`@railway/mcp-server@0.1.12`) `firebase` (`firebase-tools@15.34.2 mcp`) and `cloudflare` (remote `https://mcp.cloudflare.com/mcp`, OAuth via `/mcp`; covers DNS for zone `sataklela.com`). CLIs installed globally: `railway`, `firebase`. Prefer MCP tools; fall back to CLI. |

Pin exact dependency versions that exist at execution time (`pnpm add -E`). Before adding any package,
check it was published >14 days ago (`npm view <pkg> time --json`); pick the newest version that satisfies that.

---

## 2. Repository layout (target)

```
/CLAUDE.md                     agent entrypoint (keep short)
/README.md                     public readme with branding + quickstart
/LICENSE                       AGPL-3.0
/CHANGELOG.md
/.mcp.json                     railway + firebase MCP (exists)
/.nvmrc  /package.json  /pnpm-workspace.yaml  /tsconfig.base.json
/eslint.config.js  /.prettierrc  /.editorconfig  /.gitignore  /.env.example
/Dockerfile  /.dockerignore  /railway.json
/firebase.json  /.firebaserc  /firestore.rules  /firestore.indexes.json
/plan/{SPEC.md,EXECUTION_PLAN.md,PROGRESS.md}
/packages/config/src/{brand.ts,styles.ts,defaults.ts,index.ts}
/packages/contracts/src/{rules.ts,event.ts,request.ts,player.ts,api.ts,errors.ts,index.ts}
/packages/scheduler/src/{types.ts,eligibility.ts,select.ts,project.ts,quota.ts,index.ts}
/packages/scheduler/test/{eligibility.test.ts,select.test.ts,project.test.ts,property.test.ts}
/apps/server/src/
    main.ts  app.ts  env.ts
    api/{events.ts,requests.ts,admin.ts,player.ts,stream.ts,health.ts,errors.ts}
    domain/{commands/*.ts, queries/*.ts, clock.ts, ids.ts}
    db/ports.ts  db/memory/*.ts  db/firestore/*.ts
    ingestion/{parseLink.ts,canonicalKey.ts,providers/{spotify.ts,oembed.ts,itunes.ts,manual.ts},index.ts}
    realtime/{bus.ts,sse.ts}
    security/{tokens.ts,cookies.ts,rateLimit.ts,csp.ts}
    static.ts                  serves web dist + docs dist
/apps/server/test/{integration/*.test.ts}
/apps/web/src/
    main.tsx  routes.tsx
    shared/{api.ts,useEventStream.ts,storage.ts,Footer.tsx,Layout.tsx,components/*,styles/*.css}
    attendee/{JoinPage.tsx,EventPage.tsx,AddSong.tsx,MyRequests.tsx,NowPlaying.tsx}
    admin/{CreateEvent.tsx,AdminPage.tsx,Moderation.tsx,Handover.tsx,EndTime.tsx}
    player/{PlayerPage.tsx,LocalLibrary.ts,audio.ts,ManualMode.tsx}
    landing/{Landing.tsx,Privacy.tsx}
/apps/web/public/icons/*   (generated by `pnpm icons` from /brand/qroove-logo.png)
/brand/{qroove-logo.png,qroove-avatar.jpg}  /scripts/generate-icons.mjs
/docs/.vitepress/{config.ts,theme/{index.ts,Footer.vue,custom.css}}
/docs/src/{index.md,getting-started.md,changelog.md,
           guide/{attendee.md,admin.md,player.md},
           architecture/{overview.md,scheduler.md,data-model.md,realtime.md,security.md},
           api/reference.md, runbook/{deploy.md,dns-cloudflare.md,firebase.md,backup.md,transfer-ownership.md},
           privacy.md, threat-model.md, adr/{0001-firestore.md,0002-single-service.md,...}}
/tests/e2e/*.spec.ts   /playwright.config.ts
/.github/workflows/ci.yml
```

---

## 3. Firestore data model (replaces SPEC §7 SQL schema)

All under `events/{eventId}`. `eventId` = 20-char random (Firestore auto-id). `publicSlug` = 6-char
Crockford base32 join code (unique via `slugs/{slug}` doc created in a transaction).

```
slugs/{slug}                         { eventId }
events/{eventId}                     EventDoc
  participants/{participantId}       { tokenHash, nickname|null, joinedAt, lastSeenAt, acceptedCount }
  requests/{requestId}               RequestDoc
  recordingKeys/{canonicalKey}       { requestId, state: 'active'|'consumed' }   ← uniqueness lock
  playback/{seq}                     { requestId, ownerId, style, startedAt, endedAt|null, outcome }
  adminGrants/{grantId}              { secretHash, issuedAt, revokedAt|null }
  handoverOffers/{offerId}           { codeHash, expiresAt, usedAt|null }
  audit/{autoId}                     { action, actorRole, at, payload (redacted), idempotencyKey|null }
  idempotency/{key}                  { response, at }   (expire 24h; Firestore TTL needs billing → deleted by the Phase 8 purge job)
```

`EventDoc` (single doc = the transactional "aggregate root"; every command runs in
`db.runTransaction` reading this doc first and **incrementing `version`**):

```ts
{
  name, publicSlug, state: 'DRAFT'|'ACTIVE'|'PAUSED'|'TRANSFERRING'|'ENDED'|'ARCHIVED',
  timezone, createdAt, startedAt|null, endedAt|null, endAt|null,   // endAt = mutable schedule
  breaks: [{ id, label, durationSec, startsAt|null, actualStart|null, actualEnd|null }],
  rules: RulesSnapshot, rulesHash: string|null,                    // frozen at start (sha256 of canonical JSON)
  version: number, acceptedSeq: number,
  history: HistoryState,          // scheduler input; see packages/scheduler/src/types.ts
  reservation: { requestId, reservedAt, leaseEpoch } | null,
  nowPlaying: { requestId, startedAt, durationMs|null } | null,
  lease: { controllerHash, epoch, claimedAt, heartbeatAt, expiresAt } | null,
  waitingReason: string|null,
  preview: { revision, items: PreviewItem[], stoppedReason, computedAt },   // denormalised for cheap reads
  adminGrantVersion: number,
}
```

`HistoryState` = `{ lastStyle|null, runLength, lastOwnerId|null, transitionCount, ownerLastPlayTransition: Record<ownerId, number>, playedKeys: string[] }`.
(Keeps scheduler O(1) per decision; `transitionCount` increments when a played style differs from `lastStyle`.)
A requester `p` is eligible for return iff `transitionCount > ownerLastPlayTransition[p]` (SPEC §3.4).

Why one aggregate doc: Firestore transactions give serialisable read-modify-write on docs read inside the
transaction; contention is ~1 write/sec max per event, well within limits for 40 users. Quota is enforced
by reading the participant doc + event doc inside the same transaction. Duplicate prevention: `tx.create`
semantics on `recordingKeys/{key}` — read it in the txn; if exists → `DUPLICATE`.

Free tier (Spark): 50k reads / 20k writes / day — ample. Minimise reads: SSE clients read from the
in-memory cache populated by `onSnapshot`, never Firestore per client.

`firestore.rules`: `allow read, write: if false;` for everything. Indexes: `requests` composite on
`(state ASC, acceptedSeq ASC)` and `(participantId ASC, state ASC)`.

---

## 4. Cross-cutting conventions

- **Errors:** every domain failure is a typed `DomainError` with `code` from `packages/contracts/src/errors.ts`:
  `DUPLICATE, QUOTA_FULL, RULES_FROZEN, NOT_OWNER, ALREADY_STARTED, EVENT_NOT_ACTIVE, EVENT_ENDED,
STALE_LEASE, STALE_VERSION, UNSUPPORTED_LINK, METADATA_UNAVAILABLE, RATE_LIMITED, UNAUTHORISED,
NOT_FOUND, VALIDATION`. API maps to HTTP and JSON `{ error: { code, message, action } }` where `action`
  is the "practical next action" text (SPEC §6 Unavailable states). User-facing copy lives in
  `packages/contracts/src/errors.ts` `ERROR_COPY` so web and server agree.
- **Auth tokens:** 32 random bytes base64url. Store `sha256` only. Participant token: `localStorage`
  key `qroove:p:{eventId}` + sent as `Authorization: Bearer`. Admin capability: one-time URL
  `/a/{eventId}#k={secret}` (fragment, never sent to server logs) → client POSTs it to
  `/api/events/:id/admin/session` → HttpOnly, Secure, SameSite=Strict cookie `qa_{eventId}`.
  Admin mutating requests also require header `X-Qroove-CSRF` = value from a non-HttpOnly cookie
  (double-submit). Player lease token: returned in body, kept in memory + sessionStorage.
- **Idempotency:** all POSTs accept `Idempotency-Key` header; stored per event for 24h.
- **Clock:** inject `Clock` interface; never call `Date.now()` in domain/scheduler code.
- **Logging:** Fastify pino; redact `authorization`, cookies, `*token*`, `*secret*`.
- **Copy & accessibility:** 44×44px targets, WCAG 2.2 AA, `prefers-reduced-motion`, dark default + light
  toggle (stored in localStorage `qroove:theme`).
- **Docs-as-you-go:** each phase updates the docs pages it lists. Docs describe what exists, not plans.
- **Tests-as-you-go:** each phase's tests must pass before commit. `pnpm test` = all non-e2e tests.

---

## 5. Phase Exit Checklist (every phase)

- [ ] `pnpm -r typecheck && pnpm lint && pnpm test` pass (from Phase 1 onwards).
- [ ] `pnpm build` passes (from Phase 1 onwards).
- [ ] Docs pages listed in the phase updated; `CHANGELOG.md` `[Unreleased]` updated.
- [ ] `plan/PROGRESS.md`: phase ticked, notes, decisions, blockers, and a **"Next session starts with"** line.
- [ ] Commit + push.

---

## Phase 0 — Accounts, MCP & infrastructure provisioning (mostly needs user)

**Goal:** Firebase project + Firestore + service account; Railway project; secrets; GitHub repo ready.
Already done during planning: `.mcp.json` with railway + firebase servers; global `railway` 5.71 and
`firebase` 15.34.2 CLIs.

Steps:

1. Ask the user to run (in Claude Code prompt): `! firebase login --no-localhost` and `! railway login --browserless`.
   Verify with `firebase projects:list` and `railway whoami`. Restart Claude Code if MCP servers didn't load.
2. Firebase: create project id `qroove-sataklela` (if taken, `qroove-sataklela-<4 random>`), display name
   "Qroove". `firebase projects:create <id> --display-name Qroove`. Enable Firestore Native mode in
   region **`eur3`** (multi-region Europe) or `europe-west2` (London) if multi-region unavailable on Spark:
   `firebase firestore:databases:create "(default)" --location=europe-west2` (Spark plan; no billing).
3. Service account: in GCP, create `qroove-server@<id>.iam.gserviceaccount.com` with role
   `roles/datastore.user`. If `gcloud` is unavailable, ask the user to do it in the console
   (Project settings → Service accounts → Generate new private key) and paste nothing into chat: they save
   it to `./.secrets/firebase-sa.json` (gitignored). Record steps in `docs/src/runbook/firebase.md`.
4. Write `.firebaserc` (`{"projects":{"default":"<id>"}}`), `firebase.json` (firestore rules/indexes +
   emulator `firestore` on port 8080, ui disabled), `firestore.rules` (deny all), `firestore.indexes.json`.
   Deploy: `firebase deploy --only firestore:rules,firestore:indexes`. Configure TTL policy on
   `idempotency.expireAt` (console or `gcloud firestore fields ttls update`; if unavailable, log as user task).
5. Railway: create project "qroove" (MCP `create-project-and-link` or `railway init`), one service "web".
   Set variables: `NODE_ENV=production`, `PUBLIC_BASE_URL=https://qroove.sataklela.com`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_SERVICE_ACCOUNT_B64` (base64 of the JSON; user sets it via
   `! railway variables --set FIREBASE_SERVICE_ACCOUNT_B64=$(base64 -w0 .secrets/firebase-sa.json)`),
   `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (user provides; app works without them),
   `COOKIE_SECRET` (generate 32 bytes). Do NOT deploy yet (Phase 9).
6. Spotify: ask the user to create an app at developer.spotify.com (Web API, redirect URI not needed for
   client-credentials) and set the two variables in Railway + local `.env`. Not blocking.
7. Create `.env.example` listing every variable with comments; `.gitignore` includes `.env`, `.secrets/`.

Docs: none yet (Phase 1 creates docs site; record notes in PROGRESS for transfer into runbook).
Exit: tick Phase 0 items possible; everything requiring user goes to "Blocked / needs user". Phases 1–8 do
NOT require Phase 0 to be complete (memory repo + emulator).

---

## Phase 1 — Monorepo scaffold, branding, docs site skeleton, CI

1. Root: `package.json` (private, `"packageManager": "pnpm@10.x"`, scripts: `dev`, `build`, `typecheck`,
   `lint`, `format`, `test`, `test:integration`, `test:e2e`, `docs:dev`, `docs:build`), `pnpm-workspace.yaml`
   (`apps/*`, `packages/*`, `docs`), `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`,
   `exactOptionalPropertyTypes`, module `NodeNext` for server/packages, `Bundler` for web), ESLint, Prettier,
   `.editorconfig`, `.nvmrc`, `LICENSE` (full AGPL-3.0 text from https://www.gnu.org/licenses/agpl-3.0.txt — use
   WebFetch), `CHANGELOG.md`, `README.md`.
2. `packages/config`: `brand.ts`:
   ```ts
   export const BRAND = {
     product: 'Qroove',
     tagline: 'Fair, collaborative music queues for dance socials.',
     company: { name: 'Sataklela OÜ', url: 'https://sataklela.com' },
     initiative: 'A CSR initiative',
     licence: { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
     copyleftYear: 2026,
     repoUrl: 'https://github.com/raunak-h/qroove', // single place to change on org transfer
     docsPath: '/docs',
     pilotCommunity: 'LSU Salsa Society (pilot community; not an endorsement)',
   } as const;
   export const footerText = () =>
     `Copyleft 🄯 ${BRAND.copyleftYear} ${BRAND.company.name} · ${BRAND.initiative} · ${BRAND.licence.name}`;
   ```
   `styles.ts`: presets `salsa, bachata, chacha, kizomba, merengue, other` with labels; default enabled
   `['salsa','bachata']`. `defaults.ts`: `submissionLimit: 5`, run caps `{salsa:2,bachata:2}`, other styles 1,
   `minStyleTransitionsSinceRequesterPlay: 1`, `transitionOverheadSec: 5`.
3. `packages/contracts`, `packages/scheduler`: empty `index.ts` + tsconfig + vitest config.
4. `apps/server`: Fastify hello with `/api/health` → `{ ok: true, version, commit }` (commit from
   `RAILWAY_GIT_COMMIT_SHA`). `env.ts` parses env with zod; `REPO_DRIVER=memory|firestore` (default
   `memory` when no credentials).
5. `apps/web`: Vite React app with `Layout` + `Footer` (uses `BRAND`, footer per §1) + Landing page.
   Dark theme CSS tokens. PWA plugin with manifest (name Qroove, theme `#1c1b1f`, accent warm amber
   `#f2a541`). Brand art lives in `/brand/`: `qroove-logo.png` (500×500, transparent; **the logo** — used for favicon,
   PWA/Apple icons, in-app/docs logo, Open Graph/Twitter previews, Gravatar/profile picture) and `qroove-avatar.jpg`
   (1024×1024 opaque master avatar — README header, repo/org/social avatar, Spotify app icon; not used inside the app).
   `pnpm icons` (`scripts/generate-icons.mjs`, `sharp`, nearest-neighbour to keep the pixel art crisp) regenerates
   `apps/web/public/icons/*` (icon-32/48/192/512, maskable 512, apple-touch 180, logo-256, avatar-512, og-image 1200×630)
   and `docs/src/public/*`. The logo has dark outlines: opaque assets use a light backing (`#fff4dc`); in-app, the dark
   theme adds a light halo (`.logo` CSS). Wire them into `index.html` (icons, `og:*`, `twitter:*` meta), the PWA manifest and docs `head`.
6. `docs/` VitePress: `config.ts` with `base: '/docs/'`, title "Qroove Docs", nav (Guide, Architecture, API,
   Runbook, Changelog), sidebar, `themeConfig.footer` = `{ message: 'Released under the AGPL-3.0.',
copyright: 'Copyleft 🄯 2026 <a href="https://sataklela.com">Sataklela OÜ</a> · A CSR initiative' }`
   (import string pieces from `@qroove/config`), `socialLinks` github → `BRAND.repoUrl`, local search
   enabled. Pages: index (hero), getting-started, changelog (include), placeholders for each section with
   one-line "Documented in Phase N" — replace as phases land.
7. Server `static.ts`: serve `apps/web/dist` at `/` with SPA fallback (non-`/api`, non-`/docs` paths →
   `index.html`) and `docs/.vitepress/dist` at `/docs/` (with `index.html` resolution and VitePress
   clean-URL handling: try `path.html`). Cache: hashed assets `immutable, max-age=31536000`; html `no-cache`.
   `@fastify/compress`, `@fastify/helmet` (CSP: `default-src 'self'; img-src 'self' data: https://i.scdn.co
https://*.mzstatic.com https://i.ytimg.com; media-src 'self' blob:; connect-src 'self'; style-src 'self'
'unsafe-inline'` — VitePress needs inline styles; scripts `'self'`).
8. `Dockerfile`: multi-stage `node:24-slim`; corepack pnpm; `pnpm install --frozen-lockfile`;
   `pnpm build` (packages → web → docs → server via `tsc`/`tsup`); runtime stage copies `apps/server/dist`,
   `apps/web/dist`, `docs/.vitepress/dist`, prod node_modules (`pnpm deploy --prod`); `CMD node
apps/server/dist/main.js`; listens on `$PORT`. `railway.json`: builder DOCKERFILE, healthcheckPath
   `/api/health`, numReplicas 1, restartPolicy ON_FAILURE.
9. `.github/workflows/ci.yml`: on push/PR: setup pnpm + node 24, install, lint, typecheck, test, build.
   (Emulator + e2e jobs added in later phases.)
10. `CLAUDE.md` already exists — keep it accurate.

Tests: smoke test `GET /api/health` with `fastify.inject`; footer render test (vitest + @testing-library/react)
asserting link to `https://sataklela.com` and text "CSR initiative".
Docs: getting-started (local dev), architecture/overview (initial diagram in Mermaid), adr/0001-firestore
(why Firestore over SQLite: cost/portability, user-mandated), adr/0002-single-service, adr/0003-agpl.
Exit check also: `docker build .` succeeds locally if Docker is available (skip if not; note it).

---

## Phase 2 — Contracts + Scheduler (pure, heavily tested)

Read SPEC §3 (all) and §4 first.

1. `packages/contracts/src/rules.ts`: `RulesSnapshot` zod schema: `{ rulesVersion: 1, enabledStyles:
StyleId[], runCaps: Record<StyleId, int 1..10>, submissionLimit: int 1..20, minStyleTransitions: 1,
noSameRequesterAdjacent: true, recordingUniquePerEvent: true, admissionOrder: 'fifo' }`. `hashRules()`
   = sha256 of canonical (sorted-key) JSON. Other schemas: event public view, request view, preview item,
   API bodies for every route in Phase 4, `ErrorCode` + `ERROR_COPY`.
2. `packages/scheduler/src/types.ts`:
   ```ts
   export interface Candidate {
     requestId: string;
     ownerId: string;
     style: StyleId;
     acceptedSeq: number;
     canonicalKey: string;
     durationMs: number | null;
     playable: boolean;
   }
   export interface HistoryState {
     lastStyle: StyleId | null;
     runLength: number;
     lastOwnerId: string | null;
     transitionCount: number;
     ownerLastPlayTransition: Record<string, number>;
     playedKeys: ReadonlySet<string>;
   }
   export type Ineligibility =
     | 'SAME_OWNER_ADJACENT'
     | 'NEEDS_STYLE_TRANSITION'
     | 'RUN_CAP'
     | 'ALREADY_PLAYED'
     | 'STYLE_DISABLED'
     | 'NOT_PLAYABLE'
     | 'WOULD_EXCEED_END';
   ```
3. `eligibility.ts`: `checkEligibility(c, history, rules, ctx?) → { ok: true } | { ok: false, reason }`
   implementing SPEC §3.4 exactly. First-ever play of an owner: eligible w.r.t. transitions.
4. `applyPlay(history, candidate) → HistoryState` (pure): if `lastStyle !== null && style !== lastStyle`
   → `transitionCount+1`, `runLength=1`; same style → `runLength+1`; first → `runLength=1`; set
   `lastOwnerId`, `ownerLastPlayTransition[owner] = newTransitionCount`, add key.
   Note: skipped-after-start counts as a play (SPEC §3.4). Pauses/breaks don't touch history.
5. `select.ts`: `selectNext(candidates, history, rules) → { pick: Candidate|null, reason: string,
blocked: Array<{requestId, reason}> }` with the comparator of SPEC §3.7:
   (1) group eligible by style; if `lastStyle` at cap, exclude it (already by eligibility);
   (2) choose style whose earliest eligible `acceptedSeq` is smallest (oldest waiting); tie-break: prefer
   style ≠ `lastStyle` (balance), then style id alphabetical; (3) oldest eligible in that style;
   (4) ties by `acceptedSeq` then `requestId`. No ageing bonus in MVP (ADR it). `reason` is a
   human-readable explanation string ("Oldest eligible Bachata; Salsa at run cap 2/2").
   If no pick → reason one of `NO_CANDIDATES`, `ALL_BLOCKED_FAIRNESS` (with summary e.g. "Waiting for
   another contributor or a style change").
6. `project.ts`: `projectQueue({ candidates, history, rules, nowMs, endAtMs|null, currentRemainingMs|null,
breaksRemainingSec, overheadSec, horizon = 50 }) → { items: Array<{requestId, position, predictedStartMs
|null, uncertain: boolean, overflow: boolean}>, stoppedReason: 'EXHAUSTED'|'WAITING_FAIRNESS'|
'HORIZON', overflowIds, waitingIds }`. Simulates by repeatedly `selectNext` + `applyPlay` on a copy.
   Unknown duration → subsequent items `uncertain=true`, `predictedStartMs` still computed using a 4-min
   default but flagged. Overflow only if `endAtMs` set and predicted _end_ > endAt (song must fit fully —
   SPEC §4). Overflow items are still listed (greyed), and projection continues past them? No: an
   overflowed item can't play, so it is marked overflow and the simulation **stops advancing time** past
   endAt; remaining candidates that would also start after endAt are overflow.
   Entries never reachable due to fairness are `waitingIds` (not overflow).
7. `quota.ts`: `countsTowardQuota(state)` per SPEC §3.3 (counts PENDING_METADATA, QUEUED,
   INELIGIBLE_TEMPORARILY, RESERVED_NEXT, PLAYING, PLAYED, SKIPPED; not WITHDRAWN/REJECTED/UNAVAILABLE).

Tests (Vitest + fast-check):

- Example tests: SPEC §3.4 impossibility example (`A` all Salsa, `B` all Bachata → `A-S1,B-B1,A-S2,B-B2`);
  single owner → plays one then waits; `S,S,B,B,S,B` acceptance; cap 2 blocks third Salsa; skipped-started
  counts; deterministic output for same input.
- Property test (`numRuns: 100_000` behind env `PROPERTY_RUNS`, default 2_000 in CI unit, full run in a
  separate `test:property` script): random owners (1–8), styles (1–4), caps (1–3), 0–60 requests; run full
  projection; assert no same-owner adjacency, owner returns only after ≥1 transition, run ≤ cap, no
  repeated canonical key, no item starts/ends after endAt, determinism (run twice → equal).
  Docs: `architecture/scheduler.md` — formal rules, comparator, worked examples (tables), invariants list,
  ADR `0004-no-ageing-bonus.md`, `0005-quota-counts-played.md`.

---

## Phase 3 — Persistence ports, memory + Firestore adapters, domain commands

1. `db/ports.ts`: `Repository` with `runInTransaction<T>(eventId, fn: (tx: EventTx) => Promise<T>)` and
   query methods. `EventTx` exposes: `getEvent()`, `putEvent(doc)` (must bump version), `getParticipant`,
   `putParticipant`, `getRequest`, `putRequest`, `listRequests(filter)`, `getRecordingKey`,
   `putRecordingKey`, `appendPlayback`, `appendAudit`, `getIdempotency`, `putIdempotency`, admin grant &
   handover offer get/put. Non-tx: `createEvent`, `findEventBySlug`, `getEventPublic(eventId)`,
   `subscribe(eventId, cb) → unsubscribe`.
   **Firestore rule:** all reads before writes inside a transaction — design `EventTx` so adapters buffer
   writes and flush at the end (memory adapter must enforce same "read-after-write throws" to keep parity).
2. `db/memory/`: Map-based, transactions serialised per event via a promise-chain mutex; deep-clone on
   read/write.
3. `db/firestore/`: `firebase-admin` init from `FIREBASE_SERVICE_ACCOUNT_B64` or emulator
   (`FIRESTORE_EMULATOR_HOST`). Converters for Timestamps ↔ ms numbers (domain uses epoch ms only).
   `subscribe` uses `onSnapshot` on `events/{id}` and keeps an LRU cache of public views.
4. Repo contract test suite `apps/server/test/repo.contract.ts` run against both adapters
   (Firestore via emulator: `firebase emulators:exec --only firestore "pnpm vitest run repo"`).
5. Domain commands (`domain/commands/`), each `(deps, input) → result` running in one transaction,
   checking state + permission + rules, writing audit:
   `createEvent` (returns adminSecret once), `updateDraft` (rules editable only in DRAFT), `startEvent`
   (freeze rules + hash; state ACTIVE), `joinEvent` (issue participant token), `submitRequest`
   (validate style enabled, quota via participant.acceptedCount + recount guard, duplicate via
   recordingKeys, assign `acceptedSeq = ++event.acceptedSeq`, state QUEUED or PENDING_METADATA),
   `withdrawRequest` (owner; not RESERVED? — SPEC: withdraw allowed for unplayed unstarted incl. reserved;
   if reserved, clear reservation and re-select), `adminRemove` (same, any owner; REJECTED),
   `pause`, `resume`, `setEndTime` (must be concrete future timestamp; allowed ACTIVE/PAUSED),
   `startBreak/endBreak`, `skip` (PLAYING → SKIPPED, counts as play; reserve next), `endEvent`
   (ENDED terminal; compute carry-over list), `archive`, `importSnapshot` (new DRAFT with seed requests
   owned by synthetic `system-seed` participant, optional per-style shuffle with stored seed using a seeded
   PRNG e.g. mulberry32), `createHandoverOffer`, `claimHandover` (revoke old grants, new grant, bump
   `adminGrantVersion`), player: `claimLease` (epoch+1, previous lease invalid), `heartbeat`,
   `reportStarted(requestId, epoch)` (must equal reservation & current epoch → PLAYING, applyPlay to
   history immediately — "started" is when it counts), `reportFinished(requestId, epoch)` (idempotent →
   PLAYED, reserve next), `releaseLease`.
   After any mutation: `recompute(tx)` = build candidates from QUEUED requests, `selectNext` for
   reservation if none reserved and event ACTIVE and nothing blocks, `projectQueue` → write `preview`,
   `waitingReason`.
   Lease expiry: lease valid while `heartbeatAt + 30s > now`; heartbeat every 10s.
6. Integration tests against memory repo for every command, including: 6 concurrent submits with limit 5 →
   exactly 5 accepted; concurrent duplicate submits → exactly 1 accepted, other gets DUPLICATE and no quota
   consumed; stale admin after handover rejected; stale player epoch rejected; rules immutable after start;
   withdrawal frees quota; replay of played recording rejected; pause preserves reservation.
   Run the concurrency tests against the emulator too.
   Docs: `architecture/data-model.md` (§3 of this plan, refined to reality), ADR `0006-aggregate-event-doc.md`.

---

## Phase 4 — HTTP API, auth, realtime, metadata ingestion

Read SPEC §5 (Link intake, Duplicate identity) and §8.

1. Routes exactly as SPEC §8 (adjust names only if needed; document in API reference). Add:
   `GET /api/spotify/callback` (the redirect URI registered with Spotify as
   `https://qroove.sataklela.com/api/spotify/callback`; client-credentials flow doesn't use it, so for now it
   returns 204 and is reserved for a future user-auth adapter — keep all Spotify routes under `/api/spotify/*`),
   `POST /api/events/:id/admin/session` (exchange secret → cookie), `GET /api/events/:id/admin/state`,
   `POST /api/events/:id/admin/breaks/:bid/start|end`, `POST /api/resolve-link` (parse + metadata,
   rate-limited, no side effects), `GET /api/events/by-slug/:slug` → eventId.
2. Validation: every body/params via zod contracts (`fastify-type-provider-zod`).
3. Security: `@fastify/rate-limit` (global 120/min/IP; submit 10/min/participant + 30/min/IP; create event
   5/hour/IP; resolve-link 20/min/IP), helmet CSP (Phase 1), same-origin check for admin (Origin header must
   equal `PUBLIC_BASE_URL` or localhost in dev), CSRF double-submit, cookie flags. Body limit 16 KB.
4. Ingestion (`ingestion/`):
   - `parseLink(url)`: allowlist hosts `open.spotify.com, spotify.link (reject — needs redirect; ask user to
open & copy full link), music.apple.com, geo.music.apple.com, www.youtube.com, youtube.com,
music.youtube.com, youtu.be, m.youtube.com`. Extract `{platform, id}`; strip tracking params
     (`si`, `utm_*`, `feature`, `pp`). Spotify: `/track/{22-char id}` (also `/intl-xx/track/`). Apple:
     `?i={songId}` or `/song/{slug}/{id}`. YouTube: `v=` or youtu.be path, 11-char id.
   - Providers: Spotify Web API `GET /v1/tracks/{id}` (client-credentials token cached until expiry) →
     title, artists, album, duration_ms, ISRC; if no keys → Spotify oEmbed (`https://open.spotify.com/oembed?url=`)
     title only. Apple → iTunes Lookup `https://itunes.apple.com/lookup?id={id}&entity=song` → trackName,
     artistName, trackTimeMillis, (no ISRC). YouTube → oEmbed `https://www.youtube.com/oembed?url=…&format=json`
     → title, author_name (treat "Artist - Title" split heuristically, mark confidence low).
     All via `fetch` with 3s timeout, 256 KB max, `redirect: 'error'`, only to these fixed hosts.
   - Manual: `title`, `artist`, optional `durationSec`.
   - `canonicalKey`: priority `isrc:{ISRC}` → `{platform}:{id}` → `fp:{norm(artist)}|{norm(title)}|{versionTag}`
     where `norm` = NFKD, lowercase, strip diacritics/punctuation/"feat."-clauses, collapse spaces;
     `versionTag` from title keywords (remix, live, acoustic, radio edit, extended, version, en vivo).
     Also record secondary keys (platform id + fingerprint) in `recordingKeys` so the same song pasted from a
     different platform with the same fingerprint is caught. Uncertain (fingerprint match but different
     version tag or duration differs >5s) → request state `PENDING_METADATA` with flag `possibleDuplicate`,
     admin resolves (approve as distinct / reject). Played keys block re-entry.
   - Style pre-fill: only from explicit title cues (`bachata`, `salsa`, `cha cha`, `kizomba`, `merengue`)
     returned as a _suggestion_; user's chip choice is authoritative.
5. Realtime: `GET /api/events/:id/stream` SSE: on connect send `event: state` with public view; on each
   repo change push `{revision}` + public view (≤ 4 KB). Heartbeat comment every 20s. Admin stream variant
   `/admin/stream` includes moderation list. Personalised data ("my next song") is computed client-side
   from the public preview + `my-requests` ids (preview contains requestIds, not owner ids — never leak
   owners or nicknames).
6. Public view shape (contracts): `{ eventId, slug, name, state, endAt, nowPlaying: {title, artist, style,
startedAt, durationMs}|null, upNext: PreviewItem[] (title, artist, style, predictedStartMs, uncertain,
overflow, requestId), waitingReason, runIndicator: {style, runLength, cap}, revision }`.
7. Integration tests via `fastify.inject` with memory repo + mocked fetch for providers; SSE test reads
   first two messages.
   Docs: `api/reference.md` (every route: auth, body, responses, errors), `architecture/realtime.md`,
   `architecture/security.md` (tokens, cookies, CSRF, rate limits, SSRF allowlist), `threat-model.md`
   (STRIDE table from SPEC §8 "Protect against"), `privacy.md` (what's stored, retention: participants and
   nicknames purged 30 days after event end — implement purge in Phase 8).

---

## Phase 5 — Attendee UI

Read SPEC §2 (Guest), §4 (Attendee countdown), §6.

Routes: `/` Landing (what it is, "Create an event", "Join with code" input), `/e/:slug` attendee event page,
`/privacy`. Components:

- Join: on first visit auto-POST join, store token; optional nickname field (collapsible).
- `NowPlaying` tile; `MyNextSong` ("2 songs until _Title_" with correct plural; ticking `~MM:SS` via
  `requestAnimationFrame`-free 1s interval; states: Estimated / Session paused / Waiting for more eligible
  songs / Beyond planned end — admin must extend / Position not yet predictable).
- `AddSong`: one input (paste button using `navigator.clipboard.readText` only on user tap, with graceful
  failure), style chips (enabled styles only, from event rules), debounced `resolve-link` preview card,
  manual fallback (title/artist/duration), submit with Idempotency-Key, inline error copy from
  `ERROR_COPY`.
- `MyRequests`: list with state badges (text + colour), Withdraw with confirm.
- Up next list (titles only, no owners), overflow greyed + "After end time" label.
- Connection indicator (SSE state: Live / Reconnecting / Offline — polling).
- Theme toggle; footer.
  Bundle budget: attendee route initial JS+CSS ≤ 40 KB gzip where feasible (code-split admin/player with
  `React.lazy`). Check with `vite build` + `rollup-plugin-visualizer` once; record size in PROGRESS.
  Component tests for countdown formatting + pluralisation.
  Docs: `guide/attendee.md` with screenshots (Playwright screenshots saved to `docs/src/public/screens/`).

---

## Phase 6 — Admin UI

Read SPEC §2 (Session admin), §6 Admin mobile page, §4 Unplayed carry-over.

Routes: `/new` create event (template "Friday Social" 19:00–21:00 Europe/London; "Dance break 10/20 min";
name, optional end time, breaks, styles, caps, submission limit; read-only "spacing rule: fixed"), shows
admin link **once** with copy button + warning "Save this link — it is the only way to control the event".
`/a/:eventId#k=…` exchange → cookie → `/admin/:eventId`.
Admin page: now playing + Pause/Resume/Skip (confirm), next reserved, run indicator, waiting reason,
overflow count, moderation list (Remove with confirm; possible-duplicate review: "Distinct" / "Reject"),
Extend until [time] (time picker; must be future), Breaks start/end, QR panel (`qrcode` lib → SVG of
`PUBLIC_BASE_URL/e/{slug}`, plus big slug text + copy), Hand over admin (creates offer → shows one-time
code/link `/claim/{eventId}#c=…`, 10-min expiry), Transfer player, End event (typed confirmation),
Rules (read-only after start, shows hash short). After end: carry-over list → "Create next event from these"
(import with optional shuffle per style).
`/h/:slug` historical read-only playlist view (no nicknames).
Docs: `guide/admin.md` with screenshots.

---

## Phase 7 — Player

Read SPEC §3.8, §5 Playback adapters + Browser/Bluetooth realities.

Route `/player/:eventId` (admin cookie required to claim lease; separate privilege recorded on lease).

- Claim lease → epoch; heartbeat 10s; on `STALE_LEASE` stop audio immediately and show "Another device took
  over playback".
- Sound check button (plays a short generated tone via WebAudio) — required before first Start.
- Local library: `<input type=file multiple accept="audio/*">` (+ `webkitdirectory` where supported);
  read tags with `music-metadata` (browser build) lazily, else filename "Artist - Title"; match reserved
  track to file by canonical fingerprint (same `norm` as server — put `norm`/fingerprint in
  `packages/contracts/src/normalise.ts` and import from server too). Optional "Remember on this device"
  → IndexedDB blobs (with clear permission copy). Report availability per request? MVP: player shows match
  status locally only.
- Flow: reserved track shown → if file matched: "Start" (first tap unlocks audio) → `audio.play()` →
  on `playing` event POST `started` → on `ended` POST `finished` → auto-advance to next reservation
  (auto-starts if audio already unlocked). If unmatched: Manual mode card with source link, "Mark started",
  "Mark ended" buttons. Never auto-mark ended on timer.
- Media Session API metadata + play/pause handlers; Wake Lock while playing (if supported).
- Transfer: on "Transfer player", old device releases; new device claims and must tap Start. Partially
  played current track is already PLAYING → mark SKIPPED (consumed) on release per SPEC §2.
  Docs: `guide/player.md` (Bluetooth tips, iOS autoplay caveats, sound check, rights notice).

---

## Phase 8 — Hardening: retention, export/import, e2e, accessibility, performance

1. Retention: `POST /api/internal/purge` protected by `CRON_SECRET` header; deletes participants/nicknames
   30 days after `endedAt`, abandoned DRAFTs after 7 days, audit > 90 days, idempotency docs older than 24h (no Firestore TTL on Spark plan). Schedule
   with Railway Cron? (costs a service) → instead run purge opportunistically on server start + every 6h via
   `setInterval` (single instance). Document.
2. Export `GET /api/events/:id/export` (sanitised JSON: tracks, styles, order, no participants) and import
   UI (paste/upload JSON) — already have command.
3. Playwright e2e (`tests/e2e/`): create → start → 3 attendee contexts submit → admin sees → player manual
   mode start/finish → attendee countdown updates → handover to second admin context → old admin rejected →
   end → carry-over → new event. Mobile viewports (iPhone 15 WebKit, Pixel 8 Chromium). Server started with
   memory repo via `webServer` config.
4. `@axe-core/playwright` checks on every route: zero serious/critical violations.
5. Load sanity: script `scripts/load.ts` (autocannon or plain fetch loop) simulating 40 SSE clients + 25
   submitters × 6 songs against memory repo locally and against emulator; assert p95 mutation < 2s; record.
6. CI: add jobs `integration-emulator` (Java 21 + `firebase emulators:exec`) and `e2e` (Chromium).
   Docs: `runbook/backup.md` (Firestore export via `gcloud firestore export` needs Blaze → document manual JSON
   export per event via API as the free alternative), update architecture overview.

---

## Phase 9 — Deploy: Railway + Cloudflare + Firestore prod

1. Confirm Phase 0 blockers are resolved (secrets set). If not, stop and ask user.
2. Link repo to Railway service (MCP `deploy` or `railway up` for first deploy; then connect GitHub repo
   in Railway dashboard → auto-deploy on `main` — user may need to authorise GitHub app; note it).
   Set `REPO_DRIVER=firestore`.
3. Verify `https://<railway-domain>/api/health`, `/`, `/docs/`, `/docs/changelog`.
4. Custom domain: `railway domain qroove.sataklela.com` (or MCP) → returns CNAME target + TXT verification.
   Cloudflare (use the `cloudflare` MCP; if not authenticated ask the user to run `/mcp` → cloudflare → authenticate; fallback: user does it in the dashboard): DNS → add `CNAME qroove → <target>`,
   **Proxy status: DNS only (grey cloud)** until Railway issues the certificate, plus the `_railway-verify`
   TXT record if shown. After cert is active, optionally enable proxy (orange) with SSL mode **Full
   (strict)**; SSE requires no buffering — Cloudflare proxies SSE fine but set `Cache-Control: no-cache`
   and `X-Accel-Buffering: no` on stream responses (already in Phase 4). Ensure Cloudflare "Rocket
   Loader" off for this hostname.
5. Set `PUBLIC_BASE_URL=https://qroove.sataklela.com`; redeploy; verify cookies (Secure) and admin same-origin
   check work on the custom domain.
6. Smoke test on two real phones (user): checklist in `runbook/deploy.md`.
   Docs: `runbook/deploy.md`, `runbook/dns-cloudflare.md`, `runbook/firebase.md` finalised.

---

## Phase 10 — Release 0.1.0 + ownership-transfer readiness

1. `CHANGELOG.md`: move Unreleased → `## [0.1.0] - <date>`; tag `v0.1.0`; push tag.
2. `runbook/transfer-ownership.md`: steps to transfer GitHub repo to company org (GitHub → Settings →
   Transfer; update `BRAND.repoUrl`; re-authorise Railway GitHub integration; transfer Railway project to
   company workspace; add company owners to Firebase project IAM then remove personal; rotate
   `COOKIE_SECRET`, service-account key, Spotify credentials; Cloudflare already company-owned).
   Grep repo for `raunak` — only `BRAND.repoUrl` and git history should mention it.
3. README: badges (CI, licence), screenshot, links to live app and docs, CSR statement, contribution guide
   (`CONTRIBUTING.md`, DCO sign-off), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
4. Final docs review: every page real (no "Documented in Phase N" placeholders: `grep -r "Documented in Phase" docs/src` empty).
5. Final PROGRESS update: summary + known limitations + pilot validation questions (SPEC §3.3 quota
   interpretation to validate with dancers).

## Phase 19 — Android app (Trusted Web Activity)

> **Revised 2026-11-23:** no Google Play account; distribute the signed APK via GitHub Releases and third-party stores. Steps 1–7 apply (hand-written Gradle project instead of Bubblewrap; we hold our own signing key); step 8 is dropped. See ADR 0028.

**Goal:** Qroove installable from Google Play as an Android app, with no second codebase.

**Decision: TWA (Bubblewrap), not Capacitor / React Native.**
- The server sets event cookies `SameSite=Strict; Path=/api/events/{id}` and Spotify/Google OAuth cookies on our origin. A TWA runs the real site in Chrome on `qroove.sataklela.com`, so cookies, OAuth redirects, YouTube embeds, Wake Lock and the service worker work unchanged. Capacitor would serve from `https://localhost`, breaking all of that (CORS + cross-site cookies + OAuth redirect URIs).
- Every web deploy updates the app instantly; Play releases are only needed for manifest/icon/shell changes.
- Revisit native (Capacitor) only if we need a feature Chrome can't give: background audio with screen off, Android Auto, local media files.

**Steps**
1. `apps/android/` — Bubblewrap project (`twa-manifest.json` generated from `/manifest.webmanifest`), package id `com.sataklela.qroove` set in `packages/config` (brand string rule). Commit generated Gradle project; keystore stays out of git (`.secrets/`, Play App Signing on).
2. Web manifest audit: `id`, `start_url`, `scope`, `display: standalone`, maskable 512 icon, `theme_color`/`background_color`, `shortcuts` (Join room, Host). Add screenshots for Play listing.
3. Server: serve `/.well-known/assetlinks.json` (package id + SHA-256 of the Play upload *and* app-signing certs, from env `ANDROID_CERT_SHA256`, comma-separated). Test it; exempt from CSP/SPA fallback.
4. Deep links: QR codes / room links (`/r/:code`, `/e/:id`) open the app if installed (intent filters come free from TWA scope). Verify in e2e that link format is unchanged.
5. Fallback when Chrome is absent: Bubblewrap's WebView fallback disabled → Custom Tab fallback; document.
6. CI: GitHub Action builds an unsigned AAB (`bubblewrap build` with JDK 17 + Android SDK) on tags; signing done locally or via secret keystore (needs user).
7. Docs: `docs/src/runbook/android.md` (build, sign, upload, rotate assetlinks), ADR 00xx "Android via TWA", privacy page mentions Play; CHANGELOG.
8. Play Console (needs user): developer account (Sataklela OÜ, D-U-N-S for org account), listing, content rating, data-safety form (matches Privacy page), internal testing track → closed test with ≥12 testers for 14 days (required for new personal accounts) → production.

**Exit checks:** assetlinks test green; `bubblewrap validate` passes; app on a real Android phone shows no URL bar (verified Digital Asset Links), join via QR opens in app, guest add + host playback + screen-awake work, Spotify/Google login round-trips.

**Needs user:** Play developer account + fee, signing key decision, testers, final listing text/screenshots approval.
