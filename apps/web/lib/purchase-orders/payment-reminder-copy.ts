import { capNotificationText } from "@/lib/notifications/text";

export const PO_PAYMENT_DUE = "PO_PAYMENT_DUE";

/* Pinned to Asia/Jakarta: prod runs in UTC, where a WIB-midnight due date would print as the day before. */
const WIB_DATE = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const RUPIAH = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

function timing(daysRelative: number): string {
  if (daysRelative < 0) return `jatuh tempo ${-daysRelative} hari lagi`;
  if (daysRelative === 0) return "jatuh tempo hari ini";
  return `lewat ${daysRelative} hari dari jatuh tempo`;
}

/** Indonesian bell copy for one PO payment reminder; the title is capped to `AdminNotification.title`'s VARCHAR(191). */
export function buildPaymentReminderCopy(input: {
  docNumber: string;
  supplierName: string;
  amount: number;
  dueDate: Date;
  daysRelative: number;
}): { title: string; message: string } {
  const { docNumber, supplierName, amount, dueDate, daysRelative } = input;
  const title = capNotificationText(`Pembayaran PO ${docNumber} ${timing(daysRelative)} — ${supplierName}`);
  const verb = daysRelative > 0 ? "sudah lewat jatuh tempo pada" : "jatuh tempo pada";
  const message = `PO ${docNumber} ke ${supplierName} sebesar Rp ${RUPIAH.format(amount)} ${verb} ${WIB_DATE.format(dueDate)}.`;
  return { title, message };
}
