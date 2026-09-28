import { describe, expect, it } from "vitest";
import { getMasukInitScript, UMUR_MASUK_MS, uraiMasuk } from "./masuk";

const T = 1_800_000_000_000;

describe("uraiMasuk", () => {
  it("reads a fresh handoff", () => {
    const mentah = JSON.stringify({ t: T, warna: "#c0db3a" });
    expect(uraiMasuk(mentah, T + 500)).toEqual({ warna: "#c0db3a" });
  });

  it("treats a stale or future-dated handoff as absent", () => {
    const mentah = JSON.stringify({ t: T, warna: "#c0db3a" });
    expect(uraiMasuk(mentah, T + UMUR_MASUK_MS + 1)).toBeNull();
    expect(uraiMasuk(mentah, T - 1)).toBeNull();
  });

  it("rejects junk instead of throwing", () => {
    expect(uraiMasuk(null, T)).toBeNull();
    expect(uraiMasuk("{", T)).toBeNull();
    expect(uraiMasuk("42", T)).toBeNull();
    expect(uraiMasuk(JSON.stringify({ warna: "#fff" }), T)).toBeNull();
  });

  it("keeps a theme colour in any CSS colour form", () => {
    for (const warna of ["#C8F04A", "oklch(0.87 0.19 125)", "rgb(192 219 58 / 100%)", "teal"]) {
      expect(uraiMasuk(JSON.stringify({ t: T, warna }), T)?.warna).toBe(warna);
    }
  });

  it("drops a colour that could close the declaration", () => {
    for (const warna of ["red;background:url(x)", "red}", "'red'", ""]) {
      expect(uraiMasuk(JSON.stringify({ t: T, warna }), T)?.warna).toBeNull();
    }
  });
});

describe("getMasukInitScript", () => {
  it("is a single self-contained statement", () => {
    const s = getMasukInitScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain("elorae.masuk");
  });
});
