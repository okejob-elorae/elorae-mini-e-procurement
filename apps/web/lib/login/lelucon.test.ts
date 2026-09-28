import { describe, expect, it } from "vitest";
import { CERITA_MASUK_MS, durasiCerita, LELUCON, leluconHariIni, waktuBacaMs } from "./lelucon";

describe("leluconHariIni", () => {
  it("stays the same for the whole WIB calendar day", () => {
    // 00:01 WIB and 23:59 WIB on 28 Sep 2026.
    const pagi = leluconHariIni(new Date("2026-09-27T17:01:00Z"));
    const malam = leluconHariIni(new Date("2026-09-28T16:59:00Z"));
    expect(malam).toBe(pagi);
  });

  it("changes at WIB midnight, not UTC midnight", () => {
    const sebelum = leluconHariIni(new Date("2026-09-28T16:59:00Z")); // 23:59 WIB
    const sesudah = leluconHariIni(new Date("2026-09-28T17:01:00Z")); // 00:01 WIB
    expect(sesudah).not.toBe(sebelum);
    // UTC midnight falls at 07:00 WIB — same WIB day, same joke.
    expect(leluconHariIni(new Date("2026-09-28T23:59:00Z"))).toBe(sesudah);
    expect(leluconHariIni(new Date("2026-09-29T00:01:00Z"))).toBe(sesudah);
  });

  it("does not repeat until the whole list has been shown", () => {
    const hari0 = Date.UTC(2026, 0, 1, 5);
    const terlihat = new Set(
      Array.from({ length: LELUCON.length }, (_, i) => leluconHariIni(new Date(hari0 + i * 86_400_000))),
    );
    expect(terlihat.size).toBe(LELUCON.length);
  });

  it("holds a hundred jokes, none of them repeated", () => {
    expect(LELUCON).toHaveLength(100);
    for (const bahasa of ["id", "en"] as const) {
      expect(new Set(LELUCON.map((l) => l[bahasa].pembuka)).size).toBe(100);
      expect(new Set(LELUCON.map((l) => l[bahasa].punchline)).size).toBe(100);
    }
  });

  it("every joke is complete in both languages", () => {
    for (const l of LELUCON) {
      for (const bahasa of [l.id, l.en]) {
        expect(bahasa.pembuka.trim().length).toBeGreaterThan(0);
        expect(bahasa.punchline.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

describe("waktuBacaMs", () => {
  it("gives short lines a floor and long lines a ceiling", () => {
    expect(waktuBacaMs("Hidup ini singkat.")).toBe(2200);
    expect(waktuBacaMs("x".repeat(500))).toBe(6500);
  });

  it("grows with the length of the text in between", () => {
    const pendek = waktuBacaMs("x".repeat(40));
    const panjang = waktuBacaMs("x".repeat(80));
    expect(panjang).toBeGreaterThan(pendek);
  });
});

describe("durasiCerita", () => {
  it("waits for the opener to come into focus before the reading time starts", () => {
    const [pembuka] = durasiCerita({ pembuka: "Hidup ini singkat.", punchline: "x" });
    expect(pembuka).toBe(CERITA_MASUK_MS + waktuBacaMs("Hidup ini singkat."));
  });

  it("gives the punchline more than its bare reading time", () => {
    const [, punchline] = durasiCerita({ pembuka: "x", punchline: "Senin hanya hari Minggu yang gagal bertahan hidup." });
    expect(punchline).toBeGreaterThan(waktuBacaMs("Senin hanya hari Minggu yang gagal bertahan hidup."));
  });
});
