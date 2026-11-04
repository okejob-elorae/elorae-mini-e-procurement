import { describe, expect, it } from "vitest";
import { KUNCI_KETERANGAN, keteranganJurnal, memoJurnal, teksKeteranganJurnal } from "./keterangan-tampil";
import idMessages from "@/lib/i18n/messages/id.json";
import enMessages from "@/lib/i18n/messages/en.json";

describe("keteranganJurnal — keterangan Inggris lama dibaca sebagai kode", () => {
  it.each([
    ["Sale SP-260930UJIAKUN0253", "penjualan", { nomor: "SP-260930UJIAKUN0253" }],
    ["COGS TT-570930UJIAKUN0252-1", "hppPenjualan", { nomor: "TT-570930UJIAKUN0252-1" }],
    ["Return UJIAKUN-RTR-0001", "retur", { nomor: "UJIAKUN-RTR-0001" }],
    ["Return COGS UJIAKUN-RTR-0001", "hppRetur", { nomor: "UJIAKUN-RTR-0001" }],
    ["GRN GRN/2026/09/0002", "penerimaanBarang", { nomor: "GRN/2026/09/0002" }],
    ["GRN reversal GRN/2026/09/0002", "batalPenerimaanBarang", { nomor: "GRN/2026/09/0002" }],
    ["FG receipt RCPT/2026/09/0002", "penerimaanBarangJadi", { nomor: "RCPT/2026/09/0002" }],
    ["Opname adjustment OPN/2026/09/0002", "penyesuaianOpname", { nomor: "OPN/2026/09/0002" }],
    ["Van load VL/2026/0001", "muatKanvas", { nomor: "VL/2026/0001" }],
    ["Van sale VS/2026/0001", "penjualanKanvas", { nomor: "VS/2026/0001" }],
    ["Van reconcile VR/2026/0001", "rekonsiliasiKanvas", { nomor: "VR/2026/0001" }],
    ["Supplier payment PO/2026/0068", "pembayaranPemasok", { nomor: "PO/2026/0068" }],
    ["Supplier payment reversal PO/2026/0068", "batalPembayaranPemasok", { nomor: "PO/2026/0068" }],
    ["Marketplace settlement — elorae.official", "settlement", { toko: "elorae.official" }],
  ])("%s", (teks, kunci, nilai) => {
    expect(keteranganJurnal(teks)).toEqual({ kunci, nilai });
  });

  it("keterangan Indonesia penulis baru juga dikenali (supaya pembaca berbahasa Inggris membacanya dalam bahasanya)", () => {
    expect(keteranganJurnal("Penjualan SP-1")).toEqual({ kunci: "penjualan", nilai: { nomor: "SP-1" } });
    expect(keteranganJurnal("Penjualan kanvas VS-1")).toEqual({ kunci: "penjualanKanvas", nilai: { nomor: "VS-1" } });
    expect(keteranganJurnal("HPP retur penjualan R-1")).toEqual({ kunci: "hppRetur", nilai: { nomor: "R-1" } });
    expect(keteranganJurnal("Penerimaan barang jadi RCPT-1 (WO WO-1)")).toEqual({
      kunci: "penerimaanBarangJadi",
      nilai: { nomor: "RCPT-1 (WO WO-1)" },
    });
    expect(keteranganJurnal("Pembatalan penerimaan barang GRN-1")).toEqual({
      kunci: "batalPenerimaanBarang",
      nilai: { nomor: "GRN-1" },
    });
  });

  it("jurnal manual dan teks tak dikenal tampil apa adanya", () => {
    expect(keteranganJurnal("Sale aset lama", { manual: true })).toEqual({ teks: "Sale aset lama" });
    expect(keteranganJurnal("UJIAKUN · Sewa gudang Agustus")).toEqual({ teks: "UJIAKUN · Sewa gudang Agustus" });
    expect(keteranganJurnal("  ")).toEqual({ teks: "" });
  });

  it("awalan tanpa nomor bukan kode", () => {
    expect(keteranganJurnal("Sale")).toEqual({ teks: "Sale" });
    expect(keteranganJurnal("Sale ")).toEqual({ teks: "Sale" });
  });
});

describe("teksKeteranganJurnal", () => {
  const t = (kunci: string, nilai?: Record<string, string>) =>
    `[${kunci}:${Object.values(nilai ?? {}).join(",")}]`;

  it("menerjemahkan lewat i18n", () => {
    expect(teksKeteranganJurnal(t, "Sale SP-1")).toBe("[keterangan.penjualan:SP-1]");
  });

  it("teks tersimpan bila tidak dikenal", () => {
    expect(teksKeteranganJurnal(t, "Biaya lain")).toBe("Biaya lain");
  });
});

describe("kunci i18n", () => {
  it.each(KUNCI_KETERANGAN)("financeJournals.keterangan.%s ada di dua bahasa dengan placeholder yang sama", (kunci) => {
    const id = (idMessages as { financeJournals: { keterangan: Record<string, string> } }).financeJournals.keterangan[kunci];
    const en = (enMessages as { financeJournals: { keterangan: Record<string, string> } }).financeJournals.keterangan[kunci];
    expect(typeof id).toBe("string");
    expect(typeof en).toBe("string");
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    expect(ph(id)).toEqual(ph(en));
  });
});

describe("memoJurnal", () => {
  const labelPeran = (peran: string) => ({ BANK: "Bank", AR_STORE: "Piutang usaha toko", PPN_KELUARAN: "PPN keluaran" })[peran] ?? null;

  it("memo nama peran ditulis dengan label perannya", () => {
    expect(memoJurnal("BANK", labelPeran)).toBe("Bank");
  });

  it("memo gabungan peran + DPP", () => {
    expect(memoJurnal("PPN_KELUARAN · DPP 1000000.00", labelPeran)).toBe("PPN keluaran · DPP Rp 1.000.000");
  });

  it("memo DPP sendiri", () => {
    expect(memoJurnal("DPP 123.45", labelPeran)).toBe("DPP Rp 123");
  });

  it("memo bebas tetap apa adanya; kosong → null", () => {
    expect(memoJurnal("Jasa produksi WO WO/2026/0015", labelPeran)).toBe("Jasa produksi WO WO/2026/0015");
    expect(memoJurnal("MARKETPLACE_FEE_ADMIN", labelPeran)).toBe("MARKETPLACE_FEE_ADMIN");
    expect(memoJurnal(null, labelPeran)).toBeNull();
    expect(memoJurnal("  ", labelPeran)).toBeNull();
  });
});
