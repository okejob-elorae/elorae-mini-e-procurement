import { describe, expect, it } from "vitest";
import { FORMAT_BARCODE, formatBawaan, jalurWasmZxing, type KelasDetektor } from "./detektor";

function kelas(didukung: string[] | (() => Promise<string[]>) | null): KelasDetektor {
  const K = class {
    async detect() {
      return [];
    }
  } as unknown as KelasDetektor;
  if (didukung !== null) {
    K.getSupportedFormats = typeof didukung === "function" ? didukung : async () => didukung;
  }
  return K;
}

describe("formatBawaan", () => {
  it("tanpa pembaca bawaan (Safari, Firefox) → kosong, jadi cadangan dipakai", async () => {
    expect(await formatBawaan(null)).toEqual([]);
  });

  it("hanya format kita yang didukung bawaan yang dipakai", async () => {
    expect(await formatBawaan(kelas(["qr_code", "ean_13", "aztec"]))).toEqual(["ean_13", "qr_code"]);
  });

  it("bawaan tanpa satu pun format kita (Android tanpa layanan Google) → kosong", async () => {
    expect(await formatBawaan(kelas([]))).toEqual([]);
    expect(await formatBawaan(kelas(["aztec", "pdf417"]))).toEqual([]);
  });

  it("bawaan yang gagal ditanya → kosong, bukan galat", async () => {
    expect(
      await formatBawaan(
        kelas(async () => {
          throw new Error("NotSupportedError");
        }),
      ),
    ).toEqual([]);
  });

  it("bawaan tanpa getSupportedFormats dianggap mendukung semua", async () => {
    expect(await formatBawaan(kelas(null))).toEqual([...FORMAT_BARCODE]);
  });
});

describe("jalurWasmZxing", () => {
  it("disajikan dari server sendiri, per versi", () => {
    expect(jalurWasmZxing("3.1.3")).toBe("/vendor/zxing-wasm-3.1.3/zxing_reader.wasm");
  });
});
