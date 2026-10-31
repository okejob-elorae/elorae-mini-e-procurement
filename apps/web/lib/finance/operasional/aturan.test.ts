import { describe, expect, it } from "vitest";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { dppDariMemo, peranDariMemo } from "@/lib/finance/pajak/jurnal-ppn";
import { keBarisJurnal, type BarisBertanda } from "@/lib/finance/lapangan/aturan";
import {
  akhirBulanWib,
  barisBarangHilang,
  barisBayarBiayaPerjalanan,
  barisBayarKomisi,
  barisBayarTokoKonsi,
  barisBiayaPerjalanan,
  barisGudangRusak,
  barisKomisi,
  barisPindahKonsi,
  barisPotongSales,
  barisReturKonsi,
  barisReturPemasok,
  barisSiklusKonsi,
  barisStokManual,
  bacaPeriode,
  JENIS_TERTUNDA_OPERASIONAL,
  keBarisJurnalOperasional,
  nilaiBiayaKonsi,
  rataRataKirim,
  SEMUA_SUMBER_OPERASIONAL,
  sumberOperasionalDariJenis,
  tanggalPeriode,
} from "./aturan";
import { putarGudangRusak } from "./nilai-rusak";

const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP", berlakuSejak: null };
const T = new Date("2026-10-15T00:00:00+07:00");

/** Peran → sen bersih (debit +). */
function per(baris: readonly BarisBertanda[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const b of baris) r[b.role] = (r[b.role] ?? 0) + b.sen;
  return r;
}
const seimbang = (baris: readonly BarisBertanda[]) => baris.reduce((s, b) => s + b.sen, 0);

describe("sumber & jenis tertunda", () => {
  it("setiap sumber punya kind unik yang bisa dibaca balik", () => {
    const kinds = SEMUA_SUMBER_OPERASIONAL.map((s) => JENIS_TERTUNDA_OPERASIONAL[s]);
    expect(new Set(kinds).size).toBe(kinds.length);
    for (const s of SEMUA_SUMBER_OPERASIONAL) expect(sumberOperasionalDariJenis(JENIS_TERTUNDA_OPERASIONAL[s])).toBe(s);
    expect(sumberOperasionalDariJenis("nota_putus")).toBeNull();
  });
});

describe("tanggal", () => {
  it("akhir bulan pukul 00.00 WIB; siklus yang dikunci lebih awal memakai saat dikunci", () => {
    expect(akhirBulanWib(2026, 9).toISOString()).toBe("2026-09-29T17:00:00.000Z");
    expect(akhirBulanWib(2026, 12).toISOString()).toBe("2026-12-30T17:00:00.000Z");
    expect(tanggalPeriode(2026, 9, new Date("2026-10-03T02:00:00Z")).toISOString()).toBe("2026-09-29T17:00:00.000Z");
    const awal = new Date("2026-09-20T02:00:00Z");
    expect(tanggalPeriode(2026, 9, awal)).toBe(awal);
    expect(bacaPeriode("2026-09")).toEqual([2026, 9]);
    expect(bacaPeriode("2026-13")).toBeNull();
  });
});

describe("pindah ke toko konsinyasi", () => {
  it("persediaan gudang (per tipe) pindah ke persediaan konsinyasi, toko di baris konsinyasi", () => {
    const b = barisPindahKonsi({
      storeId: "s1",
      keluar: [
        { tipeBarang: "FINISHED_GOOD", nilai: 100_000 },
        { tipeBarang: "FINISHED_GOOD", nilai: 50_000.5 },
        { tipeBarang: "ACCESSORIES", nilai: 1_000 },
      ],
    });
    expect(per(b)).toEqual({ INVENTORY_CONSIGNMENT: 15_100_050, INVENTORY_FG: -15_000_050, INVENTORY: -100_000 });
    expect(b.find((x) => x.role === "INVENTORY_CONSIGNMENT")?.storeId).toBe("s1");
    expect(seimbang(b)).toBe(0);
    expect(barisPindahKonsi({ storeId: "s1", keluar: [] })).toEqual([]);
  });
});

describe("retur dari toko konsinyasi", () => {
  it("layak + rusak masuk gudang, konsinyasi keluar pada biaya kirim, selisih ke variance", () => {
    const b = barisReturKonsi({ storeId: "s1", stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 60_000 }], rusak: 20_000, biayaKonsi: 75_000 });
    expect(per(b)).toEqual({ INVENTORY_FG: 6_000_000, INVENTORY_DAMAGED: 2_000_000, INVENTORY_CONSIGNMENT: -7_500_000, INVENTORY_VARIANCE: -500_000 });
    expect(seimbang(b)).toBe(0);
  });
  it("tanpa selisih tidak ada baris variance", () => {
    const b = barisReturKonsi({ storeId: "s1", stokLayak: [{ tipeBarang: "FINISHED_GOOD", nilai: 75_000 }], rusak: 0, biayaKonsi: 75_000 });
    expect(per(b)).toEqual({ INVENTORY_FG: 7_500_000, INVENTORY_CONSIGNMENT: -7_500_000 });
  });
});

