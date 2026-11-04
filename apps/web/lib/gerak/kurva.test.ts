import { describe, expect, it } from "vitest";
import {
  KURVA_LEMBAR,
  KURVA_PEGAS,
  LANGKAH_BERURUTAN_MS,
  MAKS_BARIS_BERURUTAN,
  jedaBaris,
  kurvaCss,
  puncakLonjakan,
} from "./kurva";

describe("kurva pegas lembut", () => {
  it("ditulis sebagai cubic-bezier CSS", () => {
    expect(kurvaCss(KURVA_PEGAS)).toBe("cubic-bezier(0.22, 1.2, 0.36, 1)");
  });

  it("melonjak sedikit (pegas), tapi tidak sampai 2 % — lembut, bukan memantul", () => {
    const puncak = puncakLonjakan(KURVA_PEGAS);
    expect(puncak).toBeGreaterThan(1);
    expect(puncak).toBeLessThan(1.02);
  });

  it("kurva tanpa lonjakan berpuncak tepat 1", () => {
    expect(puncakLonjakan({ x1: 0.22, y1: 1, x2: 0.36, y2: 1 })).toBeCloseTo(1, 6);
  });
});

describe("kurva lembar (panel samping & lembar bawah)", () => {
  it("TIDAK melonjak: lembar setinggi 85vh yang melonjak 1 % membuka celah ±8 px di tepi layar", () => {
    expect(puncakLonjakan(KURVA_LEMBAR)).toBeCloseTo(1, 6);
  });

  it("tetap terasa pegas: sebagian besar jarak ditempuh di awal", () => {
    expect(kurvaCss(KURVA_LEMBAR)).toBe("cubic-bezier(0.32, 0.72, 0, 1)");
  });
});

describe("jedaBaris (baris muncul berurutan)", () => {
  it("baris pertama tanpa jeda, berikutnya bertambah satu langkah", () => {
    expect(jedaBaris(1)).toBe(0);
    expect(jedaBaris(2)).toBe(LANGKAH_BERURUTAN_MS);
    expect(jedaBaris(3)).toBe(2 * LANGKAH_BERURUTAN_MS);
  });

  it("berhenti bertambah setelah baris ke-12 — daftar panjang tidak terasa lambat", () => {
    expect(MAKS_BARIS_BERURUTAN).toBe(12);
    const jedaTerakhir = jedaBaris(MAKS_BARIS_BERURUTAN);
    expect(jedaBaris(13)).toBe(jedaTerakhir);
    expect(jedaBaris(500)).toBe(jedaTerakhir);
    expect(jedaTerakhir).toBeLessThanOrEqual(300);
  });

  it("urutan tidak sah dianggap baris pertama", () => {
    expect(jedaBaris(0)).toBe(0);
    expect(jedaBaris(-3)).toBe(0);
    expect(jedaBaris(Number.NaN)).toBe(0);
  });
});
