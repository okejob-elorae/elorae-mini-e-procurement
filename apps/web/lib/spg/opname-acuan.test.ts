import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BATAS_UMUR_HITUNG_MS,
  dilewatiKarenaLebihBaru,
  kurangiReturBelumDiRak,
  saldoAcuan,
  tanpaAngkaSistem,
  umurHitungMs,
  waktuHitungPerKunci,
} from "./opname-acuan";

const MENIT = 60_000;
const dasar = new Date("2026-10-05T10:00:00Z");

describe("umurHitungMs", () => {
  it("is the age of the count on the phone, never negative when the clock goes back", () => {
    expect(umurHitungMs(dasar.getTime() - 30 * MENIT, dasar.getTime())).toBe(30 * MENIT);
    expect(umurHitungMs(dasar.getTime() + 5 * MENIT, dasar.getTime())).toBe(0);
    expect(umurHitungMs(undefined, dasar.getTime())).toBeUndefined();
  });
});

describe("waktuHitungPerKunci", () => {
  it("takes the server's clock minus the age, the latest count for a doubled line, and caps the age", () => {
    const w = waktuHitungPerKunci(
      [
        { itemId: "a", variantSku: null, umurHitungMs: 30 * MENIT },
        { itemId: "a", variantSku: "", umurHitungMs: 10 * MENIT },
        { itemId: "b", variantSku: "b-M", umurHitungMs: 99 * 86_400_000 },
        { itemId: "c", variantSku: null },
      ],
      dasar,
    );
    expect(w.get("a::")).toEqual(new Date(dasar.getTime() - 10 * MENIT));
    expect(w.get("b::b-M")).toEqual(new Date(dasar.getTime() - BATAS_UMUR_HITUNG_MS));
    // Tanpa umur: aturan lama.
    expect(w.has("c::")).toBe(false);
  });
});

describe("saldoAcuan", () => {
  it("removes only movements recorded after that line was counted: 10 in the books, 2 sold after the count → 10", () => {
    const tc = new Date(dasar.getTime() - 30 * MENIT);
    const hasil = saldoAcuan(
      new Map([
        ["a::", 8],
        ["b::", 4],
      ]),
      [
        { itemId: "a", variantSku: "", qty: -2, createdAt: new Date(dasar.getTime() - 10 * MENIT) },
        { itemId: "a", variantSku: "", qty: 5, createdAt: new Date(dasar.getTime() - 40 * MENIT) },
        { itemId: "b", variantSku: "", qty: -1, createdAt: new Date(dasar.getTime() - 5 * MENIT) },
      ],
      new Map([["a::", tc]]),
    );
    expect(hasil.get("a::")).toBe(10);
    // `b` tanpa waktu hitung: saldo dasar apa adanya.
    expect(hasil.get("b::")).toBe(4);
  });
});

describe("kurangiReturBelumDiRak", () => {
  const tc = new Date(dasar.getTime() - 30 * MENIT);
  const laporan = new Date(dasar.getTime() - 60 * MENIT);

  it("a report filed before the count and approved after it: its pieces were set aside, not on the shelf (P12)", () => {
    const hasil = kurangiReturBelumDiRak(
      new Map([["a::", 7]]),
      [{ itemId: "a", variantSku: "", qty: 2, createdAt: laporan, diRakSejak: new Date(dasar.getTime() - 10 * MENIT) }],
      new Map([["a::", tc]]),
      dasar,
    );
    expect(hasil.get("a::")).toBe(5);
  });

  it("a report approved before the count: its pieces were back on the shelf, nothing changes", () => {
    const hasil = kurangiReturBelumDiRak(
      new Map([["a::", 7]]),
      [{ itemId: "a", variantSku: "", qty: 2, createdAt: laporan, diRakSejak: new Date(dasar.getTime() - 40 * MENIT) }],
      new Map([["a::", tc]]),
      dasar,
    );
    expect(hasil.get("a::")).toBe(7);
  });

  it("a movement dated after the count is left to saldoAcuan, never subtracted twice", () => {
    const hasil = kurangiReturBelumDiRak(
      new Map([["a::", 7]]),
      [{ itemId: "a", variantSku: "", qty: 2, createdAt: new Date(dasar.getTime() - 20 * MENIT), diRakSejak: new Date(dasar.getTime() - 10 * MENIT) }],
      new Map([["a::", tc]]),
      dasar,
    );
    expect(hasil.get("a::")).toBe(7);
  });

  it("a line with no count age is judged at `dasar`", () => {
    const hasil = kurangiReturBelumDiRak(
      new Map([["b::M", 3]]),
      [{ itemId: "b", variantSku: "M", qty: 1, createdAt: laporan, diRakSejak: new Date(dasar.getTime() + MENIT) }],
      new Map(),
      dasar,
    );
    expect(hasil.get("b::M")).toBe(2);
  });

  it("does not touch the map it was given", () => {
    const saldo = new Map([["a::", 7]]);
    kurangiReturBelumDiRak(
      saldo,
      [{ itemId: "a", variantSku: null, qty: 2, createdAt: laporan, diRakSejak: dasar }],
      new Map([["a::", tc]]),
      dasar,
    );
    expect(saldo.get("a::")).toBe(7);
  });
});

describe("dilewatiKarenaLebihBaru", () => {
  it("skips a line only when another opname counted the same goods later", () => {
    const t = new Date(dasar.getTime() - 30 * MENIT);
    const lewat = dilewatiKarenaLebihBaru(
      new Map([
        ["a::", t],
        ["b::", t],
      ]),
      new Map([
        ["a::", new Date(t.getTime() + 1)],
        ["b::", t],
      ]),
    );
    expect([...lewat]).toEqual(["a::"]);
  });
});

describe("hitungan buta", () => {
  it("strips the system figure from the counting screen's payload", () => {
    const baris = tanpaAngkaSistem([{ kunci: "a::", nama: "Kemeja", stok: 7, dilacak: true }]);
    expect(baris).toEqual([{ kunci: "a::", nama: "Kemeja", dilacak: true }]);
    expect(JSON.stringify(baris)).not.toContain("stok");
  });

  it("the store and warehouse counting screens never render a system figure", () => {
    const akar = path.resolve(__dirname, "../..");
    const baca = (p: string) => readFileSync(path.join(akar, p), "utf8");
    const opnameToko = baca("app/pwa/spg/opname/OpnameClient.tsx") + baca("app/pwa/spg/opname/PilihVarian.tsx");
    // `.stok` di luar string (properti saldo); "pwaLuring.stok" adalah nama kamus teks.
    expect(opnameToko).not.toMatch(/\.stok\b(?!["'])/);
    expect(opnameToko).not.toMatch(/t\("(system|systemLabel|diffOver|diffUnder|filterDiff|match)"/);
    expect(opnameToko).not.toContain("confirm.diff");
    const halamanToko = baca("app/pwa/spg/opname/page.tsx");
    expect(halamanToko).toContain("tanpaAngkaSistem(");
    const hitungGudang = baca("app/backoffice/inventory/stock-opname/[id]/count/StockOpnameCountPageClient.tsx");
    expect(hitungGudang).not.toMatch(/snapshot/i);
  });
});
