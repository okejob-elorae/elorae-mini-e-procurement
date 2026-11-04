import { describe, expect, it } from "vitest";
import { awalFormulirGrn } from "./awal-grn";

/*
 * "Terima barang" di rincian PO membuka formulir GRN dengan `?poId=`. Formulir
 * juga memulihkan draf di perangkat. Draf yang berisi isian untuk PO LAIN tidak
 * boleh tertimpa diam-diam — pengguna memilih: lanjutkan draf atau buang.
 */
const draf = (poId: string, isi = true) => ({ poId, bermakna: isi });

describe("awalFormulirGrn", () => {
  it("tanpa ?poId: draf (kalau ada) dipulihkan", () => {
    expect(awalFormulirGrn("", draf("po-a"))).toBe("draf");
    expect(awalFormulirGrn("", null)).toBe("kosong");
  });

  it("?poId tanpa draf → PO terisi", () => {
    expect(awalFormulirGrn("po-a", null)).toBe("po");
  });

  it("draf untuk PO yang sama → draf dipulihkan (barisnya sudah diisi)", () => {
    expect(awalFormulirGrn("po-a", draf("po-a"))).toBe("draf");
  });

  it("draf kosong (tanpa isian) → PO dari tautan", () => {
    expect(awalFormulirGrn("po-a", draf("", false))).toBe("po");
  });

  it("draf berisi untuk PO lain → konflik, pengguna memilih", () => {
    expect(awalFormulirGrn("po-a", draf("po-b"))).toBe("konflik");
    expect(awalFormulirGrn("po-a", draf(""))).toBe("konflik");
  });
});
