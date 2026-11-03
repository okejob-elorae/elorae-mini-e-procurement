import { describe, expect, it } from "vitest";
import { hargaJubelioBerbeda, keputusanHargaBerlaku } from "@elorae/db";
import {
  alasanTidakBisaDiaktifkan,
  alasanTidakBisaDikirim,
  alasanTidakBisaDikirimUlang,
  alasanTidakBisaDinonaktifkan,
  bacaHargaDiharapkan,
  bacaJenisTampil,
  bedaDiJubelio,
  hargaTerbacaBerbeda,
  keputusanMasihBerlaku,
  hargaBerlaku,
  hargaKeTeks,
  hargaSama,
  jenisMenunggu,
  keadaanHargaJubelio,
  selisihHarga,
} from "./aturan";

const dasar = {
  barangJadi: true,
  sumber: "ERP" as const,
  saluran: "BOTH" as const,
  terpetakan: true,
  hargaErp: "150000.00",
  hargaJubelio: "150000.00",
  diajukanPada: null,
};

describe("keadaanHargaJubelio", () => {
  it("barang di Jubelio dengan harga sama → SAMA, tidak menunggu", () => {
    expect(keadaanHargaJubelio(dasar)).toBe("SAMA");
    expect(jenisMenunggu("SAMA")).toBeNull();
  });

  it("harga ERP berbeda dari harga terkonfirmasi → menunggu perubahan harga", () => {
    const k = keadaanHargaJubelio({ ...dasar, hargaErp: "175000.00" });
    expect(k).toBe("MENUNGGU_UBAH");
    expect(jenisMenunggu(k)).toBe("UBAH");
  });

  it("harga ERP dikosongkan sementara Jubelio masih punya harga → tetap menunggu (hanya bisa dikembalikan)", () => {
    expect(keadaanHargaJubelio({ ...dasar, hargaErp: null })).toBe("MENUNGGU_UBAH");
    expect(keadaanHargaJubelio({ ...dasar, hargaErp: "0.00" })).toBe("MENUNGGU_UBAH");
  });

  it("belum ada harga terkonfirmasi tetapi ERP punya harga → menunggu (— → harga ERP)", () => {
    expect(keadaanHargaJubelio({ ...dasar, hargaJubelio: null })).toBe("MENUNGGU_UBAH");
  });

  it("di Jubelio tanpa harga di kedua sisi (kosong atau 0) → TANPA_HARGA, tidak menunggu", () => {
    expect(keadaanHargaJubelio({ ...dasar, hargaErp: null, hargaJubelio: null })).toBe("TANPA_HARGA");
    expect(keadaanHargaJubelio({ ...dasar, hargaErp: "0.00", hargaJubelio: "0.00" })).toBe("TANPA_HARGA");
    expect(keadaanHargaJubelio({ ...dasar, hargaErp: "0.00", hargaJubelio: null })).toBe("TANPA_HARGA");
    expect(jenisMenunggu("TANPA_HARGA")).toBeNull();
  });

  it("barang ERP belum di Jubelio: diajukan → produk baru menunggu, tidak diajukan → belum di Jubelio", () => {
    const belum = { ...dasar, terpetakan: false, hargaJubelio: null };
    const k = keadaanHargaJubelio({ ...belum, diajukanPada: "2026-11-02T03:00:00.000Z" });
    expect(k).toBe("MENUNGGU_BARU");
    expect(jenisMenunggu(k)).toBe("BARU");
    expect(keadaanHargaJubelio({ ...belum, diajukanPada: new Date() })).toBe("MENUNGGU_BARU");
    expect(keadaanHargaJubelio(belum)).toBe("BELUM_DI_JUBELIO");
    expect(jenisMenunggu("BELUM_DI_JUBELIO")).toBeNull();
  });

  it("barang hasil impor Jubelio yang tidak terpetakan dan bukan barang jadi bukan urusan Jubelio", () => {
    expect(keadaanHargaJubelio({ ...dasar, terpetakan: false, sumber: "JUBELIO_INGEST", diajukanPada: new Date() })).toBe(
      "BUKAN_UNTUK_JUBELIO",
    );
    expect(keadaanHargaJubelio({ ...dasar, barangJadi: false, hargaErp: "1.00" })).toBe("BUKAN_UNTUK_JUBELIO");
  });

  it("Toko offline saja → SALURAN_OFFLINE, tidak pernah menunggu (terpetakan atau belum, P3a)", () => {
    expect(keadaanHargaJubelio({ ...dasar, saluran: "OFFLINE", hargaErp: "175000.00" })).toBe("SALURAN_OFFLINE");
    expect(
      keadaanHargaJubelio({ ...dasar, saluran: "OFFLINE", terpetakan: false, hargaJubelio: null, diajukanPada: new Date() }),
    ).toBe("SALURAN_OFFLINE");
    expect(jenisMenunggu("SALURAN_OFFLINE")).toBeNull();
    expect(keadaanHargaJubelio({ ...dasar, saluran: "OFFLINE", barangJadi: false })).toBe("BUKAN_UNTUK_JUBELIO");
  });
});

