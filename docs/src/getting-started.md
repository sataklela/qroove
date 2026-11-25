# Getting started

## Prerequisites

- Node 24 (`.nvmrc`)
- pnpm 10 (`corepack enable`)

## Run locally

```sh
pnpm install
cp .env.example .env     # defaults to the in-memory repository; no credentials needed
pnpm dev                 # server on :3000, web on :5173 (proxies /api)
```

## Useful commands

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `pnpm test`      | Unit tests in every workspace   |
| `pnpm typecheck` | `tsc` in every workspace        |
| `pnpm lint`      | ESLint                          |
| `pnpm build`     | Builds web, docs and server     |
| `pnpm docs:dev`  | Live-reloading docs at `/docs/` |

| `pnpm test:e2e` | Playwright end-to-end tests |

Android (phone and TV): `cd apps/mobile && pnpm exec cap sync android && cd android && ./gradlew assembleDebug`
(needs JDK 21 and the Android SDK; see [Android app](/runbook/android)). To see the TV layout in a browser,
open `http://localhost:3000/?tv=1` (`?tv=0` turns it off).

After `pnpm build`, `node apps/server/dist/main.js` serves the app at `/` and these docs at `/docs/`.
