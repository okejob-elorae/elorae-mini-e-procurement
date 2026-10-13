import { describe, it, expect } from "vitest";
import { buildPaymentReminderCopy } from "./payment-reminder-copy";

/* 20 Oct 2026 00:00 WIB = 19 Oct 2026 17:00 UTC — the shape every PO due date is stored in. */
const DUE = new Date("2026-10-19T17:00:00.000Z");
const BASE = { docNumber: "PO/2026/10/0001", supplierName: "Acme Textile", amount: 1500000, dueDate: DUE };

describe("buildPaymentReminderCopy", () => {
  it("counts down before the due date", () => {
    const { title, message } = buildPaymentReminderCopy({ ...BASE, daysRelative: -7 });
    expect(title).toBe("Pembayaran PO PO/2026/10/0001 jatuh tempo 7 hari lagi — Acme Textile");
    expect(message).toBe("PO PO/2026/10/0001 ke Acme Textile sebesar Rp 1.500.000 jatuh tempo pada 20 Okt 2026.");
  });

  it("names the due day itself", () => {
    const { title, message } = buildPaymentReminderCopy({ ...BASE, daysRelative: 0 });
    expect(title).toBe("Pembayaran PO PO/2026/10/0001 jatuh tempo hari ini — Acme Textile");
    expect(message).toBe("PO PO/2026/10/0001 ke Acme Textile sebesar Rp 1.500.000 jatuh tempo pada 20 Okt 2026.");
  });

  it("counts days past due", () => {
    const { title, message } = buildPaymentReminderCopy({ ...BASE, daysRelative: 7 });
    expect(title).toBe("Pembayaran PO PO/2026/10/0001 lewat 7 hari dari jatuh tempo — Acme Textile");
    expect(message).toBe("PO PO/2026/10/0001 ke Acme Textile sebesar Rp 1.500.000 sudah lewat jatuh tempo pada 20 Okt 2026.");
  });

  it("renders the WIB day, never the previous UTC day", () => {
    const { message } = buildPaymentReminderCopy({ ...BASE, daysRelative: -1 });
    expect(message).toContain("20 Okt 2026");
    expect(message).not.toContain("19 Okt 2026");
  });

  it("keeps sen when the total has them", () => {
    const { message } = buildPaymentReminderCopy({ ...BASE, amount: 1500000.5, daysRelative: -1 });
    expect(message).toContain("Rp 1.500.000,5");
  });

  it("caps the title at 191 characters for a very long supplier name", () => {
    const { title } = buildPaymentReminderCopy({ ...BASE, supplierName: "S".repeat(400), daysRelative: -1 });
    expect(Array.from(title).length).toBeLessThanOrEqual(191);
    expect(title.startsWith("Pembayaran PO PO/2026/10/0001")).toBe(true);
  });
});
