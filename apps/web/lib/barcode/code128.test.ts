import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BarcodeDetector, prepareZXingModule, ZXING_WASM_VERSION } from "barcode-detector/ponyfill";
import {
  checksumCode128,
  CODE128_KE_B,
  CODE128_KE_C,
  CODE128_START_B,
  CODE128_START_C,
  CODE128_STOP,
  GalatCode128,
  jumlahModulCode128,
  MAKS_PANJANG_CODE128,
  periksaCode128,
  POLA_CODE128,
  sandikanCode128,
  svgCode128,
  ZONA_TENANG_MODUL,
} from "./code128";
import { jalurWasmZxing } from "./detektor";

const jumlah = (s: string) => s.split("").reduce((a, c) => a + Number(c), 0);
const batang = (s: string) => s.split("").reduce((a, c, i) => (i % 2 === 0 ? a + Number(c) : a), 0);

describe("tabel pola Code 128", () => {
  it("107 simbol, masing-masing 11 modul (stop 13), unik, dan jumlah batangnya genap", () => {
    expect(POLA_CODE128).toHaveLength(107);
    for (let v = 0; v < 106; v++) {
      expect(POLA_CODE128[v], `nilai ${v}`).toMatch(/^[1-4]{6}$/);
      expect(jumlah(POLA_CODE128[v]), `nilai ${v}`).toBe(11);
      // Sifat paritas Code 128: modul batang setiap simbol berjumlah genap.
      expect(batang(POLA_CODE128[v]) % 2, `nilai ${v}`).toBe(0);
    }
    expect(POLA_CODE128[CODE128_STOP]).toBe("2331112");
    expect(jumlah(POLA_CODE128[CODE128_STOP])).toBe(13);
    expect(new Set(POLA_CODE128).size).toBe(107);
  });
});

describe("sandikanCode128 — checksum dihitung tangan", () => {
  it("ABC-123 di set B: 104 + 1·33 + 2·34 + 3·35 + 4·13 + 5·17 + 6·18 + 7·19 = 688 → 688 mod 103 = 70", () => {
    const h = sandikanCode128("ABC-123");
    expect(h.simbol).toEqual([CODE128_START_B, 33, 34, 35, 13, 17, 18, 19, 70, CODE128_STOP]);
    expect(h.checksum).toBe(70);
    expect(checksumCode128([104, 33, 34, 35, 13, 17, 18, 19])).toBe(70);
    // 9 simbol × 11 modul + stop 13.
    expect(h.modul).toBe(112);
    expect(h.lebar.reduce((a, b) => a + b, 0)).toBe(112);
    expect(h.lebar).toHaveLength(9 * 6 + 7);
  });

  it("1234 mulai di set C: 105 + 1·12 + 2·34 = 185 → 82", () => {
    expect(sandikanCode128("1234").simbol).toEqual([CODE128_START_C, 12, 34, 82, CODE128_STOP]);
  });

  it("tepat dua angka mulai di set C: 105 + 12 = 117 → 14; tiga angka tetap set B", () => {
    expect(sandikanCode128("12").simbol).toEqual([CODE128_START_C, 12, 14, CODE128_STOP]);
    // 104 + 1·17 + 2·18 + 3·19 = 214 → 8
    expect(sandikanCode128("123").simbol).toEqual([CODE128_START_B, 17, 18, 19, 8, CODE128_STOP]);
  });

  it("empat angka di AKHIR pindah ke set C: AB1234 → 720 mod 103 = 102", () => {
    expect(sandikanCode128("AB1234").simbol).toEqual([CODE128_START_B, 33, 34, CODE128_KE_C, 12, 34, 102, CODE128_STOP]);
    // Tiga angka di akhir tidak cukup untuk pindah.
    expect(sandikanCode128("AB123").simbol.slice(0, 6)).toEqual([CODE128_START_B, 33, 34, 17, 18, 19]);
  });

  it("awalan angka ganjil di set C: 12345A → kembali ke set B untuk 5 dan A, checksum 734 mod 103 = 13", () => {
    expect(sandikanCode128("12345A").simbol).toEqual([CODE128_START_C, 12, 34, CODE128_KE_B, 21, 33, 13, CODE128_STOP]);
  });

  it("deret ganjil ≥ 6 di tengah: angka pertamanya di set B, sisanya berpasangan → checksum 99", () => {
    // 104 + 1·33 + 2·17 + 3·99 + 4·23 + 5·45 + 6·67 + 7·100 + 8·34 = 2159 → 99
    expect(sandikanCode128("A1234567B").simbol).toEqual([
      CODE128_START_B,
      33,
      17,
      CODE128_KE_C,
      23,
      45,
      67,
      CODE128_KE_B,
      34,
      99,
      CODE128_STOP,
    ]);
    // Empat angka di tengah tidak dipadatkan.
    expect(sandikanCode128("A1234B").simbol).not.toContain(CODE128_KE_C);
  });

  it("huruf kecil disandikan apa adanya (set B): ab → 104 + 65 + 2·66 = 301 → 95", () => {
    expect(sandikanCode128("ab").simbol).toEqual([CODE128_START_B, 65, 66, 95, CODE128_STOP]);
  });
});

