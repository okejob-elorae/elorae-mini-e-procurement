import { capNotificationText } from "@/lib/notifications/text";

export const SALES_RETURN_RECEIVED = "SALES_RETURN_RECEIVED";

/* A cron has no request locale, so the bell copy carries its own channel names. */
const CHANNEL_LABEL: Record<string, string> = {
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  TOKOPEDIA: "Tokopedia",
  OTHER: "Lainnya",
  OFFLINE: "Offline",
};

const NUMBER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

function present(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value.trim() : null;
}

/**
 * Indonesian bell copy for one newly ingested marketplace return. The buyer's name is
 * deliberately absent: this text and its metadata ride in the FCM push to phones.
 */
export function buildSalesReturnBellCopy(input: {
  jubelioReturnNo: string | null;
  channelOrderNo: string | null;
  channel: string;
  totalQty: number;
  totalValue: number;
  salesorderNo: string | null;
}): { title: string; message: string } {
  const label = CHANNEL_LABEL[input.channel] ?? input.channel;
  const number = present(input.jubelioReturnNo) ?? present(input.channelOrderNo) ?? "tanpa nomor";
  const title = capNotificationText(`Retur baru dari ${label} — ${number}`);
  const order = present(input.salesorderNo);
  const message =
    `${NUMBER.format(input.totalQty)} pcs senilai Rp ${NUMBER.format(input.totalValue)}` +
    `${order ? ` · pesanan ${order}` : ""}. Menunggu keputusan.`;
  return { title, message };
}
