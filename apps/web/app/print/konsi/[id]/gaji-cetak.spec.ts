import { describe, expect, it } from "vitest";
import type { RincianSiklus } from "@/lib/konsinyasi/queries";
import type { RencanaBayarKomisi } from "@/lib/spg/koreksi";
import { ALASAN_KUNCI_DIBUKA, ALASAN_TAHAN, ALASAN_TANPA_RENCANA, susunGajiCetak } from "./gaji-cetak";

/*
 * Lembar cetak gaji & komisi siklus konsinyasi harus menyebut angka yang sama dengan layar siklus
 * dan yang dibayar penulis. Baris belum dibayar yang belum punya angka bayar — ditahan (angka aturan
 * lama yang belum bisa dibandingkan) atau siklus yang kuncinya dibuka lagi — tidak dicetak dengan
 * angka tersimpannya dan tidak ikut dijumlah: layar menulis "—" dan HP SPG tidak menyebut angka.
 */

type Baris = RincianSiklus["komisi"][number];

const rencana = (lain: Partial<RencanaBayarKomisi> = {}): RencanaBayarKomisi => ({
  refType: "ConsignmentCommission",
  refId: "cc-1",
  kunci: "konsi:siklus-1",
  komisiLama: 45_000,
  komisiBaru: 40_000,
  potongBaru: 8,
  berubah: true,
  gajiPokok: 1_000_000,
  potonganHilang: 0,
  dasar: 1_040_000,
  sasaran: true,
  koreksi: [],
  jumlahKoreksi: 17_500,
  dibayar: 1_057_500,
  dibawa: 0,
  koreksiDiBarisLain: null,
  ditahan: null,
  ...lain,
});

const baris = (lain: Partial<Baris> = {}): Baris => ({
  id: "cc-1",
  spgNama: "Ani",
  bergaji: true,
  gajiPokok: 1_000_000,
  komisi: 45_000,
  total: 1_045_000,
  potonganHilang: 0,
  dibayarPada: null,
  bebanTerbuka: 0,
  bayar: null,
  koreksiDiterapkan: [],
  dibayarkan: null,
  ...lain,
});

describe("susunGajiCetak", () => {
  it("baris belum dibayar memakai rencana bayar: komisi per SPG sekarang + koreksi yang ikut", () => {
    const h = susunGajiCetak([baris({ bayar: rencana() })], true);
    expect(h.baris[0].angka).toEqual({ komisi: 40_000, total: 1_040_000, potongan: 0, koreksi: 17_500, dibayarkan: 1_057_500 });
    expect(h.baris[0].alasan).toBeNull();
    expect(h).toMatchObject({ adaBelumPasti: false, totalKomisi: 1_040_000, totalKoreksi: 17_500, adaKoreksi: true, totalDibayarkan: 1_057_500 });
  });

  it("baris yang sudah dibayar memakai angka tersimpan dan koreksi yang diterapkan padanya", () => {
    const h = susunGajiCetak(
      [
        baris({
          dibayarPada: "2026-10-05T00:00:00.000Z",
          potonganHilang: 5_000,
          koreksiDiterapkan: [{ bulanJual: "2026-08", toko: "Toko Lain", jumlah: -2_500 }],
          dibayarkan: 1_037_500,
        }),
      ],
      true,
    );
    expect(h.baris[0].angka).toEqual({ komisi: 45_000, total: 1_045_000, potongan: 5_000, koreksi: -2_500, dibayarkan: 1_037_500 });
    expect(h.totalPotonganHilang).toBe(5_000);
  });

  it("baris yang ditahan tidak dicetak dengan angka tersimpannya dan tidak ikut dijumlah", () => {
    const h = susunGajiCetak(
      [
        baris({ id: "a", bayar: rencana() }),
        baris({ id: "b", spgNama: "Sari", komisi: 22_500, total: 1_022_500, potonganHilang: 3_000, bayar: rencana({ ditahan: "TANPA_TARIF", dibayar: 1_019_500 }) }),
      ],
      true,
    );
    expect(h.baris[1].angka).toBeNull();
    expect(h.baris[1].alasan).toBe(ALASAN_TAHAN.TANPA_TARIF);
    expect(h).toMatchObject({ adaBelumPasti: true, totalKomisi: 1_040_000, totalPotonganHilang: 0, totalKoreksi: 17_500, totalDibayarkan: 1_057_500 });
  });

  it("setiap alasan tahan punya keterangan sendiri", () => {
    const h = susunGajiCetak([baris({ bayar: rencana({ ditahan: "LAPORAN_TIDAK_LENGKAP" }) })], true);
    expect(h.baris[0].alasan).toBe(ALASAN_TAHAN.LAPORAN_TIDAK_LENGKAP);
  });

  it("siklus yang kuncinya dibuka lagi: belum ada angka bayar, angka tersimpannya tidak dicetak", () => {
    const h = susunGajiCetak([baris({ potonganHilang: 4_000 })], false);
    expect(h.baris[0]).toMatchObject({ angka: null, alasan: ALASAN_KUNCI_DIBUKA });
    expect(h).toMatchObject({ adaBelumPasti: true, totalKomisi: 0, totalPotonganHilang: 0, totalKoreksi: 0, adaKoreksi: false, totalDibayarkan: 0 });
  });

  it("siklus terkunci tanpa rencana bayar untuk baris itu: tetap tanpa angka", () => {
    const h = susunGajiCetak([baris()], true);
    expect(h.baris[0]).toMatchObject({ angka: null, alasan: ALASAN_TANPA_RENCANA });
  });

  it("baris yang sudah dibayar tetap dicetak walau siklusnya dibuka lagi", () => {
    const h = susunGajiCetak([baris({ dibayarPada: "2026-10-05T00:00:00.000Z", dibayarkan: 1_045_000 })], false);
    expect(h.baris[0].angka).toMatchObject({ total: 1_045_000, dibayarkan: 1_045_000 });
    expect(h.adaBelumPasti).toBe(false);
  });
});
