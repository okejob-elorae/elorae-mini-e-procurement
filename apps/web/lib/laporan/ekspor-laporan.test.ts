import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  barisEksporKinerjaPemasok,
  barisEksporPengadaan,
  barisEksporPersediaan,
  keCsv,
  KOLOM_KINERJA_PEMASOK,
  KOLOM_NILAI_PERSEDIAAN,
  KOLOM_PENGADAAN,
  labelStatusEkspor,
} from "./ekspor-laporan";

describe("labelStatusEkspor — kata yang sama dengan layar", () => {
  it("status PO dan perintah kerja", () => {
    expect(labelStatusEkspor("purchaseOrder", "SUBMITTED")).toBe("Dikirim ke pemasok");
    expect(labelStatusEkspor("purchaseOrder", "PARTIAL")).toBe("Diterima sebagian");
    expect(labelStatusEkspor("workOrder", "IN_PRODUCTION")).toBe("Sedang diproduksi");
  });
  it("status asing tidak jatuh ke kode Inggris mentah tanpa tanda", () => {
    expect(labelStatusEkspor("purchaseOrder", "ANEH")).toBe("Tidak diketahui");
  });
});

describe("barisEksporPengadaan", () => {
  const sumber = {
    docNumber: "PO/2026/0001",
    supplier: { name: "PT Kain Indah", code: "SUP0001" },
    status: "SUBMITTED",
    // 30 Sep 2026 17.30 UTC = 1 Okt 2026 WIB: tanggalnya harus WIB, bukan zona server.
    etaDate: new Date("2026-09-30T17:30:00Z"),
    etaMessage: "Terlambat 7 hari",
    grandTotal: 5_000_000,
    outstandingQty: 150,
    outstandingValue: 3_400_000,
    grnCount: 1,
  };

  it("kepala kolom Indonesia, status berlabel, tanggal WIB", () => {
    const [b] = barisEksporPengadaan([sumber]);
    expect(Object.keys(b)).toEqual([...KOLOM_PENGADAAN]);
    expect(b.Status).toBe("Dikirim ke pemasok");
    expect(b["Tanggal tiba"]).toBe("1 Okt 2026");
    expect(b["Nilai PO"]).toBe(5_000_000);
    expect(b["Nilai belum diterima"]).toBe(3_400_000);
  });

  it("tanpa tanggal tiba → sel kosong", () => {
    expect(barisEksporPengadaan([{ ...sumber, etaDate: null }])[0]["Tanggal tiba"]).toBe("");
  });

  it("tidak ada sisa kepala Inggris", () => {
    for (const k of [...KOLOM_PENGADAAN, ...KOLOM_KINERJA_PEMASOK, ...KOLOM_NILAI_PERSEDIAAN]) {
      expect(k).not.toMatch(/Doc Number|Outstanding|Supplier|Grand Total|Planned|Finished|Qty On Hand|Avg Cost|Total Value/);
    }
  });
});

describe("barisEksporKinerjaPemasok dan barisEksporPersediaan", () => {
  it("status perintah kerja berlabel, lama kosong bila belum selesai", () => {
    const [b] = barisEksporKinerjaPemasok([
      {
        docNumber: "WO/2026/0007",
        finishedGood: "Kaos Polo",
        plannedQty: 194,
        actualQty: 0,
        efficiency: 0,
        materialCost: 1_000,
        returnValue: 0,
        status: "IN_PRODUCTION",
        completionTimeDays: null,
      },
    ]);
    expect(Object.keys(b)).toEqual([...KOLOM_KINERJA_PEMASOK]);
    expect(b.Status).toBe("Sedang diproduksi");
    expect(b["Lama pengerjaan (hari)"]).toBe("");
  });

  it("jenis barang berlabel dan persen dibulatkan dua angka", () => {
    const [b] = barisEksporPersediaan([
      { sku: "FB-001", name: "Kain Utama", type: "FABRIC", uomCode: "YD", qtyOnHand: 2000, avgCost: 1, totalValue: 2000, percentageOfTotal: 12.3456 },
    ]);
    expect(Object.keys(b)).toEqual([...KOLOM_NILAI_PERSEDIAAN]);
    expect(b.Jenis).toBe("Kain");
    expect(b["% dari total"]).toBe(12.35);
  });
});

describe("keCsv", () => {
  it("kepala tetap walau kosong, sel dikutip dan tanda kutip digandakan", () => {
    expect(keCsv(["A", "B"], [])).toBe("A,B");
    expect(keCsv(["A", "B"], [{ A: 'Toko "Jaya"', B: 3 }])).toBe('A,B\n"Toko ""Jaya""","3"');
  });
});

describe("aksi ekspor memakai pembangun di atas", () => {
  const akar = join(__dirname, "..", "..");
  it("tidak ada lagi kepala kolom Inggris atau toLocaleDateString() di aksi laporan", () => {
    for (const f of ["app/actions/reports/procurement.ts", "app/actions/reports/production.ts", "app/actions/reports/inventory.ts"]) {
      const src = readFileSync(join(akar, f), "utf8");
      expect(src, f).not.toMatch(/'Doc Number'|'Outstanding Value'|'Qty On Hand'|toLocaleDateString\(\)/);
    }
  });
});
