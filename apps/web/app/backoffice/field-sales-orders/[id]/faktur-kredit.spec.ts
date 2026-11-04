import { describe, expect, it } from "vitest";
import { keadaanFakturKredit, selisihHariWib } from "./faktur-kredit";

// Hari ini 6 Okt 2026, 09.00 WIB.
const hariIni = new Date("2026-10-06T09:00:00+07:00");
const wib = (s: string) => new Date(`${s}T00:00:00+07:00`);

describe("keadaanFakturKredit", () => {
  it("jatuh tempo 17 Jul tanpa janji bayar: lewat jatuh tempo 81 hari (bukan 'belum lewat')", () => {
    expect(keadaanFakturKredit({ jatuhTempo: wib("2026-07-17"), janjiBayar: null, lewatJanji: false, hariIni })).toEqual({
      jenis: "LEWAT_TEMPO",
      hari: 81,
    });
  });

  it("janji bayar 8 Sep lewat: dihitung dari janjinya (28 hari), jatuh tempo 13 Sep tetap tampil di kolomnya", () => {
    expect(keadaanFakturKredit({ jatuhTempo: wib("2026-09-13"), janjiBayar: wib("2026-09-08"), lewatJanji: true, hariIni })).toEqual({
      jenis: "LEWAT_JANJI",
      hari: 28,
    });
  });

  it("janji bayar ada tapi belum lewat, jatuh tempo sudah lewat: lewat jatuh tempo", () => {
    expect(keadaanFakturKredit({ jatuhTempo: wib("2026-09-13"), janjiBayar: wib("2026-10-20"), lewatJanji: false, hariIni })).toEqual({
      jenis: "LEWAT_TEMPO",
      hari: 23,
    });
  });

  it("jatuh tempo hari ini atau nanti: belum jatuh tempo", () => {
    expect(keadaanFakturKredit({ jatuhTempo: wib("2026-10-06"), janjiBayar: null, lewatJanji: false, hariIni }).jenis).toBe("BELUM_TEMPO");
    expect(keadaanFakturKredit({ jatuhTempo: wib("2026-10-30"), janjiBayar: null, lewatJanji: false, hariIni }).jenis).toBe("BELUM_TEMPO");
  });

  it("selisih per hari kalender WIB: 23.30 WIB ke 00.30 WIB esoknya = 1 hari", () => {
    expect(selisihHariWib(new Date("2026-10-05T23:30:00+07:00"), new Date("2026-10-06T00:30:00+07:00"))).toBe(1);
  });
});
