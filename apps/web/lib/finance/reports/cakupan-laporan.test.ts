import { describe, expect, it } from "vitest";
import { BALANCE_SHEET_COVERAGE_BODY, CAKUPAN_LAPORAN_BODY, SUMBER_BELUM_BERJURNAL } from "./disclosures";

describe("cakupan data Neraca dan laporan lanjutan", () => {
  it("menyebut setiap sumber yang belum berjurnal, dari daftar yang sama dengan Laba Rugi", () => {
    for (const sumber of SUMBER_BELUM_BERJURNAL) {
      expect(BALANCE_SHEET_COVERAGE_BODY).toContain(sumber);
      expect(CAKUPAN_LAPORAN_BODY).toContain(sumber);
    }
  });

  it("tidak meninggalkan kalimat kosong", () => {
    expect(BALANCE_SHEET_COVERAGE_BODY).not.toContain("termasuk: .");
    expect(CAKUPAN_LAPORAN_BODY).not.toContain("termasuk: .");
  });
});
