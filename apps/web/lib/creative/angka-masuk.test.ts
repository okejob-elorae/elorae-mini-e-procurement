import { describe, expect, it } from "vitest";
import { bacaAngka, bacaBilanganBulat } from "./angka-masuk";

describe("bacaAngka — parser pemaaf untuk angka yang diketik orang", () => {
  it("akhiran ribu, juta, miliar", () => {
    expect(bacaAngka("52k")).toBe(52_000);
    expect(bacaAngka("52K")).toBe(52_000);
    expect(bacaAngka("1,5rb")).toBe(1_500);
    expect(bacaAngka("12 ribu")).toBe(12_000);
    expect(bacaAngka("1,2jt")).toBe(1_200_000);
    expect(bacaAngka("1.2 juta")).toBe(1_200_000);
    expect(bacaAngka("1.2M")).toBe(1_200_000);
    expect(bacaAngka("2 miliar")).toBe(2_000_000_000);
  });

  it("rupiah dan titik ribuan gaya Indonesia", () => {
    expect(bacaAngka("Rp 1.250.000")).toBe(1_250_000);
    expect(bacaAngka("Rp1.250.000,50")).toBe(1_250_000.5);
    expect(bacaAngka("IDR 88.000")).toBe(88_000);
    expect(bacaAngka("88.000")).toBe(88_000);
  });

  it("koma ribuan gaya Inggris", () => {
    expect(bacaAngka("1,250,000")).toBe(1_250_000);
    expect(bacaAngka("1,250.75")).toBe(1_250.75);
  });

  it("desimal satu-dua digit", () => {
    expect(bacaAngka("4,8")).toBe(4.8);
    expect(bacaAngka("4.8")).toBe(4.8);
    expect(bacaAngka("4,8%")).toBe(4.8);
    expect(bacaAngka("12,50")).toBe(12.5);
  });

  it("angka biasa dan angka asli dilewatkan", () => {
    expect(bacaAngka("1500")).toBe(1500);
    expect(bacaAngka(42)).toBe(42);
    expect(bacaAngka("-2.000")).toBe(-2000);
  });

  it("yang bukan angka = null", () => {
    expect(bacaAngka("")).toBeNull();
    expect(bacaAngka("abc")).toBeNull();
    expect(bacaAngka(null)).toBeNull();
    expect(bacaAngka(Number.NaN)).toBeNull();
    expect(bacaAngka("1.2.3,4,5")).toBeNull();
  });

  it("bilangan bulat tidak negatif untuk views/pengikut/order", () => {
    expect(bacaBilanganBulat("52,4k")).toBe(52_400);
    expect(bacaBilanganBulat("1,25")).toBe(1);
    expect(bacaBilanganBulat("-5")).toBeNull();
    expect(bacaBilanganBulat("x")).toBeNull();
  });
});
