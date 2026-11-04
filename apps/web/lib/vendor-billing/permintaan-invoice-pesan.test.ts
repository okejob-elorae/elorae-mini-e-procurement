import { describe, it, expect } from "vitest";
import { susunPesanMintaInvoice, tautanWaPermintaan } from "./permintaan-invoice-pesan";

describe("susunPesanMintaInvoice", () => {
  it("lists every receipt with its value, in Indonesian", () => {
    const teks = susunPesanMintaInvoice({
      namaPemasok: "CV Sinar",
      baris: [
        { nomor: "GRN/2026/11/0003 (PO-12)", keterangan: "Kaos Hitam", tanggal: "2026-11-03", qty: 100, nilaiSen: 80_000_000 },
        { nomor: "WO-01 · 1 Jahit", keterangan: "Jahit", tanggal: "2026-11-04", qty: 300, nilaiSen: null },
      ],
      catatan: "Tolong sebutkan nomor GRN di invoice.",
    });
    expect(teks).toContain("Halo CV Sinar,");
    expect(teks).toContain("GRN/2026/11/0003 (PO-12), diterima 3 Nov 2026: Kaos Hitam 100 pcs — Rp 800.000");
    expect(teks).toContain("300 pcs — nilai belum tercatat");
    expect(teks).toContain("Tolong sebutkan nomor GRN di invoice.");
    expect(teks.trim().endsWith("Terima kasih.")).toBe(true);
  });

  it("opens a follow-up with the date of the earlier ask", () => {
    const teks = susunPesanMintaInvoice({ namaPemasok: "A", baris: [{ nomor: "GRN-1", keterangan: "X", tanggal: "2026-11-01", qty: 1, nilaiSen: 100 }], ulang: { tanggal: "2026-11-02" } });
    expect(teks).toContain("Menindaklanjuti permintaan kami tanggal 2 Nov 2026");
  });
});

describe("tautanWaPermintaan", () => {
  it("falls back to wa.me/?text= without a usable number", () => {
    expect(tautanWaPermintaan(null, "halo")).toBe("https://wa.me/?text=halo");
  });
});
