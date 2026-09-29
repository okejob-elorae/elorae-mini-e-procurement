import { formatDateOnlyJakarta } from "@/lib/date-only";
import type { DeliveryReplayDetail } from "./errors";

/** What a `REPLAY_MISMATCH` carries to the client: dates as WIB `YYYY-MM-DD`, lines as plain qty. */
export type SerializedReplay = {
  deliveryId: string;
  docNo: string;
  invoiceDate: string;
  dueDate: string;
  lines: Array<{ orderLineId: string; qty: number }>;
};

export function serializeReplay(replay: DeliveryReplayDetail): SerializedReplay {
  return {
    deliveryId: replay.deliveryId,
    docNo: replay.docNo,
    invoiceDate: formatDateOnlyJakarta(replay.invoiceDate),
    dueDate: formatDateOnlyJakarta(replay.dueDate),
    lines: replay.lines.map((l) => ({ orderLineId: l.orderLineId, qty: l.qty })),
  };
}

/**
 * The recorded quantity per SHIPMENT line, for a completion form to prefill and display.
 * `replay.lines` is summed per `orderLineId`, and two shipment lines can share one, so the sum is
 * handed out in shipment-line order, each line taking at most its `plannedQty` — the first line
 * takes it all whenever it can hold it, and the rest take 0. Handing the sum to EACH line would
 * make the resubmit ask for it twice, and handing all of it to a first line planned for less would
 * be refused `OVER_PLANNED`. A shipment line the record lacks delivered 0.
 */
export function recordedQtyByShipmentLine(
  lines: ReadonlyArray<{ id: string; orderLineId: string; plannedQty: number }>,
  replay: Pick<SerializedReplay, "lines">,
): Map<string, number> {
  const remaining = new Map(replay.lines.map((l) => [l.orderLineId, l.qty]));
  const result = new Map<string, number>();
  for (const line of lines) {
    const left = remaining.get(line.orderLineId) ?? 0;
    const qty = Math.min(left, line.plannedQty);
    result.set(line.id, qty);
    remaining.set(line.orderLineId, left - qty);
  }
  return result;
}
