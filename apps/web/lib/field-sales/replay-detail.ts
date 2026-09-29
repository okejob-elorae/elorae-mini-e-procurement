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
