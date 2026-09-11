export const JUBELIO_OUTBOX_QUEUE = "jubelio-outbox";

export const OUTBOX_QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: 1,
} as const;

export const OUTBOX_POLLER = {
  INTERVAL_MS: 5_000,
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
} as const;

/**
 * Jubelio warehouse location the PICK and SHIP pushes send. Pack sends no
 * location at all (`/wms/sales/packlist/mark-as-complete/` takes only `{ids}`) —
 * do not "complete" its body by adding one.
 *
 * `-1` is the id of the tenant's only location, "Warehouse Elorae", read live
 * from `GET /jubelio/locations` on 2026-09-02. It is a real id, not a sentinel
 * standing in for one — though note the live read cannot settle whether the `-1`
 * in stock WEBHOOK payloads means this location or "all locations", because with
 * a single location both readings look identical.
 *
 * This shipped as `1` from the fulfilment slice until 2026-09-02, and `1` does
 * not exist on this account. Pick pushes failed Joi validation on the payload
 * shape first (`child "picklist_no" fails …`); once that was fixed they got
 * further and died on `location_picklist_header` foreign-key violations
 * (`code: "23503"`). Ship carried the same wrong value and was never reached.
 * Do not "correct" the negative number — re-read the endpoint before changing it.
 *
 * Single warehouse today; widen to a per-order lookup before onboarding a second.
 */
export const JUBELIO_WMS_LOCATION_ID = -1;
