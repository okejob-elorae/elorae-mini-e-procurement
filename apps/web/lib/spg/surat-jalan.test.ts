import { describe, expect, it } from "vitest";
import { STATUS_MUTASI } from "./mutasi-aturan";
import {
  bisaDicetak,
  bolehDibukaSpg,
  keadaanSuratJalan,
  LABEL_STATUS_SURAT_JALAN,
  tautanSuratJalanHp,
  tautanSuratJalanKantor,
  teksBagikanSuratJalan,
  totalPotong,
} from "./surat-jalan";

describe("keadaanSuratJalan", () => {
  it("belum dikirim = DRAF, dikirim/diterima = berlaku, ditolak/batal/kembali = tidak bisa", () => {
    expect(keadaanSuratJalan("DIAJUKAN")).toBe("DRAF");
    expect(keadaanSuratJalan("DISETUJUI")).toBe("DRAF");
    expect(keadaanSuratJalan("DIKIRIM")).toBe("BERLAKU");
    expect(keadaanSuratJalan("DITERIMA")).toBe("BERLAKU");
    expect(keadaanSuratJalan("DITOLAK")).toBe("TIDAK_BISA");
    expect(keadaanSuratJalan("DIBATALKAN")).toBe("TIDAK_BISA");
    expect(keadaanSuratJalan("DIKEMBALIKAN")).toBe("TIDAK_BISA");
    expect(keadaanSuratJalan("ENTAH")).toBe("TIDAK_BISA");
    expect(bisaDicetak("DISETUJUI")).toBe(true);
    expect(bisaDicetak("DITOLAK")).toBe(false);
  });

  it("setiap status punya label kertas", () => {
    for (const s of STATUS_MUTASI) expect(LABEL_STATUS_SURAT_JALAN[s]).toBeTruthy();
  });
});

describe("bolehDibukaSpg", () => {
  const m = (status: string) => ({ status, asal: { id: "A" }, tujuan: { id: "B" } });

  it("toko asal selalu boleh", () => {
    for (const s of STATUS_MUTASI) expect(bolehDibukaSpg(m(s), "A")).toBe(true);
  });

  it("toko tujuan hanya sesudah barang berangkat", () => {
    expect(bolehDibukaSpg(m("DIAJUKAN"), "B")).toBe(false);
    expect(bolehDibukaSpg(m("DISETUJUI"), "B")).toBe(false);
    expect(bolehDibukaSpg(m("DIKIRIM"), "B")).toBe(true);
    expect(bolehDibukaSpg(m("DITERIMA"), "B")).toBe(true);
    expect(bolehDibukaSpg(m("DIKEMBALIKAN"), "B")).toBe(false);
  });

  it("toko lain tidak pernah", () => {
    for (const s of STATUS_MUTASI) expect(bolehDibukaSpg(m(s), "C")).toBe(false);
  });
});

describe("tautan dan teks bagikan", () => {
  it("tautan meng-encode id", () => {
    expect(tautanSuratJalanHp("abc")).toBe("/pwa/spg/mutasi/abc/surat-jalan");
    expect(tautanSuratJalanKantor("a/b")).toBe("/backoffice/spg-transfers/a%2Fb/surat-jalan");
  });

  it("teks bagikan menyebut nomor, arah, jumlah, dan status — tanpa harga", () => {
    const teks = teksBagikanSuratJalan({
      docNo: "MTS/2026/00012",
      status: "DIKIRIM",
      asal: "Toko A",
      tujuan: "Toko B",
      baris: [{ qty: 5 }, { qty: 7 }],
    });
    expect(teks).toContain("Surat jalan MTS/2026/00012");
    expect(teks).toContain("Dari: Toko A");
    expect(teks).toContain("Ke: Toko B");
    expect(teks).toContain("2 barang, 12 potong");
    expect(teks).toContain("Status: Dikirim");
    expect(teks).not.toContain("DRAF");
    expect(teks).not.toMatch(/\bRp\b|harga|rupiah/i);
  });

  it("teks bagikan menandai draf", () => {
    const teks = teksBagikanSuratJalan({ docNo: "MTS/2026/00013", status: "DISETUJUI", asal: "A", tujuan: "B", baris: [] });
    expect(teks).toContain("(DRAF — belum dikirim)");
    expect(teks).toContain("0 barang, 0 potong");
    expect(totalPotong([])).toBe(0);
  });
});
