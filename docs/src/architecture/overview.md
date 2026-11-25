# Architecture overview

Qroove is a single Node service plus a static PWA. The Android app (phones and TVs) is a thin
Capacitor shell that opens the same live site, so there is one front end for every device.

```mermaid
flowchart LR
  Browser[PWA — attendees, admin, player] -->|/api, SSE| Server[Fastify service]
  App[Android app, phone and TV: Capacitor WebView] -->|loads the live site| Browser
  Browser -->|/ and /docs| Server
  Server --> Repo{{Repository port}}
  Repo --> Mem[(memory adapter)]
  Repo --> FS[(Firestore adapter)]
```

## Workspaces

| Path                 | Role                                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config`    | Brand strings, style presets, rule defaults — the only place these live                                                            |
| `packages/contracts` | zod schemas shared by web and server                                                                                               |
| `packages/scheduler` | Pure, deterministic queue scheduler                                                                                                |
| `apps/server`        | Fastify: `/api/*`, built SPA at `/`, built docs at `/docs`                                                                         |
| `apps/web`           | React + Vite PWA; native extras only via `src/shared/native.ts` (web fallback for each), TV mode via `isTv()`                      |
| `apps/mobile`        | Capacitor 8 Android shell (phones and Android TV), see [Android app](/runbook/android) and [ADR 0029](/adr/0029-android-capacitor) |
| `docs`               | This VitePress site                                                                                                                |

## Testing and operations

- `pnpm test` runs unit, property and API tests (memory repository); `pnpm --filter @qroove/server test:emulator`
  runs the same repository and command suites against the Firestore emulator.
- `pnpm test:e2e` (Playwright, Pixel 8; add iPhone 15 WebKit with `E2E_WEBKIT=1`) drives the built server with
  the memory repository: create, run, play manually, hand over, end and carry over, with axe checks
  (WCAG 2.2 AA, serious and critical) on every route in dark and light themes. `RATE_LIMIT_OFF=1` lets the
  suite share one IP; it is ignored in production.
- `tests/e2e/tv.spec.ts` runs the TV layout at 960×540 with arrow keys only. CI's `android-tv` job boots an
  Android 11 TV emulator (GitHub runners have KVM; the VPS does not), drives a debug build pointed at the
  branch's server with D-pad key events (`tests/android-tv/smoke.mjs`), then runs the R8-shrunk release build
  against the live site (`tests/android-tv/release-smoke.sh`).
- Hosting: Coolify on the Sataklela VPS, deployed from `main` (see [Deploy](/runbook/deploy)).
- `pnpm load` simulates 40 SSE viewers and 25 contributors × 6 songs (memory, or the emulator when
  `FIRESTORE_EMULATOR_HOST` is set).
- Commands on one event are serialised in-process (memory and Firestore adapters), because they all rewrite
  the same event document; transactions still protect against a second instance.
- Retention: see [Backup and retention](/runbook/backup).

## Status

See the [changelog](/changelog) for what each release contains.
