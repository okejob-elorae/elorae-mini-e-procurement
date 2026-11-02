import { describe, expect, it } from "vitest";
import {
  alasanTidakBisaDikirim,
  bacaHargaDiharapkan,
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
