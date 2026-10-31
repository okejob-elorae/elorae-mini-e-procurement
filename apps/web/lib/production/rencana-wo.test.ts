import { describe, expect, it } from "vitest";
import { alasanSimpanWo, caraIsiAwalWo, type KeadaanFormulirWo } from "./rencana-wo";

describe("caraIsiAwalWo", () => {
  it("tanpa kebutuhan tersimpan: ketik pcs", () => {
    expect(caraIsiAwalWo({ plannedQty: 100, expectedConsumption: null, konsumsiPerPcs: 0.5 })).toBe("pcs");
  });

  it("kebutuhan = pcs × konsumsi (dibuat dengan ketik pcs): ketik pcs", () => {
    expect(caraIsiAwalWo({ plannedQty: 194, expectedConsumption: 99.91, konsumsiPerPcs: 0.515 })).toBe("pcs");
  });

  it("selisih pembulatan Decimal(10,2) masih dianggap ketik pcs", () => {
    // 100 × 0,515349 = 51,5349 tersimpan 51,53.
    expect(caraIsiAwalWo({ plannedQty: 100, expectedConsumption: 51.53, konsumsiPerPcs: 0.515349 })).toBe("pcs");
  });

  it("kebutuhan bersisa (WO/2026/0007: 100 MTR → 194 pcs, sisa 0,09): hitung dari bahan", () => {
    expect(caraIsiAwalWo({ plannedQty: 194, expectedConsumption: 100, konsumsiPerPcs: 0.515 })).toBe("bahan");
  });

  it("konsumsi per pcs tidak diketahui tetapi ada kebutuhan: hitung dari bahan", () => {
    expect(caraIsiAwalWo({ plannedQty: 10, expectedConsumption: 5, konsumsiPerPcs: 0 })).toBe("bahan");
  });
});

const LENGKAP: KeadaanFormulirWo = {
  vendor: true,
  barangJadi: true,
  modeSku: false,
  tanpaVarian: false,
  pakaiRasio: false,
  totalRasio: 0,
  varianTerpilih: false,
  adaBom: true,
  bahanUtama: true,
  caraIsi: "pcs",
  pcs: 100,
  jumlahBahan: 0,
  menghitung: false,
  adaHasil: true,
  jumlahRencana: 100,
  stokKurang: false,
  rollCukup: true,
};

describe("alasanSimpanWo", () => {
  it("formulir lengkap boleh disimpan", () => {
    expect(alasanSimpanWo(LENGKAP)).toBeNull();
  });

  it("formulir kosong menyebut vendor dulu (urutan isian)", () => {
    expect(
      alasanSimpanWo({ ...LENGKAP, vendor: false, barangJadi: false, adaBom: false, bahanUtama: false, pcs: 0, adaHasil: false }),
    ).toBe("VENDOR");
  });

  it("menyebut barang jadi sesudah vendor", () => {
    expect(alasanSimpanWo({ ...LENGKAP, barangJadi: false })).toBe("BARANG_JADI");
  });

  it("mode SKU: tanpa varian, rasio bukan 100, varian belum dipilih", () => {
    expect(alasanSimpanWo({ ...LENGKAP, modeSku: true, tanpaVarian: true })).toBe("TANPA_VARIAN");
    expect(alasanSimpanWo({ ...LENGKAP, modeSku: true, pakaiRasio: true, totalRasio: 90 })).toBe("RASIO");
    expect(alasanSimpanWo({ ...LENGKAP, modeSku: true, pakaiRasio: true, totalRasio: 100 })).toBeNull();
    expect(alasanSimpanWo({ ...LENGKAP, modeSku: true })).toBe("VARIAN");
    expect(alasanSimpanWo({ ...LENGKAP, modeSku: true, varianTerpilih: true })).toBeNull();
  });

  it("BOM, bahan utama, lalu jumlah sesuai cara isi", () => {
    expect(alasanSimpanWo({ ...LENGKAP, adaBom: false })).toBe("BOM");
    expect(alasanSimpanWo({ ...LENGKAP, bahanUtama: false })).toBe("BAHAN_UTAMA");
    expect(alasanSimpanWo({ ...LENGKAP, pcs: 0, adaHasil: false })).toBe("JUMLAH_PCS");
    expect(alasanSimpanWo({ ...LENGKAP, caraIsi: "bahan", jumlahBahan: 0, adaHasil: false })).toBe("JUMLAH_BAHAN");
  });

  it("menunggu hitungan, lalu bahan yang tidak cukup untuk satu pcs", () => {
    expect(alasanSimpanWo({ ...LENGKAP, menghitung: true })).toBe("MENGHITUNG");
    expect(alasanSimpanWo({ ...LENGKAP, adaHasil: false })).toBe("MENGHITUNG");
    expect(alasanSimpanWo({ ...LENGKAP, caraIsi: "bahan", jumlahBahan: 0.1, jumlahRencana: 0 })).toBe("BAHAN_KURANG_SATU_PCS");
  });

  it("stok kurang lalu roll kurang", () => {
    expect(alasanSimpanWo({ ...LENGKAP, stokKurang: true, rollCukup: false })).toBe("STOK");
    expect(alasanSimpanWo({ ...LENGKAP, rollCukup: false })).toBe("ROLL");
  });
});
