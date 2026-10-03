import { describe, expect, it } from "vitest";
import {
  bacaPeriodeKomisi,
  bulanSudahSelesai,
  hitungKomisiToko,
  periodeSah,
  rencanaTetapkan,
  rentangBulanWib,
  statusResmi,
  sudahBerbeda,
  validasiAturanKomisiPutus,
  type BarisResmiAda,
  type OrangKomisi,
} from "./komisi";
import { bacaKomisiPutus } from "./pengaturan";

const ani: OrangKomisi = { userId: "u-ani", nama: "Ani", ditugaskan: true };
const budi: OrangKomisi = { userId: "u-budi", nama: "Budi", ditugaskan: true };
const citra: OrangKomisi = { userId: "u-citra", nama: "Citra", ditugaskan: false };

describe("hitungKomisiToko — BAGI_RATA", () => {
  it("splits the store's net commission evenly between assigned SPGs, remainder to the first by name", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [budi, ani],
      jual: [
        { salesmanId: "u-budi", itemId: "kaos", qty: 3, commissionPerPcs: 1_000 },
        { salesmanId: "u-ani", itemId: "kaos", qty: 2, commissionPerPcs: 1_000 },
        { salesmanId: "u-ani", itemId: "topi", qty: 1, commissionPerPcs: 1 },
      ],
      kembali: [],
    });
    expect(h.totalToko).toBe(5_001);
    expect(h.potongToko).toBe(6);
    expect(h.perSpg.map((p) => [p.nama, p.potong, p.komisi, p.penerima])).toEqual([
      ["Ani", 3, 2_501, true],
      ["Budi", 3, 2_500, true],
    ]);
    expect(h.perSpg.reduce((n, p) => n + p.komisi, 0)).toBe(h.totalToko);
  });

  it("nets shopper returns of the same month per item and never goes below zero", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [ani],
      jual: [
        { salesmanId: "u-ani", itemId: "kaos", qty: 4, commissionPerPcs: 1_000 },
        { salesmanId: "u-ani", itemId: "celana", qty: 1, commissionPerPcs: 2_000 },
      ],
      kembali: [
        { salesmanId: "u-ani", itemId: "kaos", qty: 1 },
        { salesmanId: "u-ani", itemId: "celana", qty: 3 },
        // Barang yang tidak laku bulan ini: pengembaliannya tidak mengurangi apa pun.
        { salesmanId: "u-ani", itemId: "jaket", qty: 2 },
      ],
    });
    expect(h.potongToko).toBe(3);
    expect(h.totalToko).toBe(3_000);
    expect(h.perSpg[0]).toMatchObject({ potong: 3, komisi: 3_000 });
  });

  it("gives a seller who no longer works at the store no share, but keeps her pieces in the store total", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [ani, citra],
      jual: [
        { salesmanId: "u-citra", itemId: "kaos", qty: 4, commissionPerPcs: 500 },
        { salesmanId: "u-ani", itemId: "kaos", qty: 2, commissionPerPcs: 500 },
      ],
      kembali: [],
    });
    expect(h.totalToko).toBe(3_000);
    expect(h.perSpg.map((p) => [p.nama, p.potong, p.komisi, p.penerima])).toEqual([
      ["Ani", 2, 3_000, true],
      ["Citra", 4, 0, false],
    ]);
  });

  it("has no recipients when the store has no assigned SPG", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [citra],
      jual: [{ salesmanId: "u-citra", itemId: "kaos", qty: 1, commissionPerPcs: 500 }],
      kembali: [],
    });
    expect(h.totalToko).toBe(500);
    expect(h.perSpg.filter((p) => p.penerima)).toEqual([]);
  });

  it("does not leave floating-point dust on cent rates", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [ani],
      jual: [{ salesmanId: "u-ani", itemId: "kaos", qty: 3, commissionPerPcs: 0.1 }],
      kembali: [],
    });
    expect(h.totalToko).toBe(0.3);
    expect(h.perSpg[0].komisi).toBe(0.3);
  });
});

describe("hitungKomisiToko — bawaan pemilik", () => {
  it("defaults to PER_SPG: pieces each SPG sold herself × the item rate", () => {
    const { dasar } = bacaKomisiPutus(null);
    expect(dasar).toBe("PER_SPG");
    const h = hitungKomisiToko({
      dasar,
      orang: [ani, budi],
      jual: [
        { salesmanId: "u-ani", itemId: "kaos", qty: 1, commissionPerPcs: 3_000 },
        { salesmanId: "u-budi", itemId: "kaos", qty: 4, commissionPerPcs: 3_000 },
      ],
      kembali: [],
    });
    expect(h.perSpg.map((p) => [p.nama, p.potong, p.komisi])).toEqual([
      ["Ani", 1, 3_000],
      ["Budi", 4, 12_000],
    ]);
  });
});

