import { describe, expect, it } from "vitest";
import { alasanTolakBukaKunci, alasanTolakKunci } from "./buka-kunci";

/*
 * Tombol "Buka kunci" dulu langsung menjalankan aksinya, dan tetap aktif di
 * KONSI/26/08/0001 yang sudah punya nomor nota, nomor faktur pajak, dan gaji SPG
 * yang dibayar — pembukaan yang pasti ditolak `bukaKunci`. Urutannya sama
 * dengan penulisnya, supaya alasan yang tertulis = alasan yang akan ditolak.
 * Sejak tagihan siklus lahir di Piutang, uang toko menahan lewat penghalang
 * tagihannya (BKM, kontrabon, pembayaran, tugas tagih).
 */
const siklus = (p: Partial<Parameters<typeof alasanTolakBukaKunci>[0]> = {}) => ({
  terkunci: true,
  noNota: null,
  noFakturPajak: null,
  komisi: [{ dibayarPada: null }],
  penghalangTagihan: null,
  ...p,
});

describe("alasanTolakBukaKunci", () => {
  it("boleh dibuka selama belum ada yang bergantung pada angkanya", () => {
    expect(alasanTolakBukaKunci(siklus())).toBeNull();
  });

  it("menyebut alasan pertama menurut urutan penulis", () => {
    expect(
      alasanTolakBukaKunci(
        siklus({
          noNota: "NP-202608-0058",
          noFakturPajak: "010.000-26.00000871",
          komisi: [{ dibayarPada: "2026-08-26T00:00:00.000Z" }],
          penghalangTagihan: "ADA_BKM",
        }),
      ),
    ).toBe("ADA_GAJI_SUDAH_DIBAYAR");
    expect(alasanTolakBukaKunci(siklus({ noNota: "NP-1", noFakturPajak: "010", penghalangTagihan: "ADA_BKM" }))).toBe("ADA_NOTA");
    expect(alasanTolakBukaKunci(siklus({ noFakturPajak: "010", penghalangTagihan: "ADA_BKM" }))).toBe("ADA_FAKTUR_PAJAK");
  });

  it("penghalang tagihan siklus di Piutang menahan pembukaan", () => {
    for (const k of ["ADA_BKM", "ADA_KONTRABON", "ADA_PEMBAYARAN_TOKO", "ADA_TUGAS_TAGIH"] as const) {
      expect(alasanTolakBukaKunci(siklus({ penghalangTagihan: k }))).toBe(k);
    }
  });

  it("siklus yang belum dikunci tidak punya apa pun untuk dibuka", () => {
    expect(alasanTolakBukaKunci(siklus({ terkunci: false }))).toBe("BELUM_DIKUNCI");
  });
});

const kunci = (p: Partial<Parameters<typeof alasanTolakKunci>[0]> = {}) => ({
  terkunci: false,
  bulanSelesai: true,
  siklusPertama: "OK" as const,
  adaLaporanSpg: true,
  adaLaporanToko: true,
  adaPemegang: true,
  ...p,
});

describe("alasanTolakKunci", () => {
  it("boleh dikunci bila semua syarat penulis terpenuhi", () => {
    expect(alasanTolakKunci(kunci())).toBeNull();
  });

  it("urutannya sama dengan kunciAngka", () => {
    expect(alasanTolakKunci(kunci({ terkunci: true, bulanSelesai: false }))).toBe("SUDAH_DIKUNCI");
    expect(alasanTolakKunci(kunci({ bulanSelesai: false, siklusPertama: "BELUM_DIATUR" }))).toBe("BULAN_BELUM_SELESAI");
    expect(alasanTolakKunci(kunci({ siklusPertama: "BELUM_DIATUR", adaLaporanSpg: false }))).toBe("SIKLUS_PERTAMA_BELUM_DIATUR");
    expect(alasanTolakKunci(kunci({ siklusPertama: "SEBELUM", adaLaporanSpg: false }))).toBe("SEBELUM_SIKLUS_PERTAMA");
    expect(alasanTolakKunci(kunci({ adaLaporanToko: false, adaPemegang: false }))).toBe("LAPORAN_BELUM_LENGKAP");
    expect(alasanTolakKunci(kunci({ adaPemegang: false }))).toBe("TOKO_TANPA_PEMEGANG");
  });
});