describe("bedaDiJubelio (P2/P75)", () => {
  const ubah = "2026-11-03T01:00:00.000Z";
  const sebelum = "2026-11-03T00:30:00.000Z";
  const sesudah = "2026-11-03T01:30:00.000Z";
  const beda = {
    barangJadi: true,
    terpetakan: true,
    terbacaPada: ubah,
    jubelioTertinggi: "175000.00",
    jubelioTerendah: "175000.00",
    hargaTerkonfirmasi: "150000.00",
    diputuskanPada: null as string | null,
    berubahPada: ubah as string | null,
    sedangDikirim: false,
  };

  it.each([
    ["sama", { jubelioTertinggi: "150000.00", jubelioTerendah: "150000.00" }, false],
    ["tertinggi berbeda", {}, true],
    ["satu varian tanpa harga (terendah 0)", { jubelioTertinggi: "150000.00", jubelioTerendah: "0.00" }, true],
    ["tanpa harga di kedua sisi", { jubelioTertinggi: null, jubelioTerendah: "0.00", hargaTerkonfirmasi: null }, false],
    ["belum pernah terbaca", { terbacaPada: null }, false],
    ["keputusan berlaku + sedang dikirim", { diputuskanPada: sesudah, sedangDikirim: true }, false],
    ["keputusan berlaku tanpa kiriman (kirimannya gagal) → tetap BEDA", { diputuskanPada: sesudah }, true],
    ["keputusan basi + sedang dikirim", { diputuskanPada: sebelum, sedangDikirim: true }, true],
    ["belum di Jubelio", { terpetakan: false }, false],
    ["bukan barang jadi", { barangJadi: false }, false],
  ])("%s", (_label, lain, hasil) => {
    expect(bedaDiJubelio({ ...beda, ...lain })).toBe(hasil);
  });

  /*
   * R22: apa pun salurannya — tidak ada masukan saluran sama sekali, jadi "Toko offline saja" yang
   * sudah dinonaktifkan di Jubelio diawasi persis seperti barang lain, sama dengan penahanan di
   * apps/api (`tahanKarenaHargaBeda` juga tanpa saluran).
   */
  it("tidak memandang saluran jual (R22)", () => {
    const masukan = Object.keys(beda).sort();
    expect(masukan).not.toContain("saluran");
    expect(bedaDiJubelio(beda)).toBe(true);
  });

  it("sepakat kasus demi kasus dengan predikat @elorae/db yang dipakai apps/api", () => {
    const harga = [null, "0.00", "150000.00", "150000", "175000.00", "abc"];
    for (const a of harga)
      for (const b of harga)
        for (const k of harga) {
          expect(hargaTerbacaBerbeda({ jubelioTertinggi: a, jubelioTerendah: b, hargaTerkonfirmasi: k })).toBe(
            hargaJubelioBerbeda({ tertinggi: a, terendah: b, terkonfirmasi: k }),
          );
        }
    const waktu = [null, sebelum, ubah, sesudah];
    for (const p of waktu)
      for (const u of waktu) {
        expect(keputusanMasihBerlaku({ diputuskanPada: p, berubahPada: u })).toBe(
          keputusanHargaBerlaku({ diputuskanPada: p ? new Date(p) : null, berubahPada: u ? new Date(u) : null }),
        );
      }
  });
});

describe("alasan kirim ulang / nonaktifkan / aktifkan", () => {
  const isi = {
    hargaTerkonfirmasi: "150000.00",
    kategoriTerpetakan: true,
    menungguKonfirmasi: false,
    hargaErp: "150000.00",
    jubelioTertinggi: "175000.00",
    jubelioTerendah: "175000.00",
  };

  it("kirim ulang: tanpa harga terkonfirmasi, kategori, dan harga ERP baru yang sudah tampil di Jubelio", () => {
    expect(alasanTidakBisaDikirimUlang(isi)).toBeNull();
    expect(alasanTidakBisaDikirimUlang({ ...isi, hargaTerkonfirmasi: null })).toBe("TANPA_HARGA_TERKONFIRMASI");
    expect(alasanTidakBisaDikirimUlang({ ...isi, kategoriTerpetakan: false })).toBe("KATEGORI_BELUM_DIPETAKAN");
    expect(alasanTidakBisaDikirimUlang({ ...isi, menungguKonfirmasi: true, hargaErp: "175000.00" })).toBe("ADA_HARGA_BARU");
    // Harga baru menunggu tetapi Jubelio menampilkan harga lain → kirim ulang tetap boleh.
    expect(alasanTidakBisaDikirimUlang({ ...isi, menungguKonfirmasi: true, hargaErp: "180000.00" })).toBeNull();
  });

  it("nonaktifkan (P72) dan aktifkan lagi", () => {
    expect(alasanTidakBisaDinonaktifkan({ hargaTerkonfirmasi: "150000.00", kategoriTerpetakan: true, bawaanAda: true })).toBeNull();
    expect(alasanTidakBisaDinonaktifkan({ hargaTerkonfirmasi: "0.00", kategoriTerpetakan: true, bawaanAda: true })).toBe(
      "TANPA_HARGA_TERKONFIRMASI",
    );
    expect(alasanTidakBisaDinonaktifkan({ hargaTerkonfirmasi: "1.00", kategoriTerpetakan: false, bawaanAda: true })).toBe(
      "KATEGORI_BELUM_DIPETAKAN",
    );
    expect(alasanTidakBisaDinonaktifkan({ hargaTerkonfirmasi: "1.00", kategoriTerpetakan: true, bawaanAda: false })).toBe(
      "BAWAAN_BELUM_ADA",
    );
    expect(alasanTidakBisaDiaktifkan({ kategoriTerpetakan: true, bawaanAda: true })).toBeNull();
    expect(alasanTidakBisaDiaktifkan({ kategoriTerpetakan: false, bawaanAda: true })).toBe("KATEGORI_BELUM_DIPETAKAN");
    expect(alasanTidakBisaDiaktifkan({ kategoriTerpetakan: true, bawaanAda: false })).toBe("BAWAAN_BELUM_ADA");
  });

  it("bacaJenisTampil", () => {
    expect(bacaJenisTampil("BEDA")).toBe("BEDA");
    expect(bacaJenisTampil("UBAH")).toBe("UBAH");
    expect(bacaJenisTampil("beda")).toBeNull();
  });
});

