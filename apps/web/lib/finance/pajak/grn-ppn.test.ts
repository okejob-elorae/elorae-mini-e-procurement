import { describe, expect, it } from "vitest";
import { PPN_BAWAAN, type PengaturanPpn } from "./ppn";
import { hitungPpnMasukanGrn, kunciBarisPpn, ppnMasukanGrn } from "./grn-ppn";

const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP" };
const TGL = new Date("2026-10-08T03:00:00Z");

const barisPo = [
  { itemId: "kain", variantSku: null, ppnIncluded: false },
  { itemId: "kaos", variantSku: "KAOS-M", ppnIncluded: false },
  { itemId: "kancing", variantSku: null, ppnIncluded: true },
];

describe("PPN masukan GRN", () => {
  it("PKP: hanya baris PO 'Exclude PPN' yang dikenai PPN, dihitung sekali atas jumlahnya", () => {
    const r = ppnMasukanGrn({
      baris: [
        { itemId: "kain", nilai: 60_000 },
        { itemId: "kaos", variantSku: "KAOS-M", nilai: 40_000 },
        { itemId: "kancing", nilai: 5_000 },
        { itemId: "kaos", variantSku: "KAOS-L", nilai: 9_000 },
      ],
      barisPo,
      tarifPo: 11,
      pengaturan: PKP,
      tanggal: TGL,
    });
    expect(r.ppn).toBe(11_000);
    expect(r.dpp).toBe(100_000);
    expect([...r.kenaPpn].sort()).toEqual([kunciBarisPpn("kain", null), kunciBarisPpn("kaos", "KAOS-M")].sort());
  });

  it("tanpa PPN: bukan PKP, PO lama tanpa tarif, GRN tanpa PO, sebelum berlakuSejak", () => {
    const baris = [{ itemId: "kain", nilai: 60_000 }];
    expect(ppnMasukanGrn({ baris, barisPo, tarifPo: 11, pengaturan: PPN_BAWAAN, tanggal: TGL }).ppn).toBe(0);
    expect(ppnMasukanGrn({ baris, barisPo, tarifPo: null, pengaturan: PKP, tanggal: TGL }).ppn).toBe(0);
    expect(ppnMasukanGrn({ baris, barisPo: null, tarifPo: 11, pengaturan: PKP, tanggal: TGL }).ppn).toBe(0);
    expect(ppnMasukanGrn({ baris, barisPo, tarifPo: 11, pengaturan: { ...PKP, berlakuSejak: "2026-12-01" }, tanggal: TGL }).ppn).toBe(0);
  });

  it("hitungPpnMasukanGrn membaca PO + pengaturan lewat klien transaksi", async () => {
    const klien = {
      purchaseOrder: {
        findUnique: async () => ({ ppnRatePercent: 11, items: barisPo }),
      },
      systemSetting: { findUnique: async () => ({ value: JSON.stringify(PKP) }) },
    };
    const r = await hitungPpnMasukanGrn(klien as any, { poId: "po1", baris: [{ itemId: "kain", nilai: 100_000 }], tanggal: TGL });
    expect(r.ppn).toBe(11_000);
    expect((await hitungPpnMasukanGrn(klien as any, { poId: null, baris: [{ itemId: "kain", nilai: 100_000 }], tanggal: TGL })).ppn).toBe(0);
  });
});
