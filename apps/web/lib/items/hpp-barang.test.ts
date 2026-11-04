import { describe, expect, it } from "vitest";
import { hitungHppBarang, type PenerimaanHpp } from "./hpp-barang";

/*
 * HPP per pcs barang jadi untuk formulir barang — hanya dibaca. Pemilik
 * menetapkan harga jual sendiri dari angka ini (keputusan pemilik 2026-10-08),
 * jadi tidak ada saran harga dan tidak ada margin di sini.
 */

const terima = (isi: Partial<PenerimaanHpp> = {}): PenerimaanHpp => ({
  docNumber: "RCPT/2004/0001",
  woDocNumber: "WO/2004/0007",
  receivedAt: new Date("2004-02-01T03:00:00.000Z"),
  qtyAccepted: 40,
  materialCost: 400_000,
  serviceCost: 866_000,
  additionalCost: 80_000,
  totalCostValue: 1_260_180,
  ...isi,
});

describe("hitungHppBarang", () => {
  it("tanpa stok dan tanpa penerimaan → belum ada HPP", () => {
    expect(hitungHppBarang([], null)).toEqual({ perPcs: null, sumber: null, rincian: null });
  });

  it("stok ada → Σ nilai ÷ Σ qty atas baris ber-qty > 0 (semua varian); baris 0 dan minus diabaikan", () => {
    const hasil = hitungHppBarang(
      [
        { qtyOnHand: 10, totalValue: 300_000 },
        { qtyOnHand: 30, totalValue: 960_000 },
        { qtyOnHand: 0, totalValue: 5 },
        { qtyOnHand: -2, totalValue: -60_000 },
      ],
      null,
    );
    expect(hasil).toEqual({ perPcs: 31_500, sumber: "STOK", rincian: null });
  });

  it("stok 0 → HPP dari penerimaan terakhir (nilai persediaan ÷ pcs lolos), dua desimal", () => {
    const hasil = hitungHppBarang([{ qtyOnHand: 0, totalValue: 0 }], terima({ totalCostValue: 100_000, qtyAccepted: 3, materialCost: 100_000, serviceCost: 0, additionalCost: 0 }));
    expect(hasil.perPcs).toBe(33_333.33);
    expect(hasil.sumber).toBe("PENERIMAAN");
  });

  it("rincian: jahit = (nilai − bahan − tambahan) ÷ pcs — tanpa PPN Masukan, bukan tagihan jasa mentah", () => {
    // PKP: tagihan jasa 866.000 memuat PPN 85.820; persediaan hanya memikul DPP-nya.
    const hasil = hitungHppBarang([], terima());
    expect(hasil).toEqual({
      perPcs: 31_504.5,
      sumber: "PENERIMAAN",
      rincian: {
        penerimaan: "RCPT/2004/0001",
        wo: "WO/2004/0007",
        tanggal: "2004-02-01T03:00:00.000Z",
        bahanPerPcs: 10_000,
        jahitPerPcs: 19_504.5,
        tambahanPerPcs: 2_000,
      },
    });
    // Bukan serviceCost ÷ pcs (21.650, termasuk PPN).
    expect(hasil.rincian?.jahitPerPcs).not.toBe(21_650);
  });

  it("stok ada → angka utama dari stok, rinciannya tetap dari penerimaan terakhir", () => {
    const hasil = hitungHppBarang([{ qtyOnHand: 40, totalValue: 1_260_000 }], terima());
    expect(hasil.perPcs).toBe(31_500);
    expect(hasil.sumber).toBe("STOK");
    expect(hasil.rincian?.bahanPerPcs).toBe(10_000);
  });

  it("penerimaan lama (tanpa jasa dan tanpa biaya tambahan) → bahan saja; bahan dari nilai bila kolom bahan kosong", () => {
    const hasil = hitungHppBarang(
      [],
      terima({ qtyAccepted: 8, materialCost: null, serviceCost: null, additionalCost: null, totalCostValue: 100_000 }),
    );
    expect(hasil.perPcs).toBe(12_500);
    expect(hasil.rincian).toMatchObject({ bahanPerPcs: 12_500, jahitPerPcs: null, tambahanPerPcs: null });
  });

  it("angka dari Prisma (Decimal / teks) dibaca lewat toString, jahit tidak pernah minus", () => {
    const desimal = (n: number) => ({ toString: () => String(n) });
    const hasil = hitungHppBarang(
      [{ qtyOnHand: desimal(4), totalValue: desimal(100_001) }],
      terima({ qtyAccepted: desimal(4), materialCost: desimal(100_000), serviceCost: desimal(0), additionalCost: desimal(2_000), totalCostValue: desimal(101_000) }),
    );
    expect(hasil.perPcs).toBe(25_000.25);
    expect(hasil.rincian).toMatchObject({ bahanPerPcs: 25_000, jahitPerPcs: 0, tambahanPerPcs: 500 });
  });
});