describe("hitungKomisiToko — potongan", () => {
  it("subtracts a deduction from that SPG only, after the basis, never below zero", () => {
    const h = hitungKomisiToko({
      dasar: "PER_SPG",
      orang: [ani, budi],
      jual: [
        { salesmanId: "u-ani", itemId: "kaos", qty: 2, commissionPerPcs: 1_000 },
        { salesmanId: "u-budi", itemId: "kaos", qty: 3, commissionPerPcs: 1_000 },
      ],
      kembali: [],
      potongan: [
        { userId: "u-ani", jumlah: 500, keterangan: "barang hilang" },
        { userId: "u-ani", jumlah: 250, keterangan: "barang hilang" },
        { userId: "u-budi", jumlah: 5_000, keterangan: "barang hilang" },
      ],
    });
    expect(h.perSpg.map((p) => [p.nama, p.komisiKotor, p.potongan, p.potonganSisa, p.komisi])).toEqual([
      ["Ani", 2_000, 750, 0, 1_250],
      ["Budi", 3_000, 3_000, 2_000, 0],
    ]);
    expect(h.totalToko).toBe(5_000);
    expect(h.totalPotongan).toBe(3_750);
  });

  it("applies deductions to each share under BAGI_RATA, and ignores zero or negative entries", () => {
    const h = hitungKomisiToko({
      dasar: "BAGI_RATA",
      orang: [ani, budi],
      jual: [{ salesmanId: "u-ani", itemId: "kaos", qty: 4, commissionPerPcs: 1_000 }],
      kembali: [],
      potongan: [
        { userId: "u-budi", jumlah: 300, keterangan: "barang hilang" },
        { userId: "u-ani", jumlah: -100, keterangan: "salah" },
        { userId: "u-ani", jumlah: 0, keterangan: "kosong" },
      ],
    });
    expect(h.perSpg.map((p) => [p.nama, p.komisiKotor, p.komisi])).toEqual([
      ["Ani", 2_000, 2_000],
      ["Budi", 2_000, 1_700],
    ]);
  });

  it("an empty list changes nothing", () => {
    const tanpa = hitungKomisiToko({ dasar: "PER_SPG", orang: [ani], jual: [{ salesmanId: "u-ani", itemId: "k", qty: 1, commissionPerPcs: 10 }], kembali: [] });
    const kosong = hitungKomisiToko({ dasar: "PER_SPG", orang: [ani], jual: [{ salesmanId: "u-ani", itemId: "k", qty: 1, commissionPerPcs: 10 }], kembali: [], potongan: [] });
    expect(kosong).toEqual(tanpa);
  });
});

