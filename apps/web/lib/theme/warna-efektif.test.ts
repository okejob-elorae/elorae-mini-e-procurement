import { describe, expect, it } from "vitest";
import { bacaWarnaPerusahaan, tentukanWarnaTema } from "./warna-efektif";
import { DEFAULT_THEME_PRIMARY_COLOR } from "./theme-presets";

const LIMAU = { hex: "#c0db3a", tcx: "13-0443", name: "Love Bird" };
const NORD = { hex: "#5e81ac", tcx: null, name: null };
const BAWAAN = { hex: DEFAULT_THEME_PRIMARY_COLOR, tcx: null, name: null };

describe("tentukanWarnaTema", () => {
  it("uses the person's own colour when they picked one", () => {
    expect(tentukanWarnaTema(LIMAU, { hex: "#b04a5a" })).toMatchObject({ sumber: "pribadi", hex: "#c0db3a" });
  });

  it("keeps a picked colour that has no Pantone code", () => {
    expect(tentukanWarnaTema(NORD, null)).toMatchObject({ sumber: "pribadi", hex: "#5e81ac" });
  });

  it("falls back to the company colour when the person never picked one", () => {
    expect(tentukanWarnaTema(BAWAAN, { hex: "#B04A5A", tcx: "18-1631" })).toEqual({
      sumber: "perusahaan",
      hex: "#b04a5a",
      tcx: "18-1631",
      name: null,
    });
  });

  it("falls back to the built-in default when neither exists", () => {
    expect(tentukanWarnaTema(BAWAAN, null)).toMatchObject({ sumber: "bawaan", hex: DEFAULT_THEME_PRIMARY_COLOR });
  });
});

describe("bacaWarnaPerusahaan", () => {
  it("reads a stored company colour", () => {
    expect(bacaWarnaPerusahaan('{"hex":"#b04a5a","tcx":"18-1631","name":"Earth Red"}')).toEqual({
      hex: "#b04a5a",
      tcx: "18-1631",
      name: "Earth Red",
    });
  });

  it("treats a missing, malformed or colourless value as no company colour", () => {
    expect(bacaWarnaPerusahaan(null)).toBeNull();
    expect(bacaWarnaPerusahaan("bukan json")).toBeNull();
    expect(bacaWarnaPerusahaan('{"hex":"merah"}')).toBeNull();
    expect(bacaWarnaPerusahaan('{"tcx":"18-1631"}')).toBeNull();
  });
});
