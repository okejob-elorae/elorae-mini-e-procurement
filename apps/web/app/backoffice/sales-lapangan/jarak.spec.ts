import { describe, expect, it } from "vitest";
import { jarakTeks, paramTandaTampil } from "./jarak";

describe("jarak check-in di kantor", () => {
  it("meter di bawah 1 km, km di atasnya, dengan pemisah ribuan", () => {
    expect(jarakTeks(85, "id")).toBe("85 m");
    expect(jarakTeks(999.6, "id")).toBe("1.000 m");
    expect(jarakTeks(1_250, "id")).toBe("1,3 km");
    expect(jarakTeks(574_173, "id")).toBe("574 km");
    expect(jarakTeks(1_574_173, "id")).toBe("1.574 km");
    expect(jarakTeks(1_250, "en")).toBe("1.3 km");
    expect(jarakTeks(Number.NaN, "id")).toBe("—");
  });

  it("tanda luar radius membawa satuan; angka lain diberi pemisah ribuan", () => {
    expect(paramTandaTampil("LUAR_RADIUS", { jarak: 574_173 }, "id")).toEqual({ jarak: "574 km" });
    expect(paramTandaTampil("AKURASI_BURUK", { akurasi: 1_200, batas: 100 }, "id")).toEqual({ akurasi: "1.200", batas: "100" });
    expect(paramTandaTampil("KOORDINAT_KEMBAR", { toko: "Toko A" }, "id")).toEqual({ toko: "Toko A" });
    expect(paramTandaTampil("AKURASI_TIDAK_ADA", undefined, "id")).toEqual({});
  });
});