describe("kode yang ditolak", () => {
  it.each([
    ["", "KOSONG"],
    ["Kaos é", "KARAKTER_TIDAK_DIDUKUNG"],
    ["日本", "KARAKTER_TIDAK_DIDUKUNG"],
    ["ABC\n", "KARAKTER_TIDAK_DIDUKUNG"],
    ["A\tB", "KARAKTER_TIDAK_DIDUKUNG"],
    ["DEL\u007f", "KARAKTER_TIDAK_DIDUKUNG"],
    ["👕", "KARAKTER_TIDAK_DIDUKUNG"],
    ["X".repeat(MAKS_PANJANG_CODE128 + 1), "TERLALU_PANJANG"],
  ])("%j → %s", (teks, alasan) => {
    expect(periksaCode128(teks)).toBe(alasan);
    expect(jumlahModulCode128(teks)).toBeNull();
    let galat: unknown = null;
    try {
      sandikanCode128(teks);
    } catch (e) {
      galat = e;
    }
    expect(galat).toBeInstanceOf(GalatCode128);
    expect((galat as GalatCode128).alasan).toBe(alasan);
    expect(() => svgCode128(teks)).toThrow(GalatCode128);
  });

  it("menyebut posisi karakter pertama yang ditolak", () => {
    try {
      sandikanCode128("AB-é-X");
      expect.unreachable();
    } catch (e) {
      expect((e as GalatCode128).posisi).toBe(3);
    }
  });

  it("seluruh ASCII yang bisa dicetak diterima", () => {
    let semua = "";
    for (let c = 32; c <= 126; c++) semua += String.fromCharCode(c);
    expect(periksaCode128(semua.slice(0, 80))).toBeNull();
    expect(periksaCode128(semua.slice(80))).toBeNull();
  });
});

describe("svgCode128", () => {
  it("lebar viewBox = modul + zona tenang dua sisi; satu path, satu persegi per batang", () => {
    const h = sandikanCode128("ABC-123");
    const svg = svgCode128("ABC-123");
    expect(svg).toContain(`viewBox="0 0 ${h.modul + 2 * ZONA_TENANG_MODUL} 10"`);
    expect(svg).toContain('preserveAspectRatio="none"');
    expect((svg.match(/<path /g) ?? []).length).toBe(1);
    expect((svg.match(/M/g) ?? []).length).toBe(Math.ceil(h.lebar.length / 2));
    // Batang pertama dimulai tepat sesudah zona tenang.
    expect(svg).toContain(`d="M${ZONA_TENANG_MODUL} 0h2v10h-2z`);
    expect(jumlahModulCode128("ABC-123")).toBe(h.modul + 2 * ZONA_TENANG_MODUL);
    expect(jumlahModulCode128("ABC-123", 0)).toBe(h.modul);
  });

  it("teks kode di atribut di-escape", () => {
    const svg = svgCode128('A"<B>&', { kelas: 'x" onload="y' });
    expect(svg).toContain('aria-label="A&quot;&lt;B&gt;&amp;"');
    expect(svg).toContain('class="x&quot; onload=&quot;y"');
    expect(svg).not.toContain("<B>");
  });
});

