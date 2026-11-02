import { describe, expect, it } from "vitest";
import { commissionPerSpg, putusReportKey, type SalesReport } from "@/lib/spg-commission/payout";
import {
  aturanLama,
  bacaBulanBayar,
  bacaDasarResmi,
  BULAN_LALU,
  bulanSebelum,
  bulanSudahSelesai,
  DASAR_TARIF_KATEGORI,
  JEJAK_KOMISI_SPG,
  periodeSah,
  rencanaTetapkan,
  rentangBulanWib,
  statusResmi,
  sudahBerbeda,
  susunKomisiToko,
  type BarisResmiAda,
  type OrangKomisi,
} from "./komisi";

/**
 * Bagian murni komisi SPG Max yang tersisa: menyusun hasil satu hitungan (tarif per kategori ×
 * potong masing-masing SPG, `lib/spg-commission/payout.ts`) untuk kantor, aturan penetapan resmi
 * toko putus, dan bulan. Angkanya sendiri diuji di `lib/spg-commission/payout.test.ts`.
 */

const ani: OrangKomisi = { userId: "u-ani", nama: "Ani", ditugaskan: true };
const budi: OrangKomisi = { userId: "u-budi", nama: "Budi", ditugaskan: true };

const rates = [{ itemCategoryId: "kaos", effectiveFrom: "2026-01", amountPerPiece: 1_000 }];

function laporan(jual: SalesReport["movements"]): SalesReport {
  return {
    key: putusReportKey("toko", "2026-09"),
    kind: "PUTUS",
    storeId: "toko",
    salesMonth: "2026-09",
    checkedAt: new Date("2026-10-03T03:00:00.000Z"),
    official: null,
    movements: jual,
  };
}

describe("susunKomisiToko", () => {
  it("penerima = yang menjual, masing-masing dari potongnya sendiri; SPG bertugas yang tidak menjual tampil dengan nol", () => {
    const hitung = commissionPerSpg(laporan([{ salesmanId: "u-ani", itemId: "kaos-1", categoryId: "kaos", qty: 3 }]), rates);
    const hasil = susunKomisiToko(hitung, [ani, budi]);
    expect(hasil.perSpg.map((p) => [p.userId, p.potong, p.komisi, p.penerima])).toEqual([
      ["u-ani", 3, 3_000, true],
      ["u-budi", 0, 0, false],
    ]);
    expect([hasil.potongToko, hasil.totalToko, hasil.potongTanpaTarif]).toEqual([3, 3_000, 0]);
  });

  it("penjual yang tidak ada di daftar orang tetap dihitung, namanya id-nya", () => {
    const hitung = commissionPerSpg(laporan([{ salesmanId: "u-pindah", itemId: "kaos-1", categoryId: "kaos", qty: 2 }]), rates);
    expect(susunKomisiToko(hitung, [ani]).perSpg[0]).toMatchObject({ userId: "u-pindah", nama: "u-pindah", ditugaskan: false, penerima: true, komisi: 2_000 });
  });

  it("potong tanpa tarif tetap penerima, komisinya nol dan dilaporkan", () => {
    const hitung = commissionPerSpg(laporan([{ salesmanId: "u-ani", itemId: "topi-1", categoryId: null, qty: 4 }]), rates);
    const hasil = susunKomisiToko(hitung, [ani]);
    expect(hasil.perSpg[0]).toMatchObject({ penerima: true, potong: 4, komisi: 0, potongTanpaTarif: 4 });
    expect(hasil.potongTanpaTarif).toBe(4);
  });
});

