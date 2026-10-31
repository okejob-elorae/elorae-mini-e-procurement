import { describe, expect, it } from "vitest";
import { ambilTampilanTersimpan, bacaTampilan, ingatTampilan, kunciSimpanTampilan, JENIS_TAMPILAN } from "./tampilan";

function penyimpananPalsu() {
  const isi = new Map<string, string>();
  return { getItem: (k: string) => isi.get(k) ?? null, setItem: (k: string, v: string) => void isi.set(k, v) };
}

describe("tampilan daftar", () => {
  it("reads only views the page allows, else the default", () => {
    expect(bacaTampilan("galeri", JENIS_TAMPILAN, "tabel")).toBe("galeri");
    expect(bacaTampilan("papan", ["tabel", "galeri"], "tabel")).toBe("tabel");
    expect(bacaTampilan("kanban", JENIS_TAMPILAN, "tabel")).toBe("tabel");
    expect(bacaTampilan(undefined, JENIS_TAMPILAN, "galeri")).toBe("galeri");
  });

  it("remembers per person and page", () => {
    const p = penyimpananPalsu();
    ingatTampilan(p, kunciSimpanTampilan("pemasok", "u1"), "papan");
    expect(ambilTampilanTersimpan(p, kunciSimpanTampilan("pemasok", "u1"), JENIS_TAMPILAN)).toBe("papan");
    expect(ambilTampilanTersimpan(p, kunciSimpanTampilan("pemasok", "u2"), JENIS_TAMPILAN)).toBeNull();
    expect(ambilTampilanTersimpan(p, kunciSimpanTampilan("kol", "u1"), JENIS_TAMPILAN)).toBeNull();
  });

  it("a blocked or broken storage never throws", () => {
    const rusak = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(ambilTampilanTersimpan(rusak, "k", JENIS_TAMPILAN)).toBeNull();
    expect(() => ingatTampilan(rusak, "k", "tabel")).not.toThrow();
    expect(ambilTampilanTersimpan(null, "k", JENIS_TAMPILAN)).toBeNull();
  });

  it("a stored value the page no longer allows is ignored", () => {
    const p = penyimpananPalsu();
    p.setItem("k", "papan");
    expect(ambilTampilanTersimpan(p, "k", ["tabel", "galeri"])).toBeNull();
  });
});
