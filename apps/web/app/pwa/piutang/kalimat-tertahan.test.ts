import { describe, expect, it } from "vitest";
import { susunKalimatTertahan } from "./kalimat-tertahan";

/* Penerjemah tiruan: kunci + nilainya, supaya urutan dan bahan tiap bagian terbaca. */
const t = (kunci: string, nilai?: Record<string, string | number>) =>
  nilai ? `${kunci}(${Object.entries(nilai).map(([k, v]) => `${k}=${v}`).join(",")})` : kunci;
const rupiah = (n: number) => `Rp${n}`;

describe("susunKalimatTertahan", () => {
  it("names what waits for the warehouse count", () => {
    expect(susunKalimatTertahan({ nilaiTertahan: 300, ditahanRetur: 300, sebabDitahan: "BELUM_DIHITUNG" }, t, rupiah)).toBe(
      "why_tertahan_hitung(value=Rp300)",
    );
  });

  it("names what waits for the shortfall decision with the old sentence", () => {
    expect(susunKalimatTertahan({ nilaiTertahan: 300, ditahanRetur: 300, sebabDitahan: "MENUNGGU_BEBAN" }, t, rupiah)).toBe(
      "why_tertahan(value=Rp300)",
    );
  });

  it("a permanent part beside the waiting one is owed: named, and collected through the next BKM", () => {
    expect(susunKalimatTertahan({ nilaiTertahan: 500, ditahanRetur: 300, sebabDitahan: "CAMPURAN" }, t, rupiah)).toBe(
      "why_tertahan_campur(value=Rp300) why_tertahan_tetap(value=Rp200) why_tertahan_tagihBkm",
    );
  });

  it("the free part past its due date is to be collected (Q15)", () => {
    expect(
      susunKalimatTertahan(
        { nilaiTertahan: 300, ditahanRetur: 300, sebabDitahan: "BELUM_DIHITUNG", lewatTempoDiLuarTahanan: { hari: 4, nilai: 400 } },
        t,
        rupiah,
      ),
    ).toBe("why_tertahan_hitung(value=Rp300) why_tertahan_lewatTempo(value=Rp400,days=4)");
  });

  it("with nothing waiting, an overdue remainder reads as wholly past due", () => {
    expect(susunKalimatTertahan({ nilaiTertahan: 200, lewatTempoDiLuarTahanan: { hari: 9, nilai: 700 } }, t, rupiah)).toBe(
      "why_tertahan_tetap(value=Rp200) why_tertahan_lewatTempoSemua(value=Rp700,days=9)",
    );
  });

  it("a permanent hold alone is owed and collected through the next BKM", () => {
    expect(susunKalimatTertahan({ nilaiTertahan: 150 }, t, rupiah)).toBe("why_tertahan_tetap(value=Rp150) why_tertahan_tagihBkm");
  });

  it("a held row with no detail at all keeps the general sentence", () => {
    expect(susunKalimatTertahan({}, t, rupiah)).toBe("why_tertahan(value=Rp0)");
  });
});
