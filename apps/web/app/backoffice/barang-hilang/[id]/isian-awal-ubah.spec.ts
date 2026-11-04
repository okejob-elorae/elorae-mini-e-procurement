import { describe, expect, it } from "vitest";
import type { BagianRincian, KlaimBagian } from "@/lib/spg/hilang-queries";
import { isianAwalUbah } from "./isian-awal-ubah";

/*
 * Dialog "Ubah keputusan" barang hilang. Sesudah klaim ekspedisi DITOLAK, total catatan masih nilai
 * klaimnya (nilai jual di nota); penulisnya memakai Σ nilai baris sebagai bawaan (P42/R19). Dulu
 * dialognya mulai dari total catatan dan mengisi ulang bagian EKSPEDISI yang ditolak, jadi
 * mengganti penanggung dengan tangan menyimpan beban SPG/sales sebesar harga nota.
 */

const klaim = (status: string): KlaimBagian => ({
  status,
  diajukanPada: null,
  cara: null,
  referensi: null,
  dicatatOleh: null,
  dicatatPada: null,
  diputuskanOleh: null,
  diputuskanPada: null,
  catatan: null,
});

const bagian = (b: Partial<BagianRincian> & Pick<BagianRincian, "bearer" | "nilai">): BagianRincian => ({
  id: `b-${b.bearer}`,
  klaim: null,
  orang: null,
  dipotong: 0,
  sisa: b.nilai,
  lunas: false,
  lunasPada: null,
  catatanLunas: null,
  potongan: [],
  ...b,
});

describe("isianAwalUbah", () => {
  it("klaim ekspedisi DITOLAK: total dari bawaan penulis dan bagian EKSPEDISI tidak ikut", () => {
    const hasil = isianAwalUbah({
      totalBawaanUbah: 300_000,
      bagian: [bagian({ bearer: "EKSPEDISI", nilai: 450_000, klaim: klaim("DITOLAK") })],
      keringanan: null,
    });
    expect(hasil).toEqual({ total: 300_000, bagian: [] });
  });

  it("klaim ekspedisi yang TIDAK ditolak tetap terisi apa adanya", () => {
    const hasil = isianAwalUbah({
      totalBawaanUbah: 450_000,
      bagian: [bagian({ bearer: "EKSPEDISI", nilai: 450_000, klaim: klaim("DIBAYAR") })],
      keringanan: null,
    });
    expect(hasil).toEqual({ total: 450_000, bagian: [{ bearer: "EKSPEDISI", bearerUserId: null, amount: 450_000 }] });
  });

  it("tanpa ekspedisi: total dan bagian yang berlaku", () => {
    const hasil = isianAwalUbah({
      totalBawaanUbah: 100_000,
      bagian: [
        bagian({ bearer: "SPG", nilai: 60_000, orang: { id: "u-1", nama: "Ani" } }),
        bagian({ bearer: "ELORAE", nilai: 40_000 }),
      ],
      keringanan: null,
    });
    expect(hasil).toEqual({
      total: 100_000,
      bagian: [
        { bearer: "SPG", bearerUserId: "u-1", amount: 60_000 },
        { bearer: "ELORAE", bearerUserId: null, amount: 40_000 },
      ],
    });
  });

  it("dengan keringanan: mulai dari pembagian SEBELUM keringanan", () => {
    const sebelum = [{ bearer: "SPG" as const, bearerUserId: "u-1", amount: 100_000 }];
    const hasil = isianAwalUbah({
      totalBawaanUbah: 100_000,
      bagian: [
        bagian({ bearer: "SPG", nilai: 90_000, orang: { id: "u-1", nama: "Ani" } }),
        bagian({ bearer: "ELORAE", nilai: 10_000 }),
      ],
      keringanan: { persen: 10, diserap: 10_000, sebelum, perOrang: [] },
    });
    expect(hasil).toEqual({ total: 100_000, bagian: sebelum });
  });
});
