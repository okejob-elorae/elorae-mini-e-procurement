import { describe, expect, it } from "vitest";
import { bacaRencana, hitungKekuranganBahan, STATUS_WO_BUTUH_BAHAN, type WoUntukBahan } from "./kekurangan-bahan";

const wo = (woId: string, rencana: WoUntukBahan["rencana"], vendor = "V1"): WoUntukBahan => ({
  woId,
  docNumber: `WO-${woId}`,
  vendorId: vendor,
  vendorName: `Vendor ${vendor}`,
  vendorCode: null,
  rencana,
});

describe("hitungKekuranganBahan", () => {
  it("bahan yang SUDAH dikeluarkan tidak dihitung lagi sebagai kebutuhan", () => {
    // Rencana 100, sudah keluar 100, stok tinggal 0 — dulu terbaca kurang 100.
    const hasil = hitungKekuranganBahan([wo("a", [{ itemId: "kain", plannedQty: 100, issuedQty: 100 }])], new Map());
    expect(hasil).toEqual([]);
  });

  it("kebutuhan = rencana − sudah dikeluarkan, dijumlah antar perintah kerja", () => {
    const hasil = hitungKekuranganBahan(
      [
        wo("a", [{ itemId: "kain", plannedQty: 100, issuedQty: 40 }]), // sisa 60
        wo("b", [{ itemId: "kain", plannedQty: 50 }], "V2"), // draft, sisa 50
      ],
      new Map([["kain", 70]]),
    );
    expect(hasil).toHaveLength(1);
    expect(hasil[0]).toMatchObject({ itemId: "kain", totalNeeded: 110, available: 70, deficit: 40 });
    expect(hasil[0].vendors.map((v) => v.vendorId)).toEqual(["V1", "V2"]);
    expect(hasil[0].vendors[0].workOrders).toEqual([{ woId: "a", docNumber: "WO-a", neededQty: 60 }]);
  });

  it("stok cukup → tidak muncul", () => {
    const hasil = hitungKekuranganBahan([wo("a", [{ itemId: "kain", plannedQty: 30 }])], new Map([["kain", 30]]));
    expect(hasil).toEqual([]);
  });

  it("dikeluarkan melebihi rencana tidak menjadi kebutuhan negatif yang menutupi WO lain", () => {
    const hasil = hitungKekuranganBahan(
      [
        wo("a", [{ itemId: "kain", plannedQty: 10, issuedQty: 25 }]),
        wo("b", [{ itemId: "kain", plannedQty: 20 }]),
      ],
      new Map(),
    );
    expect(hasil[0]).toMatchObject({ totalNeeded: 20, deficit: 20 });
  });

  it("stok tersedia negatif (terjual melebihi stok) dihitung nol, bukan menambah kebutuhan", () => {
    const hasil = hitungKekuranganBahan([wo("a", [{ itemId: "kain", plannedQty: 5 }])], new Map([["kain", -3]]));
    expect(hasil[0]).toMatchObject({ totalNeeded: 5, available: -3, deficit: 5 });
  });

  it("angka dari JSON berupa string tetap terbaca; baris tanpa itemId diabaikan", () => {
    const hasil = hitungKekuranganBahan(
      [wo("a", [{ itemId: "kain", plannedQty: "12.5", issuedQty: "2.5" }, { plannedQty: 99 }])],
      new Map(),
    );
    expect(hasil).toEqual([
      expect.objectContaining({ itemId: "kain", totalNeeded: 10, deficit: 10 }),
    ]);
  });

  it("diurutkan dari kekurangan terbesar", () => {
    const hasil = hitungKekuranganBahan(
      [wo("a", [{ itemId: "x", plannedQty: 5 }, { itemId: "y", plannedQty: 50 }])],
      new Map(),
    );
    expect(hasil.map((h) => h.itemId)).toEqual(["y", "x"]);
  });
});

describe("STATUS_WO_BUTUH_BAHAN", () => {
  it("perintah kerja yang bahannya belum keluar ikut; yang selesai/batal tidak", () => {
    expect(STATUS_WO_BUTUH_BAHAN).toEqual(expect.arrayContaining(["DRAFT", "ISSUED", "IN_PRODUCTION"]));
    expect(STATUS_WO_BUTUH_BAHAN).not.toContain("COMPLETED");
    expect(STATUS_WO_BUTUH_BAHAN).not.toContain("CANCELLED");
  });
});

describe("bacaRencana", () => {
  it("menerima array, string JSON, dan menolak bentuk rusak", () => {
    expect(bacaRencana([{ itemId: "a" }])).toEqual([{ itemId: "a" }]);
    expect(bacaRencana('[{"itemId":"a"}]')).toEqual([{ itemId: "a" }]);
    expect(bacaRencana("bukan json")).toEqual([]);
    expect(bacaRencana({ itemId: "a" })).toEqual([]);
  });
});
