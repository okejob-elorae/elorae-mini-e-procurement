import { describe, expect, it } from "vitest";
import { getMasukInitScript, namaDepan, UMUR_MASUK_MS, uraiMasuk } from "./masuk";

const T = 1_800_000_000_000;

describe("uraiMasuk", () => {
  it("reads a fresh handoff", () => {
    const mentah = JSON.stringify({ t: T, nama: "Timotius" });
    expect(uraiMasuk(mentah, T + 500)).toEqual({ nama: "Timotius" });
  });

  it("treats a stale or future-dated handoff as absent", () => {
    const mentah = JSON.stringify({ t: T, nama: "A" });
    expect(uraiMasuk(mentah, T + UMUR_MASUK_MS + 1)).toBeNull();
    expect(uraiMasuk(mentah, T - 1)).toBeNull();
  });

  it("rejects junk instead of throwing", () => {
    expect(uraiMasuk(null, T)).toBeNull();
    expect(uraiMasuk("{", T)).toBeNull();
    expect(uraiMasuk("42", T)).toBeNull();
    expect(uraiMasuk(JSON.stringify({ nama: "A" }), T)).toBeNull();
  });

  it("treats a blank or non-string name as no name", () => {
    expect(uraiMasuk(JSON.stringify({ t: T, nama: " " }), T)).toEqual({ nama: null });
    expect(uraiMasuk(JSON.stringify({ t: T, nama: 7 }), T)).toEqual({ nama: null });
  });
});

describe("namaDepan", () => {
  it("keeps the first word", () => {
    expect(namaDepan("  Timotius Maxmillian Widodo ")).toBe("Timotius");
    expect(namaDepan("")).toBeNull();
    expect(namaDepan(null)).toBeNull();
  });
});

describe("getMasukInitScript", () => {
  it("is a single self-contained statement", () => {
    const s = getMasukInitScript();
    expect(() => new Function(s)).not.toThrow();
    expect(s).toContain("elorae.masuk");
  });
});
