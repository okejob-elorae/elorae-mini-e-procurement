import { describe, expect, it } from "vitest";
import {
  bacaIdRusak,
  bacaKeputusanRusak,
  fotoRusakSah,
  jenisGerakLayakJual,
  masukBukuSaatTerima,
  periksaIsianRusak,
  rapikanTeksRusak,
  sisaKirimBalik,
} from "./rusak";

describe("periksaIsianRusak", () => {
  it("treats a missing or zero damaged count as no damage, dropping note and photo", () => {
    expect(periksaIsianRusak({ qtyReceived: 5 })).toEqual({ ok: true, qtyDamaged: 0, damageNote: null, damagePhotoUrl: null });
    expect(periksaIsianRusak({ qtyReceived: 5, qtyDamaged: 0, damageNote: "x", damagePhotoUrl: "https://luar/x.jpg" })).toEqual({
      ok: true,
      qtyDamaged: 0,
      damageNote: null,
      damagePhotoUrl: null,
    });
  });

  it("accepts damage up to the received count, with a tidied note and our own photo", () => {
    expect(periksaIsianRusak({ qtyReceived: 5, qtyDamaged: 5, damageNote: "  sobek   di jahitan ", damagePhotoUrl: "/api/foto/abc_1" })).toEqual({
      ok: true,
      qtyDamaged: 5,
      damageNote: "sobek di jahitan",
      damagePhotoUrl: "/api/foto/abc_1",
    });
  });

  it("refuses damage above what arrived, negative, or fractional", () => {
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: 4, damageNote: "x" })).toEqual({ ok: false, alasan: "RUSAK_TIDAK_VALID" });
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: -1, damageNote: "x" })).toEqual({ ok: false, alasan: "RUSAK_TIDAK_VALID" });
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: 1.5, damageNote: "x" })).toEqual({ ok: false, alasan: "RUSAK_TIDAK_VALID" });
  });

  it("requires a note whenever something is damaged", () => {
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: 1 })).toEqual({ ok: false, alasan: "KETERANGAN_RUSAK_WAJIB" });
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: 1, damageNote: "   " })).toEqual({ ok: false, alasan: "KETERANGAN_RUSAK_WAJIB" });
  });

  it("refuses a photo that is not one of our uploads", () => {
    expect(periksaIsianRusak({ qtyReceived: 3, qtyDamaged: 1, damageNote: "x", damagePhotoUrl: "https://contoh.com/a.jpg" })).toEqual({
      ok: false,
      alasan: "RUSAK_TIDAK_VALID",
    });
  });
});

describe("aturan kecil", () => {
  it("books only the good part on receipt", () => {
    expect(masukBukuSaatTerima(6, 2)).toBe(4);
    expect(masukBukuSaatTerima(2, 2)).toBe(0);
  });

  it("counts what is still to be sent back, never negative", () => {
    expect(sisaKirimBalik(3, 1)).toBe(2);
    expect(sisaKirimBalik(3, 5)).toBe(0);
  });

  it("books a sellable decision with the same kind as its receipt", () => {
    expect(jenisGerakLayakJual("PUTUS_DELIVERY")).toBe("TERIMA");
    expect(jenisGerakLayakJual("KONSI_SHIPMENT")).toBe("TERIMA");
    expect(jenisGerakLayakJual("MUTASI")).toBe("MUTASI_MASUK");
    expect(jenisGerakLayakJual("MUTASI_KEMBALI")).toBe("MUTASI_MASUK");
  });

  it("reads only known decisions", () => {
    expect(bacaKeputusanRusak("LAYAK_JUAL")).toBe("LAYAK_JUAL");
    expect(bacaKeputusanRusak("TERBUKA")).toBeNull();
    expect(bacaKeputusanRusak(1)).toBeNull();
  });

  it("tidies text and refuses empty or too long", () => {
    expect(rapikanTeksRusak(" a  b ")).toBe("a b");
    expect(rapikanTeksRusak("")).toBeNull();
    expect(rapikanTeksRusak("x".repeat(301))).toBeNull();
  });

  it("accepts only internal photo paths", () => {
    expect(fotoRusakSah("/api/foto/x1")).toBe(true);
    expect(fotoRusakSah("/api/foto/../x")).toBe(false);
    expect(fotoRusakSah("javascript:alert(1)")).toBe(false);
  });

  it("reads ids from the address, unique and safe", () => {
    expect(bacaIdRusak("a1, b2,a1,,../x")).toEqual(["a1", "b2"]);
    expect(bacaIdRusak(undefined)).toEqual([]);
    expect(bacaIdRusak(Array.from({ length: 60 }, (_, i) => `id${i}`).join(","))).toHaveLength(50);
  });
});