/*
 * Pembuktian paling kuat: batang yang kita buat dibaca oleh PEMBACA YANG SAMA
 * dengan HP SPG tanpa pembaca bawaan (ZXing, WASM yang disajikan dari
 * `public/vendor`). ZXing memeriksa checksum, jadi tabel atau checksum yang
 * salah membuat kodenya tidak terbaca sama sekali, bukan terbaca keliru.
 */
describe("dibaca ZXing (pembaca cadangan di HP)", () => {
  const asli = { ImageData: (globalThis as Record<string, unknown>).ImageData, DOMRectReadOnly: (globalThis as Record<string, unknown>).DOMRectReadOnly };

  class GambarUji {
    colorSpace = "srgb";
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
    get [Symbol.toStringTag]() {
      return "ImageData";
    }
  }

  function gambar(teks: string, px = 3, tinggi = 40): GambarUji {
    const { lebar, modul } = sandikanCode128(teks);
    const w = (modul + 2 * ZONA_TENANG_MODUL) * px;
    const data = new Uint8ClampedArray(w * tinggi * 4).fill(255);
    let x = ZONA_TENANG_MODUL * px;
    lebar.forEach((l, i) => {
      if (i % 2 === 0) {
        for (let y = 0; y < tinggi; y++) {
          for (let xx = x; xx < x + l * px; xx++) {
            const o = (y * w + xx) * 4;
            data[o] = 0;
            data[o + 1] = 0;
            data[o + 2] = 0;
          }
        }
      }
      x += l * px;
    });
    return new GambarUji(data, w, tinggi);
  }

  let pembaca: InstanceType<typeof BarcodeDetector>;

  beforeAll(async () => {
    const g = globalThis as Record<string, unknown>;
    g.ImageData = GambarUji;
    g.DOMRectReadOnly = class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 0,
        public height = 0,
      ) {}
    };
    const wasm = readFileSync(path.join(process.cwd(), "public", jalurWasmZxing(ZXING_WASM_VERSION)));
    await prepareZXingModule({
      overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) },
      fireImmediately: true,
    });
    pembaca = new BarcodeDetector({ formats: ["code_128"] });
  });

  afterAll(() => {
    const g = globalThis as Record<string, unknown>;
    g.ImageData = asli.ImageData;
    g.DOMRectReadOnly = asli.DOMRectReadOnly;
  });

  const baca = async (teks: string) => (await pembaca.detect(gambar(teks) as unknown as ImageData)).map((r) => [r.format, r.rawValue]);

  it("kode khas label kita (barcode templat, SKU varian, SKU barang) terbaca persis", async () => {
    for (const kode of ["TS000123HTMXL", "FG-JEANS-001-30", "fg-jeans-001-30", "KMJ-0042 XL", "ABC-123", "A1234567B", "12345A", "AB1234"]) {
      expect(await baca(kode), kode).toEqual([["code_128", kode]]);
    }
  });

  it("deret angka sepanjang 1–14 (set C, ganjil dan genap) terbaca persis", async () => {
    const digit = "31415926535897";
    for (let n = 1; n <= digit.length; n++) {
      const kode = digit.slice(0, n);
      expect(await baca(kode), kode).toEqual([["code_128", kode]]);
      expect(await baca(`X${kode}`), `X${kode}`).toEqual([["code_128", `X${kode}`]]);
      expect(await baca(`X${kode}Y`), `X${kode}Y`).toEqual([["code_128", `X${kode}Y`]]);
    }
  });

  it("setiap karakter ASCII yang bisa dicetak terbaca persis", async () => {
    for (let c = 32; c <= 126; c += 8) {
      let kode = "";
      for (let k = c; k < Math.min(c + 8, 127); k++) kode += String.fromCharCode(k);
      // Dibungkus supaya spasi (32) tidak berada di tepi kode.
      const dibungkus = `[${kode}]`;
      expect(await baca(dibungkus), dibungkus).toEqual([["code_128", dibungkus]]);
    }
  });
});