describe("hargaSama / hargaKeTeks / hargaBerlaku", () => {
  it("membandingkan dalam sen", () => {
    expect(hargaSama("150000.00", "150000")).toBe(true);
    expect(hargaSama("150000.5", "150000.50")).toBe(true);
    expect(hargaSama("150000.01", "150000")).toBe(false);
  });

  it("null hanya sama dengan null", () => {
    expect(hargaSama(null, null)).toBe(true);
    expect(hargaSama(null, "0.00")).toBe(false);
    expect(hargaSama("0.00", null)).toBe(false);
  });

  it("menulis Decimal/angka sebagai token dua desimal", () => {
    expect(hargaKeTeks(150000)).toBe("150000.00");
    expect(hargaKeTeks({ toFixed: (d: number) => (150000.5).toFixed(d) })).toBe("150000.50");
    expect(hargaKeTeks(null)).toBeNull();
    expect(hargaKeTeks(undefined)).toBeNull();
    expect(hargaKeTeks(Number.NaN)).toBeNull();
  });

  it("harga 0 atau kurang tidak berlaku", () => {
    expect(hargaBerlaku("0.00")).toBeNull();
    expect(hargaBerlaku("-5")).toBeNull();
    expect(hargaBerlaku(null)).toBeNull();
    expect(hargaBerlaku("10.00")).toBe("10.00");
  });
});

describe("selisihHarga", () => {
  it("naik dan turun, dengan persen", () => {
    expect(selisihHarga("100000.00", "120000.00")).toEqual({ rupiah: 20000, persen: 20 });
    expect(selisihHarga("120000.00", "90000.00")).toEqual({ rupiah: -30000, persen: -25 });
  });

  it("tanpa harga lama (atau 0) persennya null; tanpa harga baru tidak ada selisih", () => {
    expect(selisihHarga(null, "120000.00")).toEqual({ rupiah: 120000, persen: null });
    expect(selisihHarga("0.00", "120000.00")).toEqual({ rupiah: 120000, persen: null });
    expect(selisihHarga("120000.00", null)).toBeNull();
  });
});

describe("alasanTidakBisaDikirim", () => {
  it("harga ERP kosong atau 0 → HARGA_KOSONG, kategori belum dipetakan → KATEGORI_BELUM_DIPETAKAN", () => {
    expect(alasanTidakBisaDikirim({ hargaErp: null, kategoriTerpetakan: true })).toBe("HARGA_KOSONG");
    expect(alasanTidakBisaDikirim({ hargaErp: "0.00", kategoriTerpetakan: true })).toBe("HARGA_KOSONG");
    expect(alasanTidakBisaDikirim({ hargaErp: "100.00", kategoriTerpetakan: false })).toBe("KATEGORI_BELUM_DIPETAKAN");
    expect(alasanTidakBisaDikirim({ hargaErp: "100.00", kategoriTerpetakan: true })).toBeNull();
  });
});

describe("bacaHargaDiharapkan", () => {
  it("menerima null dan angka desimal biasa", () => {
    expect(bacaHargaDiharapkan(null)).toEqual({ ok: true, harga: null });
    expect(bacaHargaDiharapkan("150000")).toEqual({ ok: true, harga: "150000" });
    expect(bacaHargaDiharapkan("150000.00")).toEqual({ ok: true, harga: "150000.00" });
  });

  it.each([["1e5"], ["-1"], ["1.234"], [""], [" 1"], [150000], [{}], [undefined]])("menolak %j", (nilai) => {
    expect(bacaHargaDiharapkan(nilai)).toEqual({ ok: false });
  });
});