describe("bulan", () => {
  it("validates YYYY-MM", () => {
    expect(periodeSah("2026-09")).toBe(true);
    expect(periodeSah("2026-13")).toBe(false);
    expect(periodeSah("2026-9")).toBe(false);
    expect(periodeSah(202609)).toBe(false);
  });

  it("gives the WIB month as an instant range, across a year end", () => {
    const r = rentangBulanWib("2026-12");
    expect(r.awal.toISOString()).toBe("2026-11-30T17:00:00.000Z");
    expect(r.akhir.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });

  it("only a month before the current WIB month is finished", () => {
    expect(bulanSudahSelesai("2026-09", "2026-10")).toBe(true);
    expect(bulanSudahSelesai("2026-10", "2026-10")).toBe(false);
    expect(bulanSudahSelesai("2026-11", "2026-10")).toBe(false);
  });

  it("halaman dibuka di bulan PEMBAYARAN berjalan, tempat laporan bulan lalu dicek", () => {
    const pilihan = ["2026-11", "2026-10", "2026-09"];
    expect(bacaBulanBayar(undefined, pilihan)).toBe("2026-11");
    expect(bacaBulanBayar("2026-09", pilihan)).toBe("2026-09");
    expect(bacaBulanBayar(["2026-10"], pilihan)).toBe("2026-10");
    expect(bacaBulanBayar("2025-01", pilihan)).toBe("2026-11");
  });

  it("`?bulan=lalu` (tautan Beranda): penjualan bulan lalu dibayar bulan ini, jadi yang dibuka bulan berjalan", () => {
    expect(bacaBulanBayar(BULAN_LALU, ["2026-11", "2026-10"])).toBe("2026-11");
    expect(bulanSebelum("2026-10")).toBe("2026-09");
    expect(bulanSebelum("2026-01")).toBe("2025-12");
  });
});

describe("rencanaTetapkan", () => {
  const hasil = susunKomisiToko(
    commissionPerSpg(
      laporan([
        { salesmanId: "u-ani", itemId: "kaos-1", categoryId: "kaos", qty: 3 },
        { salesmanId: "u-budi", itemId: "kaos-1", categoryId: "kaos", qty: 1 },
      ]),
      rates,
    ),
    [ani, budi],
  );
  const resmi = (u: string, ubah: Partial<BarisResmiAda> = {}): BarisResmiAda => ({
    id: `r-${u}`,
    userId: u,
    unitsSold: 0,
    commission: 1_500,
    basis: "BAGI_RATA",
    paidAt: null,
    ...ubah,
  });

  it("writes one row per seller on the first lock, with the category-rate basis", () => {
    const r = rencanaTetapkan(hasil, []);
    expect(r.ok && r.tulis.map((t) => [t.userId, t.isi.commission, t.isi.unitsSold, t.isi.basis, t.sebelum])).toEqual([
      ["u-ani", 3_000, 3, DASAR_TARIF_KATEGORI, null],
      ["u-budi", 1_000, 1, DASAR_TARIF_KATEGORI, null],
    ]);
    expect(r.ok && r.hapus).toEqual([]);
  });

  it("re-locks with the earlier values as 'before', and drops rows of people who no longer receive", () => {
    const r = rencanaTetapkan(hasil, [resmi("u-ani", { commission: 900 }), resmi("u-lama", { commission: 300 })]);
    if (!r.ok) throw new Error(r.code);
    expect(r.tulis[0].sebelum).toEqual({ id: "r-u-ani", unitsSold: 0, commission: 900, basis: "BAGI_RATA" });
    expect(r.tulis[1].sebelum).toBeNull();
    expect(r.hapus).toEqual([{ id: "r-u-lama", userId: "u-lama", sebelum: { unitsSold: 0, commission: 300, basis: "BAGI_RATA" } }]);
  });

  it("refuses the whole store once any row is paid", () => {
    expect(rencanaTetapkan(hasil, [resmi("u-ani"), resmi("u-budi", { paidAt: new Date() })])).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
  });

  it("refuses a store with no seller", () => {
    expect(rencanaTetapkan(susunKomisiToko([], [ani]), [])).toEqual({ ok: false, code: "TANPA_SPG" });
  });
});

describe("sudahBerbeda / statusResmi / dasar", () => {
  const hasil = susunKomisiToko(commissionPerSpg(laporan([{ salesmanId: "u-ani", itemId: "kaos-1", categoryId: "kaos", qty: 2 }]), rates), [ani]);
  const baris: BarisResmiAda = { id: "r", userId: "u-ani", unitsSold: 2, commission: 2_000, basis: DASAR_TARIF_KATEGORI, paidAt: null };

  it("is false before anything is locked and when the locked numbers still match", () => {
    expect(sudahBerbeda(hasil, [])).toBe(false);
    expect(sudahBerbeda(hasil, [baris])).toBe(false);
  });

  it("is true when the amount, pieces or recipients changed, or the row was set with the old rule", () => {
    expect(sudahBerbeda(hasil, [{ ...baris, commission: 1_000 }])).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, unitsSold: 3 }])).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, basis: "PER_SPG" }])).toBe(true);
    expect(sudahBerbeda(hasil, [baris, { ...baris, id: "r2", userId: "u-lain" }])).toBe(true);
  });

  it("names the three states", () => {
    expect(statusResmi(null)).toBe("BELUM");
    expect(statusResmi({ paidAt: null })).toBe("DITETAPKAN");
    expect(statusResmi({ paidAt: "2026-10-02T00:00:00Z" })).toBe("DIBAYAR");
  });

  it("reads the stored basis; only TARIF_KATEGORI is the current rule", () => {
    expect(bacaDasarResmi(DASAR_TARIF_KATEGORI)).toBe(DASAR_TARIF_KATEGORI);
    expect(bacaDasarResmi("PER_SPG")).toBe("PER_SPG");
    expect(bacaDasarResmi("apa saja")).toBe("BAGI_RATA");
    expect(aturanLama(DASAR_TARIF_KATEGORI)).toBe(false);
    expect(aturanLama("PER_SPG")).toBe(true);
  });
});

describe("JEJAK_KOMISI_SPG", () => {
  it("names every audit action once, and no longer carries the dead putus setting", () => {
    const nilai = Object.values(JEJAK_KOMISI_SPG);
    expect(new Set(nilai).size).toBe(nilai.length);
    expect(Object.keys(JEJAK_KOMISI_SPG)).not.toContain("PENGATURAN_DIUBAH");
    expect(nilai).toContain("SPG_COMMISSION_RECOMPUTED_AT_PAYMENT");
    expect(nilai).toContain("SPG_COMMISSION_CORRECTION_APPLIED");
  });
});
