import { describe, expect, it } from "vitest";
import { angkaStok, jenisBawaan, kunciGalatHapusBarang, labelJenisBarang } from "./tampilan-barang";

const LABEL = { FABRIC: "Kain", ACCESSORIES: "Aksesoris", FINISHED_GOOD: "Barang jadi" } as const;
const bawaan = (code: keyof typeof LABEL) => LABEL[code];

describe("labelJenisBarang", () => {
  it("uses the translated sentence-case label for the three built-in types, never the master name", () => {
    expect(labelJenisBarang({ code: "FABRIC", nameId: "Kain / Fabric", nameEn: "Fabric" }, "id", bawaan)).toBe("Kain");
    expect(labelJenisBarang({ code: "FINISHED_GOOD", nameId: "Barang Jadi", nameEn: "Finished Good" }, "id", bawaan)).toBe(
      "Barang jadi",
    );
    expect(labelJenisBarang({ code: "ACCESSORIES", nameId: "Aksesoris", nameEn: "Accessories" }, "en", bawaan)).toBe(
      "Aksesoris",
    );
  });

  it("uses the master name in the current language for any other type, falling back to the other language", () => {
    const m = { code: "PACKAGING", nameId: "Kemasan", nameEn: "Packaging" };
    expect(labelJenisBarang(m, "id", bawaan)).toBe("Kemasan");
    expect(labelJenisBarang(m, "en", bawaan)).toBe("Packaging");
    expect(labelJenisBarang({ code: "X", nameId: "Lain", nameEn: "" }, "en", bawaan)).toBe("Lain");
  });

  it("recognises only the three built-in codes", () => {
    expect(jenisBawaan("FABRIC")).toBe(true);
    expect(jenisBawaan("fabric")).toBe(false);
    expect(jenisBawaan("PACKAGING")).toBe(false);
  });
});

describe("angkaStok", () => {
  it("formats in Indonesian style with at most two decimals", () => {
    expect(angkaStok(2000)).toBe("2.000");
    expect(angkaStok(12.5)).toBe("12,5");
    expect(angkaStok("507.00")).toBe("507");
    expect(angkaStok(1234.5678)).toBe("1.234,57");
    expect(angkaStok(-3)).toBe("-3");
  });

  it("shows 0 for missing or invalid values", () => {
    expect(angkaStok(null)).toBe("0");
    expect(angkaStok(undefined)).toBe("0");
    expect(angkaStok("abc")).toBe("0");
  });
});

describe("kunciGalatHapusBarang", () => {
  it("maps the in-use refusal to its own message and everything else to the generic one", () => {
    expect(kunciGalatHapusBarang("cannotDeleteItemInUse")).toBe("errInUse");
    expect(kunciGalatHapusBarang("failedToDeleteItem")).toBe("errDelete");
    expect(kunciGalatHapusBarang("")).toBe("errDelete");
  });
});
