export const FULFILLMENT_FORBIDDEN_REASON = "forbidden";

export type FulfillmentActionResult = { ok: true } | { ok: false; reason: string };
export type CourierOption = { id: number; name: string };
