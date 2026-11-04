import { describe, expect, it } from "vitest";
import { buildActionItems } from "@/lib/dashboard/action-items";
import { jalurTautan, KUNCI_ANTREAN } from "@/lib/dashboard/antrean-kantor";
import { bolehMembukaKomisiSpg, bolehMemutuskanBeban, bolehMemverifikasi, bolehMengelola } from "@/lib/receivables/izin";
import { bolehMembukaCatatanHadir } from "@/lib/spg/absen-catatan-hadir";
import { bolehAnak, grupUntukRute, navItems } from "./menu";

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
  it("semua baris ikut (inti + setiap antrean kantor)", () => {
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

  it("jurnal gagal dan faktur pajak di Pembukuan; BKM dan janji bayar di Keuangan", () => {
    const grupDari = (k: string) => grupUntukRute(jalurTautan(semuaSatu.find((i) => i.key === k)!.href));
    expect(grupDari("journalPending")).toBe("/backoffice/finance/journals");
    expect(grupDari("taxInvoicePending")).toBe("/backoffice/finance/journals");
    expect(grupDari("claimsAwaitingVerification")).toBe("/backoffice/pelunasan-dasbor");
    expect(grupDari("overduePromises")).toBe("/backoffice/pelunasan-dasbor");
  });
});

/*
 * Anak menu = pagar halaman tujuannya (jawaban pemilik 2026-11-02, putaran kedua). Halaman-halaman
 * ini memagari dirinya sendiri (tidak di ROUTE_PERMISSIONS), jadi menunya diuji terhadap fungsi
 * pagar yang dipakai `page.tsx`-nya — bukan disalin dari menunya.
 */
describe("menu — anak yang pagarnya fungsi halaman", () => {
  const anak = (href: string) => navItems.flatMap((i) => i.children ?? []).find((c) => c.href === href);
  const SATU_SATU = [
    "spg_sales:view",
    "spg_commission:pay",
    "payments:verify",
    "spg_attendance:record",
    "spg_attendance:verify",
    "receivables:manage",
    "receivables:decide_bearer",
    "deliveries:ship",
    "deliveries:pod",
    "deliveries:cancel_nota",
    "inventory:view",
  ].map((p) => [p]);

  it("Komisi SPG: terlihat ⇔ `komisi-spg/page.tsx` terbuka (P28 — Keuangan membuka halaman ini)", () => {
    const pagar = (izin: string[]) => bolehMembukaKomisiSpg(izin) || bolehMemverifikasi(izin);
    for (const izin of SATU_SATU) {
      expect({ izin, terlihat: bolehAnak(izin, anak("/backoffice/komisi-spg")?.permission) }).toEqual({ izin, terlihat: pagar(izin) });
    }
  });

  it("Catatan check-in toko: terlihat ⇔ `bolehMembukaCatatanHadir`", () => {
    expect(anak("/backoffice/komisi-spg/catatan-hadir")).toBeDefined();
    for (const izin of SATU_SATU) {
      expect({ izin, terlihat: bolehAnak(izin, anak("/backoffice/komisi-spg/catatan-hadir")?.permission) }).toEqual({
        izin,
        terlihat: bolehMembukaCatatanHadir(izin),
      });
    }
    // Rute anaknya sendiri yang menyala, bukan Komisi SPG di atasnya.
    expect(grupUntukRute("/backoffice/komisi-spg/catatan-hadir")).toBe(grupUntukRute("/backoffice/komisi-spg"));
  });

  it("Barang hilang: tetap tanpa payments:verify (P28 — Keuangan hanya halaman Komisi SPG)", () => {
    const pagar = (izin: string[]) => bolehMengelola(izin) || bolehMemutuskanBeban(izin) || izin.includes("spg_sales:view");
    for (const izin of SATU_SATU) {
      expect({ izin, terlihat: bolehAnak(izin, anak("/backoffice/barang-hilang")?.permission) }).toEqual({ izin, terlihat: pagar(izin) });
    }
  });

  it("Pengiriman: Admin Penjualan (deliveries:cancel_nota) menemukan halaman yang memuat tombol batalnya (P41a)", () => {
    expect(bolehAnak(["deliveries:cancel_nota"], anak("/backoffice/deliveries")?.permission)).toBe(true);
    expect(bolehAnak(["inventory:view"], anak("/backoffice/deliveries")?.permission)).toBe(false);
  });
});
