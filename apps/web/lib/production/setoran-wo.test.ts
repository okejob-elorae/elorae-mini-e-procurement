import { describe, expect, it } from "vitest";
import { angkaSetoranWo, lebihDariTarget } from "./setoran-wo";

describe("angkaSetoranWo", () => {
  it("tanpa penerimaan: semua nol, kurang = target", () => {
    const a = angkaSetoranWo({ plannedQty: 80, actualQty: null, receipts: [] });
    expect(a).toMatchObject({ target: 80, disetor: 0, cacat: 0, masukStok: 0, kurang: 80, lebih: 0, persen: 0, jumlahPenerimaan: 0, tanpaDokumen: 0 });
  });

  it("cacat termasuk disetor tetapi tidak masuk stok, dan tetap dihitung kurang", () => {
    // WO/2026/0013 di data lokal: 120 disetor, 2 cacat, 118 lolos.
    const a = angkaSetoranWo({
      plannedQty: "120.00",
      actualQty: "118.00",
      receipts: [{ qtyReceived: "120.00", qtyRejected: "2.00", qtyAccepted: "118.00" }],
    });
    expect(a.disetor).toBe(120);
    expect(a.cacat).toBe(2);
    expect(a.masukStok).toBe(118);
    expect(a.kurang).toBe(2);
    expect(a.persen).toBe(98);
    expect(a.tanpaDokumen).toBe(0);
  });

  it("menjumlahkan beberapa penerimaan dan mengabaikan ekor desimal", () => {
    const a = angkaSetoranWo({
      plannedQty: 1,
      receipts: [
        { qtyReceived: 0.1, qtyRejected: 0, qtyAccepted: 0.1 },
        { qtyReceived: 0.2, qtyAccepted: 0.2 },
      ],
    });
    expect(a.disetor).toBe(0.3);
    expect(a.masukStok).toBe(0.3);
    expect(a.kurang).toBe(0.7);
    expect(a.jumlahPenerimaan).toBe(2);
  });

  it("setoran tercatat tanpa dokumen tidak dihitung, tetapi dilaporkan", () => {
    // WO/2026/0003: actualQty 30, tidak ada satu pun penerimaan.
    const a = angkaSetoranWo({ plannedQty: 80, actualQty: 30, receipts: [] });
    expect(a.masukStok).toBe(0);
    expect(a.kurang).toBe(80);
    expect(a.tanpaDokumen).toBe(30);
  });

  it("lebih dari target: kurang 0, lebih terisi, persen dibatasi 100", () => {
    const a = angkaSetoranWo({ plannedQty: 50, receipts: [{ qtyReceived: 60, qtyRejected: 0, qtyAccepted: 60 }] });
    expect(a.kurang).toBe(0);
    expect(a.lebih).toBe(10);
    expect(a.persen).toBe(100);
  });

  it("target 0 tidak membagi dengan nol", () => {
    expect(angkaSetoranWo({ plannedQty: 0, receipts: [{ qtyReceived: 5, qtyAccepted: 5 }] }).persen).toBe(0);
  });

  it("nilai tak terbaca dihitung 0", () => {
    const a = angkaSetoranWo({ plannedQty: "x", receipts: [{ qtyReceived: null, qtyAccepted: undefined }] });
    expect(a.target).toBe(0);
    expect(a.masukStok).toBe(0);
  });
});

describe("lebihDariTarget", () => {
  const wo = angkaSetoranWo({ plannedQty: 120, receipts: [{ qtyReceived: 120, qtyRejected: 2, qtyAccepted: 118 }] });

  it("masuk stok sampai menutup kekurangan tidak dianggap lebih", () => {
    expect(lebihDariTarget(wo, 2)).toBe(0);
  });

  it("masuk stok melewati kekurangan dihitung selisihnya", () => {
    expect(lebihDariTarget(wo, 5)).toBe(3);
  });

  it("isian negatif dianggap 0", () => {
    expect(lebihDariTarget(wo, -4)).toBe(0);
  });
});
