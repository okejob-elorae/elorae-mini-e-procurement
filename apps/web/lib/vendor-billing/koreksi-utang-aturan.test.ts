import { describe, it, expect } from "vitest";
import type { PengaturanPpn } from "@/lib/finance/pajak/ppn";
import {
  barisJurnalBalikKoreksiUtang,
  barisJurnalKoreksiUtang,
  bolehKoreksiInvoice,
  selisihUtangBarisGrn,
  selisihUtangLangkah,
} from "./koreksi-utang-aturan";

const PKP: PengaturanPpn = { statusPkp: "PKP", tarifPersen: 12, pakaiDppNilaiLain: true, hargaJualTermasukPpn: true, berlakuSejak: "2026-02-18" };
const NON_PKP: PengaturanPpn = { ...PKP, statusPkp: "NON_PKP" };
const tgl = (s: string) => new Date(`${s}T00:00:00+07:00`);

const grn = (over: Partial<Parameters<typeof selisihUtangBarisGrn>[0]>) =>
  selisihUtangBarisGrn({
    qty: 100,
    hargaInvoice: 8500,
    hargaTercatat: 8000,
    itemId: "kaos",
    variantSku: null,
    mode: "TANPA",
    tarifPo: 11,
    pengaturan: PKP,
    tanggalGrn: tgl("2026-11-03"),
    grnId: "g1",
    ...over,
  });

const seimbang = (lines: Array<{ debit: number; credit: number }>) =>
  Math.round(lines.reduce((s, l) => s + l.debit * 100 - l.credit * 100, 0));

describe("selisihUtangBarisGrn", () => {
  it("Include PPN / tanpa PO: the difference as it is, both directions (P27, P53)", () => {
    expect(grn({}).jumlah).toBe(50_000);
    expect(grn({}).persediaan).toBe(50_000);
    const turun = grn({ hargaInvoice: 7500 });
    expect(turun.jumlah).toBe(-50_000);
    expect(turun.persediaan).toBe(-50_000);
    expect(turun.rincian[0]).toMatchObject({ dokumen: "GRN", dokumenId: "g1", qty: 100, persediaan: -50_000 });
  });

  it("PPN masukan key: input VAT of the difference kept apart, sign kept", () => {
    const naik = grn({ mode: "PPN_MASUKAN" });
    expect(naik.persediaan).toBe(50_000);
    expect(naik.ppnMasukan).toBeGreaterThan(0);
    expect(naik.jumlah).toBe(naik.persediaan + naik.ppnMasukan);
    const turun = grn({ mode: "PPN_MASUKAN", hargaInvoice: 7500 });
    expect(turun.ppnMasukan).toBe(-naik.ppnMasukan);
    expect(turun.jumlah).toBe(-naik.jumlah);
  });

  it("PPN capitalised key (not PKP): the PPN goes into the inventory value", () => {
    const r = grn({ mode: "PPN_MODAL", pengaturan: NON_PKP });
    expect(r.ppnMasukan).toBe(0);
    expect(r.persediaan).toBeGreaterThan(50_000);
    expect(r.jumlah).toBe(r.persediaan);
    expect(r.dpp).toBe(50_000);
  });

  it("no correction below Rp 0,01", () => {
    expect(grn({ hargaInvoice: 8000 }).jumlah).toBe(0);
    expect(grn({ hargaInvoice: 8000 }).rincian).toEqual([]);
  });
});

