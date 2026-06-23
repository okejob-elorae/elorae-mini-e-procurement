/**
 * Canonical registry of JubelioOutbox.entityType values.
 *
 * Every outbox row insert (web side) and dispatch (api side) MUST use a value
 * from this list. Adding a new entityType: append it here, add a router case
 * in apps/api/src/jubelio/outbox/outbox-router.ts, and a handler.
 *
 * See docs/INTEGRATION-GUIDE.md for the full workflow.
 */
export const JUBELIO_OUTBOX_ENTITY_TYPES = [
  "stock_push",
  "product_push",
  "salesorder_pick",
  "salesorder_pack",
  "salesorder_ship",
  "salesreturn_decision_push",
] as const;

export type JubelioOutboxEntityType = (typeof JUBELIO_OUTBOX_ENTITY_TYPES)[number];

export function isJubelioOutboxEntityType(value: unknown): value is JubelioOutboxEntityType {
  return (
    typeof value === "string" &&
    (JUBELIO_OUTBOX_ENTITY_TYPES as readonly string[]).includes(value)
  );
}
