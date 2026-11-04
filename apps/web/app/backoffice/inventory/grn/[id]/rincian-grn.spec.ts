import { describe, expect, it } from "vitest";
import { fotoGrn, keadaanPemilikGrn, susunBarisGrn } from "./rincian-grn";

/*
 * Halaman rincian GRN. Dulu baris GRN yang dibuka hanya menampilkan roll kain
 * dan tombol jurnal — barang, qty, dan harga yang diterima tidak terlihat di
 * mana pun. `GRN.items` disimpan sebagai JSON (teks) oleh `createGRN`.
 */
const barang = new Map([
  ["kain", { sku: "FAB-POL-001", nameId: "Kain polyester", uomCode: "MTR", variants: null }],
  ["kaos", {
    sku: "27000038P",
    nameId: "Kaos Eloraé",
    uomCode: "PCS",
    variants: [{ sku: "27000038P-BLK-S", Warna: "Hitam", Ukuran: "S" }],
  }],
]);

describe("susunBarisGrn", () => {
  it("membaca JSON teks: barang, varian, qty, harga, total, jumlah roll", () => {
    const items = JSON.stringify([
      { itemId: "kain", variantSku: null, qty: 150.5, unitCost: 25_000, totalCost: 3_762_500, rolls: [{ length: 100 }, { length: 50.5 }] },
      { itemId: "kaos", variantSku: "27000038P-BLK-S", qty: 12, unitCost: 45_000 },
    ]);
    expect(susunBarisGrn(items, barang)).toEqual([
      { itemId: "kain", sku: "FAB-POL-001", nama: "Kain polyester", varianSku: null, varianLabel: null, satuan: "MTR", qty: 150.5, hargaSatuan: 25_000, total: 3_762_500, jumlahRoll: 2 },
      { itemId: "kaos", sku: "27000038P", nama: "Kaos Eloraé", varianSku: "27000038P-BLK-S", varianLabel: expect.any(String), satuan: "PCS", qty: 12, hargaSatuan: 45_000, total: 540_000, jumlahRoll: 0 },
    ]);
  });

  it("barang yang sudah dihapus tetap tampil dengan id-nya", () => {
    const [b] = susunBarisGrn([{ itemId: "hilang", qty: 2, unitCost: 1000 }], barang);
    expect(b).toMatchObject({ sku: "hilang", nama: "", satuan: "", qty: 2, total: 2000 });
  });

  it("JSON rusak atau bukan larik → tanpa baris", () => {
    expect(susunBarisGrn("{rusak", barang)).toEqual([]);
    expect(susunBarisGrn(null, barang)).toEqual([]);
    expect(susunBarisGrn({ a: 1 }, barang)).toEqual([]);
  });
});

describe("fotoGrn", () => {
  it("JSON larik URL", () => {
    expect(fotoGrn('["/api/foto/a","/api/foto/b"]')).toEqual(["/api/foto/a", "/api/foto/b"]);
  });
  it("kosong / rusak → []", () => {
    expect(fotoGrn(null)).toEqual([]);
    expect(fotoGrn("bukan json")).toEqual([]);
    expect(fotoGrn('[1, "/api/foto/c", ""]')).toEqual(["/api/foto/c"]);
  });
});

describe("keadaanPemilikGrn", () => {
  it("menunggu / disetujui / ditolak / biasa", () => {
    expect(keadaanPemilikGrn({ requiresOwnerApproval: true, ownerApprovedAt: null, ownerDeclinedAt: null })).toBe("menunggu");
    expect(keadaanPemilikGrn({ requiresOwnerApproval: false, ownerApprovedAt: "2026-10-01", ownerDeclinedAt: null })).toBe("disetujui");
    expect(keadaanPemilikGrn({ requiresOwnerApproval: false, ownerApprovedAt: null, ownerDeclinedAt: "2026-10-01" })).toBe("ditolak");
    expect(keadaanPemilikGrn({ requiresOwnerApproval: false, ownerApprovedAt: null, ownerDeclinedAt: null })).toBeNull();
  });
});
