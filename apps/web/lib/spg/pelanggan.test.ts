import { describe, expect, it } from "vitest";
import { hpLokal, hpUntukCari, periksaIsianPelanggan, rapikanNamaPelanggan, samarkanHp } from "./pelanggan";

describe("periksaIsianPelanggan", () => {
  it("stores the phone in the 62… form whatever way it was typed", () => {
    for (const hp of ["0812-3456-7890", "+62 812 3456 7890", "812 3456 7890", "6281234567890"]) {
      const r = periksaIsianPelanggan({ nama: "Rina", hp, setuju: true }, true);
      expect(r).toEqual({ ok: true, data: { nama: "Rina", hp: "6281234567890", catatan: null } });
    }
  });

  it("refuses a landline: WhatsApp would open a chat nobody reads", () => {
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "022-7654321", setuju: true }, true)).toEqual({ ok: false, code: "HP_TIDAK_VALID" });
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "12", setuju: true }, true)).toEqual({ ok: false, code: "HP_TIDAK_VALID" });
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "", setuju: true }, true)).toEqual({ ok: false, code: "HP_TIDAK_VALID" });
  });

  it("requires WhatsApp consent when asked to, and only then", () => {
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "081234567890" }, true)).toEqual({ ok: false, code: "PERSETUJUAN_WAJIB" });
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "081234567890", setuju: false }, true)).toEqual({ ok: false, code: "PERSETUJUAN_WAJIB" });
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "081234567890" }, false).ok).toBe(true);
  });

  it("requires a name, caps its length, and tidies spaces", () => {
    expect(periksaIsianPelanggan({ nama: "   ", hp: "081234567890", setuju: true }, true)).toEqual({ ok: false, code: "NAMA_WAJIB" });
    expect(periksaIsianPelanggan({ nama: "a".repeat(101), hp: "081234567890", setuju: true }, true)).toEqual({ ok: false, code: "NAMA_TERLALU_PANJANG" });
    expect(rapikanNamaPelanggan("  Ibu   Rina  ")).toBe("Ibu Rina");
  });

  it("keeps a note, but not an over-long one", () => {
    const r = periksaIsianPelanggan({ nama: "Rina", hp: "081234567890", setuju: true, catatan: "  suka warna gelap " }, true);
    expect(r.ok && r.data.catatan).toBe("suka warna gelap");
    expect(periksaIsianPelanggan({ nama: "Rina", hp: "081234567890", setuju: true, catatan: "x".repeat(501) }, true)).toEqual({
      ok: false,
      code: "CATATAN_TERLALU_PANJANG",
    });
  });
});

describe("phone display", () => {
  it("shows the stored number in the local form", () => {
    expect(hpLokal("6281234567890")).toBe("081234567890");
    expect(hpLokal(null)).toBe("");
  });

  it("masks the number for the office: first four, last four", () => {
    expect(samarkanHp("6281234567890")).toBe("0812****7890");
    expect(samarkanHp("628123456789")).toBe("0812****6789");
    // Nothing of a too-short number is shown.
    expect(samarkanHp("62812")).toBe("****");
    expect(samarkanHp("6281234567890")).not.toContain("3456");
  });

  it("searches local and international spellings as the stored form", () => {
    expect(hpUntukCari("0812")).toBe("62812");
    expect(hpUntukCari("812")).toBe("62812");
    expect(hpUntukCari("62812")).toBe("62812");
    expect(hpUntukCari("Rina")).toBe("");
  });
});