describe("siklus konsinyasi dikunci", () => {
  it("non-PKP: tagihan = laku − promo; promo jadi potongan; beban hilang jadi pemulihan; HPP dari konsinyasi", () => {
    const b = barisSiklusKonsi({ storeId: "s1", lakuResmi: 700_000, promoElorae: 20_000, bebanHilang: 75_000, hpp: 400_000, pengaturanPpn: NON_PKP, pakaiPpn: true, tanggal: T });
    expect(per(b)).toEqual({
      AR_CONSIGNMENT: 75_500_000,
      SALES_REVENUE: -70_000_000,
      SALES_DISCOUNT: 2_000_000,
      LOSS_RECOVERY: -7_500_000,
      COGS: 40_000_000,
      INVENTORY_CONSIGNMENT: -40_000_000,
    });
    expect(seimbang(b)).toBe(0);
    for (const x of b) if (x.role === "SALES_REVENUE" || x.role === "COGS") expect(x).toMatchObject({ channel: "KONSINYASI", storeId: "s1" });
  });
  it("PKP: PPN dihitung atas tagihan bersih promo; DPP potongan = DPP laku − DPP bersih", () => {
    const b = barisSiklusKonsi({ storeId: "s1", lakuResmi: 1_110_000, promoElorae: 111_000, bebanHilang: 0, hpp: 0, pengaturanPpn: PKP, pakaiPpn: true, tanggal: T });
    const r = per(b);
    expect(r.AR_CONSIGNMENT).toBe(99_900_000);
    expect(r.SALES_REVENUE).toBe(-100_000_000);
    expect(r.SALES_DISCOUNT).toBe(10_000_000);
    expect(r.PPN_KELUARAN).toBe(-9_900_000);
    expect(seimbang(b)).toBe(0);
    const jurnal = keBarisJurnalOperasional(b);
    const ppn = jurnal.find((l) => l.role === "PPN_KELUARAN")!;
    expect(peranDariMemo(ppn.memo)).toBe("PPN_KELUARAN");
    expect(dppDariMemo(ppn.memo)).toBe(900_000);
    expect(jurnal.find((l) => l.role === "SALES_REVENUE")!.memo).toBe("SALES_REVENUE");
  });
  it("penyelaras lapangan (dipakai siklus) menulis DPP PPN bersih dari potongan penjualan", () => {
    const b = barisSiklusKonsi({ storeId: "s1", lakuResmi: 1_110_000, promoElorae: 111_000, bebanHilang: 0, hpp: 0, pengaturanPpn: PKP, pakaiPpn: true, tanggal: T });
    const ppn = keBarisJurnal(b).find((l) => l.role === "PPN_KELUARAN")!;
    expect(dppDariMemo(ppn.memo)).toBe(900_000);
  });

  it("PPN per toko: dipisah HANYA bila Elorae PKP pada tanggal jurnal DAN toko memakai PPN (empat kombinasi)", () => {
    const bahan = { storeId: "s1", lakuResmi: 1_110_000, promoElorae: 111_000, bebanHilang: 0, hpp: 0, tanggal: T };
    // PKP + toko ber-PPN: PPN keluaran atas tagihan bersih.
    expect(per(barisSiklusKonsi({ ...bahan, pengaturanPpn: PKP, pakaiPpn: true }))).toEqual({
      AR_CONSIGNMENT: 99_900_000,
      SALES_REVENUE: -100_000_000,
      SALES_DISCOUNT: 10_000_000,
      PPN_KELUARAN: -9_900_000,
    });
    // Tiga lainnya: seluruh tagihan = pendapatan, tanpa baris PPN; piutang tetap sebesar tagihan.
    const tanpaPpn = { AR_CONSIGNMENT: 99_900_000, SALES_REVENUE: -111_000_000, SALES_DISCOUNT: 11_100_000 };
    for (const [pengaturanPpn, pakaiPpn] of [
      [PKP, false],
      [NON_PKP, true],
      [NON_PKP, false],
    ] as const) {
      const b = barisSiklusKonsi({ ...bahan, pengaturanPpn, pakaiPpn });
      expect(per(b)).toEqual(tanpaPpn);
      expect(b.some((x) => x.role === "PPN_KELUARAN")).toBe(false);
      expect(seimbang(b)).toBe(0);
    }
    // PKP yang baru berlaku SESUDAH tanggal jurnal: tanpa PPN walau toko ber-PPN.
    const pkpNanti: PengaturanPpn = { ...PKP, berlakuSejak: "2026-11-01" };
    expect(per(barisSiklusKonsi({ ...bahan, pengaturanPpn: pkpNanti, pakaiPpn: true }))).toEqual(tanpaPpn);
  });

  it("tanpa laku dan tanpa apa pun → kosong", () => {
    expect(barisSiklusKonsi({ storeId: "s1", lakuResmi: 0, promoElorae: 0, bebanHilang: 0, hpp: 0, pengaturanPpn: NON_PKP, pakaiPpn: false, tanggal: T })).toEqual([]);
  });
});

