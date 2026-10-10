import { describe, expect, it } from "vitest";
import { bacaTabProfilKol } from "./tab-profil";

describe("bacaTabProfilKol", () => {
  it("membaca tab yang dikenal, selain itu kembali ke Kolaborasi", () => {
    expect(bacaTabProfilKol("ukuran")).toBe("ukuran");
    expect(bacaTabProfilKol("brand")).toBe("brand");
    expect(bacaTabProfilKol(["catatan", "x"])).toBe("catatan");
    expect(bacaTabProfilKol("tidak-ada")).toBe("kolaborasi");
    expect(bacaTabProfilKol(undefined)).toBe("kolaborasi");
  });
});
