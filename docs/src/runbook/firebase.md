# Firebase

| Item        | Value                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Project     | `qroove-sataklela` (Spark plan, no billing)                                                                                     |
| Database    | Firestore Native, `(default)`, multi-region `eur3`                                                                              |
| Rules       | Deny all. Browsers never talk to Firestore; only the server does, via Admin SDK                                                 |
| Server user | `qroove-server@qroove-sataklela.iam.gserviceaccount.com`, role `datastore.user`                                                 |
| Credentials | Key JSON, base64 in the Coolify variable `FIREBASE_SERVICE_ACCOUNT_B64` (app `qroove-web`); local copy `.secrets/` (gitignored) |

## Operations

- Deploy rules and indexes: `firebase deploy --only firestore --project qroove-sataklela`.
- Local development and tests use the emulator (`pnpm --filter @qroove/server test:emulator`) or the memory
  repository; never point tests at the production project.
- Spark-plan quotas (50k reads and 20k writes a day) are ample for a society night, but a very long event with
  many viewers reloading could approach the read limit; watch the Firebase usage page after the pilot.
- No TTL policies (they need billing); retention is done by the server's purge job, see
  [Backup and retention](/runbook/backup).

## Rotating the service-account key

1. Create a new key for the service account in Google Cloud IAM; base64 it (`base64 -w0 key.json`).
2. Set `FIREBASE_SERVICE_ACCOUNT_B64` in Coolify (see [Deploy](/runbook/deploy)) and redeploy; check the logs
   for the purge line. **Add roles, never edit or replace them** on the service account (2026-11-19 outage).
3. Delete the old key in IAM.