describe("komisi", () => {
  it("bruto jadi beban + hutang; potongan barang hilang mengurangi hutang ke pemulihan", () => {
    const b = barisKomisi({ peranBeban: "SPG_COMMISSION_EXPENSE", bruto: 1_500_000, potongan: 200_000, storeId: "s1", kanal: "KONSINYASI" });
    expect(per(b)).toEqual({ SPG_COMMISSION_EXPENSE: 150_000_000, COMMISSION_PAYABLE: -130_000_000, LOSS_RECOVERY: -20_000_000 });
    expect(seimbang(b)).toBe(0);
  });
  it("dibayar: hutang ke bank", () => {
    expect(per(barisBayarKomisi(1_300_000))).toEqual({ COMMISSION_PAYABLE: 130_000_000, BANK: -130_000_000 });
    expect(barisBayarKomisi(0)).toEqual([]);
  });
  it("potongan beban sales", () => {
    expect(per(barisPotongSales(50_000))).toEqual({ SALES_COMMISSION_EXPENSE: 5_000_000, LOSS_RECOVERY: -5_000_000 });
  });
});

describe("pembayaran toko konsinyasi", () => {
  it("tunai ke kas, transfer/giro ke bank; dibatalkan → kosong", () => {
    expect(per(barisBayarTokoKonsi({ storeId: "s1", nilai: 500_000, cara: "tunai", batal: false }))).toEqual({ CASH: 50_000_000, AR_CONSIGNMENT: -50_000_000 });
    expect(per(barisBayarTokoKonsi({ storeId: "s1", nilai: 500_000, cara: "giro", batal: false }))).toEqual({ BANK: 50_000_000, AR_CONSIGNMENT: -50_000_000 });
    expect(barisBayarTokoKonsi({ storeId: "s1", nilai: 500_000, cara: "transfer", batal: true })).toEqual([]);
  });
});

describe("barang hilang", () => {
  it("beban sebesar biaya, konsinyasi berkurang", () => {
    const b = barisBarangHilang({ storeId: "s1", biaya: 120_000 });
    expect(per(b)).toEqual({ LOSS_EXPENSE: 12_000_000, INVENTORY_CONSIGNMENT: -12_000_000 });
  });
});

describe("gudang rusak", () => {
  it("musnahkan = beban", () => {
    expect(per(barisGudangRusak({ keputusan: "MUSNAHKAN", biaya: 30_000, pengaturanPpn: NON_PKP, tanggal: T }))).toEqual({ LOSS_EXPENSE: 3_000_000, INVENTORY_DAMAGED: -3_000_000 });
  });
  it("perbaiki = kembali ke persediaan pada nilai kartu stok, selisihnya variance", () => {
    const b = barisGudangRusak({ keputusan: "PERBAIKI", biaya: 30_000, masuk: { tipeBarang: "FINISHED_GOOD", nilai: 32_000 }, pengaturanPpn: NON_PKP, tanggal: T });
    expect(per(b)).toEqual({ INVENTORY_FG: 3_200_000, INVENTORY_DAMAGED: -3_000_000, INVENTORY_VARIANCE: -200_000 });
  });
  it("jual obral = HPP + penjualan tunai (PPN bila PKP); tanpa hasil hanya HPP", () => {
    const tanpa = barisGudangRusak({ keputusan: "JUAL_OBRAL", biaya: 30_000, hasilJual: null, pengaturanPpn: NON_PKP, tanggal: T });
    expect(per(tanpa)).toEqual({ COGS: 3_000_000, INVENTORY_DAMAGED: -3_000_000 });
    const pkp = barisGudangRusak({ keputusan: "JUAL_OBRAL", biaya: 30_000, hasilJual: 11_100, pengaturanPpn: PKP, tanggal: T });
    expect(per(pkp)).toEqual({ COGS: 3_000_000, INVENTORY_DAMAGED: -3_000_000, CASH: 1_110_000, SALES_REVENUE: -1_000_000, PPN_KELUARAN: -110_000 });
    expect(seimbang(pkp)).toBe(0);
  });
});