describe("hitungKomisiToko — PER_SPG", () => {
  it("pays each SPG from her own notes, returns reduce the original seller", () => {
    const h = hitungKomisiToko({
      dasar: "PER_SPG",
      orang: [ani, budi],
      jual: [
        { salesmanId: "u-ani", itemId: "kaos", qty: 3, commissionPerPcs: 2_000 },
        { salesmanId: "u-budi", itemId: "kaos", qty: 5, commissionPerPcs: 2_000 },
      ],
      kembali: [{ salesmanId: "u-budi", itemId: "kaos", qty: 2 }],
    });
    expect(h.perSpg.map((p) => [p.nama, p.potong, p.komisi, p.penerima])).toEqual([
      ["Ani", 3, 6_000, true],
      ["Budi", 3, 6_000, true],
    ]);
    expect(h.totalToko).toBe(12_000);
    expect(h.potongToko).toBe(6);
  });

  it("still pays a seller who has moved to another store, and an assigned SPG without sales gets zero", () => {
    const h = hitungKomisiToko({
      dasar: "PER_SPG",
      orang: [ani, citra],
      jual: [{ salesmanId: "u-citra", itemId: "kaos", qty: 2, commissionPerPcs: 1_500 }],
      kembali: [],
    });
    expect(h.perSpg.map((p) => [p.nama, p.komisi, p.penerima])).toEqual([
      ["Ani", 0, true],
      ["Citra", 3_000, true],
    ]);
  });

  it("counts a seller missing from the people list under her id rather than dropping her pieces", () => {
    const h = hitungKomisiToko({
      dasar: "PER_SPG",
      orang: [],
      jual: [{ salesmanId: "u-x", itemId: "kaos", qty: 1, commissionPerPcs: 100 }],
      kembali: [],
    });
    expect(h.perSpg).toEqual([
      { userId: "u-x", nama: "u-x", ditugaskan: false, potong: 1, komisiKotor: 100, potongan: 0, potonganSisa: 0, komisi: 100, penerima: true },
    ]);
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

  it("defaults the page to the last finished month", () => {
    const pilihan = ["2026-10", "2026-09", "2026-08"];
    expect(bacaPeriodeKomisi(undefined, pilihan)).toBe("2026-09");
    expect(bacaPeriodeKomisi("2026-08", pilihan)).toBe("2026-08");
    expect(bacaPeriodeKomisi(["2026-10"], pilihan)).toBe("2026-10");
    expect(bacaPeriodeKomisi("2025-01", pilihan)).toBe("2026-09");
  });
});

describe("rencanaTetapkan", () => {
  const hasil = hitungKomisiToko({
    dasar: "BAGI_RATA",
    orang: [ani, budi],
    jual: [{ salesmanId: "u-ani", itemId: "kaos", qty: 3, commissionPerPcs: 1_000 }],
    kembali: [],
  });
  const resmi = (u: string, ubah: Partial<BarisResmiAda> = {}): BarisResmiAda => ({
    id: `r-${u}`,
    userId: u,
    unitsSold: 0,
    commission: 1_500,
    basis: "BAGI_RATA",
    paidAt: null,
    ...ubah,
  });

  it("writes one row per recipient on the first lock", () => {
    const r = rencanaTetapkan(hasil, []);
    expect(r.ok && r.tulis.map((t) => [t.userId, t.isi.commission, t.isi.unitsSold, t.sebelum])).toEqual([
      ["u-ani", 1_500, 3, null],
      ["u-budi", 1_500, 0, null],
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

  it("refuses a store without recipients", () => {
    const kosong = hitungKomisiToko({ dasar: "BAGI_RATA", orang: [], jual: [], kembali: [] });
    expect(rencanaTetapkan(kosong, [])).toEqual({ ok: false, code: "TANPA_SPG" });
  });
});

describe("sudahBerbeda / statusResmi", () => {
  const hasil = hitungKomisiToko({
    dasar: "PER_SPG",
    orang: [ani],
    jual: [{ salesmanId: "u-ani", itemId: "kaos", qty: 2, commissionPerPcs: 1_000 }],
    kembali: [],
  });
  const baris: BarisResmiAda = { id: "r", userId: "u-ani", unitsSold: 2, commission: 2_000, basis: "PER_SPG", paidAt: null };

  it("is false before anything is locked and when the locked numbers still match", () => {
    expect(sudahBerbeda(hasil, [])).toBe(false);
    expect(sudahBerbeda(hasil, [baris])).toBe(false);
  });

  it("is true when the amount, pieces, basis or recipients changed", () => {
    expect(sudahBerbeda(hasil, [{ ...baris, commission: 1_000 }])).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, unitsSold: 3 }])).toBe(true);
    expect(sudahBerbeda(hasil, [{ ...baris, basis: "BAGI_RATA" }])).toBe(true);
    expect(sudahBerbeda(hasil, [baris, { ...baris, id: "r2", userId: "u-lain" }])).toBe(true);
  });

  it("names the three states", () => {
    expect(statusResmi(null)).toBe("BELUM");
    expect(statusResmi({ paidAt: null })).toBe("DITETAPKAN");
    expect(statusResmi({ paidAt: "2026-10-02T00:00:00Z" })).toBe("DIBAYAR");
  });
});

describe("validasiAturanKomisiPutus", () => {
  it("accepts only a boolean switch and one of the two bases", () => {
    expect(validasiAturanKomisiPutus({ aktif: false, dasar: "PER_SPG" })).toEqual({ aktif: false, dasar: "PER_SPG" });
    expect(validasiAturanKomisiPutus({ aktif: "ya", dasar: "PER_SPG" })).toBeNull();
    expect(validasiAturanKomisiPutus({ aktif: true, dasar: "SEMUA" })).toBeNull();
    expect(validasiAturanKomisiPutus(null)).toBeNull();
  });
});
