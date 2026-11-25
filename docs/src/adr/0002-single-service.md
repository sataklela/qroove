# ADR 0002 — One service serves API, app and docs

**Status:** accepted

> **Update 2026-11-19:** hosting moved from Railway to Coolify on the Sataklela VPS; the single-service design is unchanged.

## Decision

A single Fastify process serves `/api/*`, the built SPA and the built docs (`/docs`). One Railway
service, one instance.

## Consequences

- Simplest deploy and no CORS. Realtime fan-out can stay in-process.
- Scaling out later needs the Firestore `onSnapshot` fan-out described in the plan.