describe("stok manual", () => {
  it("tambah dan kurang", () => {
    expect(per(barisStokManual({ tipeBarang: "FABRIC", nilai: 25_000 }))).toEqual({ INVENTORY: 2_500_000, INVENTORY_VARIANCE: -2_500_000 });
    expect(per(barisStokManual({ tipeBarang: "FINISHED_GOOD", nilai: -25_000 }))).toEqual({ INVENTORY_FG: -2_500_000, INVENTORY_VARIANCE: 2_500_000 });
    expect(barisStokManual({ tipeBarang: "FABRIC", nilai: 0 })).toEqual([]);
  });
});

describe("retur ke pemasok", () => {
  it("PKP: hutang berkurang kredit, PPN masukan dibalik, persediaan keluar, selisih variance", () => {
    const b = barisReturPemasok({ kredit: 111_000, ppnMasukan: 11_000, keluar: [{ tipeBarang: "FABRIC", nilai: 98_000 }] });
    expect(per(b)).toEqual({ AP: 11_100_000, PPN_MASUKAN: -1_100_000, INVENTORY: -9_800_000, INVENTORY_VARIANCE: -200_000 });
    expect(seimbang(b)).toBe(0);
    const j = keBarisJurnalOperasional(b, { dppMasukan: 100_000 });
    expect(dppDariMemo(j.find((l) => l.role === "PPN_MASUKAN")!.memo)).toBe(100_000);
  });
  it("tanpa kredit PO: nilai keluar ke variance", () => {
    expect(per(barisReturPemasok({ kredit: 0, ppnMasukan: 5_000, keluar: [{ tipeBarang: "FABRIC", nilai: 40_000 }] }))).toEqual({ INVENTORY: -4_000_000, INVENTORY_VARIANCE: 4_000_000 });
  });
});

describe("biaya perjalanan", () => {
  it("disetujui lalu dibayar", () => {
    expect(per(barisBiayaPerjalanan(75_000))).toEqual({ TRAVEL_EXPENSE: 7_500_000, REIMBURSE_PAYABLE: -7_500_000 });
    expect(per(barisBayarBiayaPerjalanan(75_000))).toEqual({ REIMBURSE_PAYABLE: 7_500_000, CASH: -7_500_000 });
  });
});

describe("biaya konsinyasi", () => {
  it("rata-rata tertimbang kiriman; tanpa kiriman null", () => {
    expect(rataRataKirim([{ qty: -2, biaya: 50_000 }, { qty: -1, biaya: 80_000 }])).toBe(60_000);
    expect(rataRataKirim([])).toBeNull();
    expect(nilaiBiayaKonsi([{ itemId: "a", qty: 3 }, { itemId: null, qty: 9 }, { itemId: "b", qty: 1 }], new Map([["a", 33_333.333], ["b", 10]]))).toBe(100_010);
  });
});

describe("putar gudang rusak", () => {
  const t = (n: number) => new Date(2026, 0, n);
  it("masuk bernilai, keluar rata-rata, keluar terakhir menghabiskan sisa nilai", () => {
    const r = putarGudangRusak(
      [
        { id: "m1", kind: "MASUK_RETUR", qty: 2, value: 100, createdAt: t(1) },
        { id: "m2", kind: "MASUK_RETUR", qty: 1, value: 51, createdAt: t(2) },
        { id: "k1", kind: "MUSNAHKAN", qty: -1, value: null, createdAt: t(3) },
        { id: "k2", kind: "PERBAIKI", qty: -2, value: null, createdAt: t(4) },
      ],
      0,
    );
    expect(r.keluarSen.get("k1")).toBe(5_033);
    expect(r.keluarSen.get("k2")).toBe(10_067);
    expect(r.qty).toBe(0);
    expect(r.sen).toBe(0);
  });
  it("masuk lama tanpa nilai memakai harga cadangan; nilai keluar yang tercatat dipakai apa adanya; hasil jual obral diabaikan", () => {
    const r = putarGudangRusak(
      [
        { id: "m1", kind: "MASUK_RETUR", qty: 4, value: null, createdAt: t(1) },
        { id: "k1", kind: "JUAL_OBRAL", qty: -1, value: 999_999, createdAt: t(2) },
        { id: "k2", kind: "MUSNAHKAN", qty: -1, value: 7, createdAt: t(3) },
      ],
      10,
      new Map([["k1", 9]]),
    );
    expect(r.masukSen.get("m1")).toBe(4_000);
    expect(r.keluarSen.get("k1")).toBe(900);
    expect(r.keluarSen.get("k2")).toBe(700);
    expect(r).toMatchObject({ qty: 2, sen: 2_400 });
  });
});
