import { describe, expect, it } from "vitest";
import { buildActionItems } from "@/lib/dashboard/action-items";
import { jalurTautan, KUNCI_ANTREAN } from "@/lib/dashboard/antrean-kantor";
import { grupUntukRute, navItems } from "./menu";

/*
 * Setiap baris "perlu ditindaklanjuti" Beranda harus jatuh ke grup menu yang
 * ADA dan ke halaman yang ada di menu — kalau tidak, lencananya hilang diam-diam
 * (seperti jurnal gagal dan faktur pajak yang dulu dipetakan ke grup "#").
 */

const semuaSatu = buildActionItems(
  {
    fieldSalesPendingApproval: 1,
    storeChangesPending: 1,
    taxInvoicePending: 1,
    salesReturnPending: 1,
    journalPending: 1,
    overduePOs: 1,
    draftPOs: 1,
    oversoldSkus: 1,
    unshippedOrders: 1,
    overduePromises: { count: 1, amount: 1 },
    claimsAwaitingVerification: { count: 1, amount: 1 },
    claimsAwaitingOthers: { count: 1, amount: 1 },
    antrean: Object.fromEntries(KUNCI_ANTREAN.map((k) => [k, 1])),
  },
  ["*"],
);

const hrefInduk = new Set(navItems.map((i) => i.href));
const hrefAnak = new Set(navItems.flatMap((i) => (i.children ?? []).map((c) => c.href)));

describe("grupUntukRute — lencana setiap baris Beranda", () => {
  it("semua baris ikut (inti + enam belas antrean kantor)", () => {
    expect(semuaSatu.length).toBe(12 + KUNCI_ANTREAN.length);
  });

  for (const item of semuaSatu) {
    it(`${item.key} → grup menu yang ada dan halaman yang ada di menu`, () => {
      const jalur = jalurTautan(item.href);
      const grup = grupUntukRute(jalur);
      expect(grup, item.href).not.toBeNull();
      expect(hrefInduk.has(grup!)).toBe(true);
      expect(hrefAnak.has(jalur), jalur).toBe(true);
    });
  }

  it("jurnal gagal dan faktur pajak di Buku Besar; BKM dan janji bayar di Piutang", () => {
    const grupDari = (k: string) => grupUntukRute(jalurTautan(semuaSatu.find((i) => i.key === k)!.href));
    expect(grupDari("journalPending")).toBe("/backoffice/finance/journals");
    expect(grupDari("taxInvoicePending")).toBe("/backoffice/finance/journals");
    expect(grupDari("claimsAwaitingVerification")).toBe("/backoffice/pelunasan-dasbor");
    expect(grupDari("overduePromises")).toBe("/backoffice/pelunasan-dasbor");
  });
});
