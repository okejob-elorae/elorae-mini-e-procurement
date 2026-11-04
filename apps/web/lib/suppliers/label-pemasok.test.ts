import { describe, expect, it } from "vitest";
import { labelPemasok, urutPemasok } from "./label-pemasok";

describe("label pemasok di formulir", () => {
  it("nama lalu kode dalam kurung", () => {
    expect(labelPemasok({ code: "SUP0001", name: "PT Kain Indah" })).toBe("PT Kain Indah (SUP0001)");
    expect(labelPemasok({ code: "", name: "Tanpa Kode" })).toBe("Tanpa Kode");
    expect(labelPemasok({ code: "SUP9", name: " " })).toBe("SUP9");
  });

  it("diurut menurut nama, abai huruf besar-kecil", () => {
    const urut = urutPemasok([
      { code: "SUP0005", name: "CV Lainnya" },
      { code: "SUP0004", name: "aksesoris Jaya" },
      { code: "SUP0001", name: "PT Kain Indah" },
    ]);
    expect(urut.map((p) => p.code)).toEqual(["SUP0004", "SUP0005", "SUP0001"]);
  });
});