describe("selisihUtangLangkah", () => {
  const langkah = { id: "s1", supplierId: "p1", servicePrice: 7000, servicePpnIncluded: false, pemasokPkp: true };

  it("treats each finished-goods receipt by Elorae's PKP status on ITS date", () => {
    const r = selisihUtangLangkah({
      langkah,
      hargaInvoice: 7500,
      itemId: "kaos",
      pengaturan: PKP,
      bagian: [
        { fgReceiptId: "r1", nomor: "RCV-1", tanggal: tgl("2026-01-10"), qty: 50, varian: [{ variantSku: "M", porsi: 30 }, { variantSku: "L", porsi: 20 }] },
        { fgReceiptId: "r2", nomor: "RCV-2", tanggal: tgl("2026-03-01"), qty: 50, varian: [] },
      ],
    });
    const r1 = r.rincian.filter((x) => x.dokumenId === "r1");
    const r2 = r.rincian.filter((x) => x.dokumenId === "r2");
    expect(r1.every((x) => x.ppnMasukan === 0)).toBe(true);
    expect(r1.map((x) => x.variantSku)).toEqual(["M", "L"]);
    expect(r2[0].ppnMasukan).toBeGreaterThan(0);
    expect(Math.round((r.persediaan + r.ppnMasukan) * 100)).toBe(Math.round(r.jumlah * 100));
    expect(r.jumlah).toBeGreaterThan(50_000);
  });

  it("nothing when the invoice price equals the WO price", () => {
    expect(selisihUtangLangkah({ langkah, hargaInvoice: 7000, itemId: "kaos", pengaturan: PKP, bagian: [{ fgReceiptId: "r1", nomor: "", tanggal: tgl("2026-03-01"), qty: 10, varian: [] }] }).jumlah).toBe(0);
  });
});

describe("barisJurnalKoreksiUtang", () => {
  it("higher invoice: DR stock, DR price variance (goods out), DR input VAT, CR AP — balanced, zero lines dropped", () => {
    const lines = barisJurnalKoreksiUtang({ jumlah: 55_500, dpp: 50_000, ppnMasukan: 5_500, stok: [{ peran: "INVENTORY", nilai: 37_500 }], keluar: 12_500 });
    expect(seimbang(lines)).toBe(0);
    expect(lines.map((l) => [l.role, l.debit, l.credit])).toEqual([
      ["INVENTORY", 37_500, 0],
      ["PURCHASE_PRICE_VARIANCE", 12_500, 0],
      ["PPN_MASUKAN", 5_500, 0],
      ["AP", 0, 55_500],
    ]);
    const tanpaKeluar = barisJurnalKoreksiUtang({ jumlah: 50_000, dpp: 50_000, ppnMasukan: 0, stok: [{ peran: "INVENTORY", nilai: 50_000 }], keluar: 0 });
    expect(tanpaKeluar.map((l) => l.role)).toEqual(["INVENTORY", "AP"]);
  });

  it("lower invoice mirrors, and the void reversal mirrors again", () => {
    const turun = barisJurnalKoreksiUtang({ jumlah: -50_000, dpp: -50_000, ppnMasukan: 0, stok: [{ peran: "INVENTORY_FG", nilai: -40_000 }, { peran: "INVENTORY_CONSIGNMENT", nilai: -5_000 }], keluar: -5_000 });
    expect(seimbang(turun)).toBe(0);
    expect(turun.find((l) => l.role === "AP")).toMatchObject({ debit: 50_000, credit: 0 });
    const balik = barisJurnalBalikKoreksiUtang({ jumlah: 55_500, dpp: 50_000, ppnMasukan: 5_500, stok: [{ peran: "INVENTORY", nilai: 30_000 }], keluar: 20_000 });
    expect(seimbang(balik)).toBe(0);
    expect(balik.find((l) => l.role === "AP")).toMatchObject({ debit: 55_500, credit: 0 });
    expect(balik.find((l) => l.role === "PPN_MASUKAN")).toMatchObject({ debit: 0, credit: 5_500 });
  });
});

describe("bolehKoreksiInvoice", () => {
  it("only a higher invoice, and never on a line that booked old CMT", () => {
    expect(bolehKoreksiInvoice({ jumlah: 50_000, adaCmtLama: false })).toBe("OK");
    expect(bolehKoreksiInvoice({ jumlah: -50_000, adaCmtLama: false })).toBe("KOREKSI_TIDAK_BOLEH_NAIK");
    expect(bolehKoreksiInvoice({ jumlah: 50_000, adaCmtLama: true })).toBe("ADA_CMT_LAMA");
  });
});
