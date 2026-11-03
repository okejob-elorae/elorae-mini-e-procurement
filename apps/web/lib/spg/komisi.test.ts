import { describe, expect, it } from "vitest";
import { commissionPerSpg, putusReportKey, type SalesReport } from "@/lib/spg-commission/payout";
import type { HasilGaji, RincianGaji } from "./gaji-pokok";
import {
  bacaBulanBayar,
  BULAN_LALU,
  bulanSebelum,
  bulanSudahSelesai,
  DASAR_TARIF_KATEGORI,
  JEJAK_KOMISI_SPG,
  laporanPerluDicek,
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

const rincianGaji = (gajiPokok: number): RincianGaji => ({
  bulanKerja: "2026-09",
  gajiBulanan: gajiPokok,
  penuh: true,
  hariAwal: "2026-09-01",
  hariAkhir: "2026-09-30",
  sumberPembagi: "JADWAL",
  pembagi: 26,
  hariKerjaStandar: [1, 2, 3, 4, 5, 6],
  tarifHarian: Math.floor(gajiPokok / 26),
  hariTerjadwal: 26,
  hariIzin: 0,
  hariTidakMasuk: 0,
  tanggalTidakMasuk: [],
  hariMasukLibur: 0,
  tanggalMasukLibur: [],
  tanggalLuarRadius: [],
  hariDariCatatan: 0,
  gajiPokok,
});
const gajiOk = (n: number): HasilGaji => ({ ok: true, rincian: rincianGaji(n) });

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
    baseSalary: 0,
    salaryDetail: null,
    paidAt: null,
    ...ubah,
  });

  it("writes one row per seller on the first lock, with the category-rate basis", () => {
    const r = rencanaTetapkan(hasil, [], [], new Map());
    expect(r.ok && r.tulis.map((t) => [t.userId, t.isi.commission, t.isi.unitsSold, t.isi.basis, t.sebelum])).toEqual([
      ["u-ani", 3_000, 3, DASAR_TARIF_KATEGORI, null],
      ["u-budi", 1_000, 1, DASAR_TARIF_KATEGORI, null],
    ]);
    expect(r.ok && r.hapus).toEqual([]);
  });

  it("re-locks with the earlier values as 'before', and drops rows of people who no longer receive", () => {
    const r = rencanaTetapkan(hasil, [resmi("u-ani", { commission: 900 }), resmi("u-lama", { commission: 300 })], [], new Map());
    if (!r.ok) throw new Error(r.code);
    expect(r.tulis[0].sebelum).toEqual({ id: "r-u-ani", unitsSold: 0, commission: 900, basis: "BAGI_RATA", baseSalary: 0 });
    expect(r.tulis[1].sebelum).toBeNull();
    expect(r.hapus).toEqual([{ id: "r-u-lama", userId: "u-lama", sebelum: { unitsSold: 0, commission: 300, basis: "BAGI_RATA", baseSalary: 0 } }]);
  });

  it("refuses the whole store once any row is paid", () => {
    expect(rencanaTetapkan(hasil, [resmi("u-ani"), resmi("u-budi", { paidAt: new Date() })], [], new Map())).toEqual({ ok: false, code: "SUDAH_DIBAYAR" });
  });

  it("refuses a store with no seller and no salaried participant", () => {
    expect(rencanaTetapkan(susunKomisiToko([], [ani]), [], [], new Map())).toEqual({ ok: false, code: "TANPA_PESERTA" });
  });

  it("a salaried SPG who sold nothing still gets a row, with her base salary snapshot (B19)", () => {
    const r = rencanaTetapkan(susunKomisiToko([], [ani]), [], ["u-ani"], new Map([["u-ani", gajiOk(3_500_000)]]));
    if (!r.ok) throw new Error(r.code);
    expect(r.tulis).toHaveLength(1);
    expect(r.tulis[0].isi).toMatchObject({ commission: 0, unitsSold: 0, baseSalary: 3_500_000, salaryDetail: { jenis: "RINCIAN" } });
  });

  it("a held salary is written as 0 with its reason; salary held by another row is written as a pointer", () => {
    const tahan: HasilGaji = { ok: false, alasan: "JADWAL_MENUNGGU_PERSETUJUAN", hari: ["2026-09-03"] };
    const r = rencanaTetapkan(hasil, [], ["u-ani", "u-budi"], new Map([["u-ani", tahan]]), new Map([["u-budi", { refType: "ConsignmentCommission", refId: "cc-1" }]]));
    if (!r.ok) throw new Error(r.code);
    const per = new Map(r.tulis.map((t) => [t.userId, t.isi]));
    expect(per.get("u-ani")).toMatchObject({ baseSalary: 0, salaryDetail: { jenis: "TAHAN", alasan: "JADWAL_MENUNGGU_PERSETUJUAN" } });
    expect(per.get("u-budi")).toMatchObject({ baseSalary: 0, salaryDetail: { jenis: "DI_BARIS_LAIN", refId: "cc-1" } });
  });
});

describe("sudahBerbeda / statusResmi / dasar", () => {
  const hasil = susunKomisiToko(commissionPerSpg(laporan([{ salesmanId: "u-ani", itemId: "kaos-1", categoryId: "kaos", qty: 2 }]), rates), [ani]);
  const baris: BarisResmiAda = { id: "r", userId: "u-ani", unitsSold: 2, commission: 2_000, basis: DASAR_TARIF_KATEGORI, baseSalary: 0, salaryDetail: null, paidAt: null };

  it("is false before anything is locked and when the locked numbers still match", () => {
    expect(sudahBerbeda(hasil, [])).toBe(false);
    expect(sudahBerbeda(hasil, [baris])).toBe(false);
  });

  it("is true when the amount, pieces, participants or the base salary changed", () => {
    expect(sudahBerbeda(hasil, [{ ...baris, commission: 1_000 }])).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, unitsSold: 3 }])).toBe(true);
    expect(sudahBerbeda(hasil, [baris, { ...baris, id: "r2", userId: "u-lain" }])).toBe(true);
    expect(sudahBerbeda(hasil, [baris], ["u-ani"], new Map([["u-ani", gajiOk(3_000_000)]]))).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, baseSalary: 3_000_000 }], ["u-ani"], new Map([["u-ani", gajiOk(3_000_000)]]))).toBe(false);
  });

  it("names the three states", () => {
    expect(statusResmi(null)).toBe("BELUM");
    expect(statusResmi({ paidAt: null })).toBe("DITETAPKAN");
    expect(statusResmi({ paidAt: "2026-10-02T00:00:00Z" })).toBe("DIBAYAR");
  });

  it("a report needs checking when it has salaried participants, even with no confirmed piece", () => {
    expect(laporanPerluDicek(laporan([]), [])).toBe(false);
    expect(laporanPerluDicek(laporan([]), ["u-ani"])).toBe(true);
    expect(laporanPerluDicek(laporan([{ salesmanId: "u-ani", itemId: "kaos-1", categoryId: "kaos", qty: 1 }]), [])).toBe(true);
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
