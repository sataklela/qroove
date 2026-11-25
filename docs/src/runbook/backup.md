# Backup and retention

## What is kept, and for how long

The server runs a retention purge when it starts and every 6 hours (production runs a single
instance, so no separate cron service is needed). It can also be triggered from outside.

| Data                                                | Deleted                                  |
| --------------------------------------------------- | ---------------------------------------- |
| Abandoned `DRAFT` events (whole event and its slug) | 7 days after creation                    |
| Participants: token hashes and nicknames            | 30 days after the event ended            |
| Audit records                                       | 90 days after they were written          |
| Idempotency records                                 | 24 hours (Firestore TTL needs billing)   |
| Songs, styles and play history of an ended event    | Kept, as an anonymised playlist snapshot |

The purge is idempotent. Run it by hand with the shared secret (the route is absent when `CRON_SECRET` is
unset):

```sh
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://qroove.sataklela.com/api/internal/purge
# {"draftsDeleted":0,"participantsDeleted":3,"auditDeleted":120,"idempotencyDeleted":40}
```

The cut-offs live in `apps/server/src/maintenance/purge.ts`; the privacy page and this table must change
with them.

## Backups

Scheduled Firestore exports (`gcloud firestore export`) need the Blaze plan, which this project does not use.
The free alternative is the event's played-and-unplayed song list, which has songs, styles and order and no people:

- Organiser: songs that never played are offered as **Carry over to a new event** when an event ends, and the read-only
  list of an ended event is at `/h/<code>`. The API behind them is `GET /api/events/:id/export`.
- Starting a new event from a streaming playlist link is covered in the organiser guide.

A deleted or lost live event cannot be restored to its exact state; the carry-over list is a playlist, not a database
dump. To move to Blaze later, add a scheduled `gcloud firestore export` to a Cloud Storage bucket.
