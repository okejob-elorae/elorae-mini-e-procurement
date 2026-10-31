import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePaletteFromSeed } from "@/lib/theme/generate-palette-from-seed";

/*
 * Token `--tautan`: warna teks/tautan bernada tema yang tetap terbaca di tema
 * TERANG. Sebelumnya teks `text-primary` memakai warna tema apa adanya — limau
 * #c0db3a di atas krem #f9fcde hanya 1,49:1 (minimal WCAG 4,5:1).
 *
 * Tes ini membaca globals.css yang sungguhan, mengambil angka rumusnya, lalu
 * menghitung kontrasnya untuk ratusan warna tema terhadap latar yang dibangkitkan
 * `generatePaletteFromSeed` — fungsi yang sama yang dipakai aplikasi.
 */

const css = readFileSync(path.resolve(__dirname, "globals.css"), "utf8");

// --- konversi warna (sRGB ↔ OKLab), cukup untuk menghitung kontras ---
type Rgb = [number, number, number];
const keLinier = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const dariHex = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => keLinier(parseInt(h.slice(i, i + 2), 16) / 255)) as Rgb;
};
const keOklab = ([r, g, b]: Rgb): Rgb => {
  const akar = (x: number) => Math.cbrt(x);
  const l = akar(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = akar(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = akar(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};
const dariOklab = ([L, a, b]: Rgb): Rgb => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const jepit = (x: number) => Math.min(1, Math.max(0, x));
  // Diklip ke gamut sRGB — kasus terburuk untuk kecerahan.
  return [
    jepit(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    jepit(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    jepit(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};
const luminans = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const kontras = (a: Rgb, b: Rgb) => {
  const [t, r] = [luminans(a), luminans(b)].sort((x, y) => y - x);
  return (t + 0.05) / (r + 0.05);
};

// --- rumus yang dibaca dari globals.css ---
const rumusRelatif = css.match(/--tautan:\s*oklch\(from var\(--primary\) min\(l,\s*([\d.]+)\) c h\)/);
const rumusCadangan = css.match(/--tautan:\s*color-mix\(in oklab, var\(--primary\) (\d+)%, black\)/);
const BATAS_L = rumusRelatif ? Number(rumusRelatif[1]) : NaN;
const PERSEN_CADANGAN = rumusCadangan ? Number(rumusCadangan[1]) / 100 : NaN;

/** `oklch(from primer min(l, BATAS_L) c h)` — kroma dan rona dipertahankan. */
function tautanRelatif(primerHex: string): Rgb {
  const [L, a, b] = keOklab(dariHex(primerHex));
  return dariOklab([Math.min(L, BATAS_L), a, b]);
}
/** `color-mix(in oklab, primer P%, black)` — hitam di oklab adalah (0, 0, 0). */
function tautanCadangan(primerHex: string): Rgb {
  const [L, a, b] = keOklab(dariHex(primerHex));
  return dariOklab([L * PERSEN_CADANGAN, a * PERSEN_CADANGAN, b * PERSEN_CADANGAN]);
}

function hsvKeHex(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${[f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("")}`;
}

const WARNA_TEMA: string[] = ["#c0db3a", "#334155", "#ffff00", "#00ff00", "#26ffed", "#ffffb2"];
for (let h = 0; h < 360; h += 5) {
  for (const s of [0.3, 0.6, 0.85, 1]) {
    for (const v of [0.5, 0.7, 0.85, 1]) WARNA_TEMA.push(hsvKeHex(h, s, v));
  }
}

describe("token --tautan di globals.css", () => {
  it("didefinisikan dengan rumus relatif dan cadangan color-mix", () => {
    expect(BATAS_L).toBeGreaterThan(0);
    expect(PERSEN_CADANGAN).toBeGreaterThan(0);
    expect(css).toMatch(/@supports \(color: oklch\(from red l c h\)\)/);
  });

  it("tidak mengubah tema gelap: --tautan sama dengan --primary", () => {
    expect(css).toMatch(/:root\.dark\s*\{\s*--tautan:\s*var\(--primary\);\s*\}/);
  });

  it("tersedia sebagai warna Tailwind (text-tautan)", () => {
    expect(css).toMatch(/--color-tautan:\s*var\(--tautan\);/);
  });

  it("memetakan teks text-primary ke token di tema terang, kecuali keping primary-foreground", () => {
    const aturan = css.match(
      /:where\(:root:not\(\.dark\)\) \.text-primary:not\(:where\(\.bg-primary-foreground, \.bg-primary-foreground \*\)\)\s*\{\s*color:\s*var\(--tautan\);\s*\}/,
    );
    expect(aturan).not.toBeNull();
    // Hanya warna teks — latar tombol (bg-primary) tidak disentuh.
    expect(css).not.toMatch(/\.bg-primary[^-][^{]*\{[^}]*var\(--tautan\)/);
  });
});

describe("kontras --tautan di tema terang", () => {
  it("kasus audit: limau #c0db3a di atas krem #f9fcde naik dari 1,49:1 ke ≥ 6,7:1", () => {
    const krem = dariHex("#f9fcde");
    expect(kontras(dariHex("#c0db3a"), krem)).toBeCloseTo(1.49, 2);
    expect(kontras(tautanRelatif("#c0db3a"), krem)).toBeGreaterThanOrEqual(6.7);
    expect(kontras(tautanCadangan("#c0db3a"), krem)).toBeGreaterThanOrEqual(7.8);
  });

  it(`≥ 4,5:1 untuk ${WARNA_TEMA.length} warna tema, di atas latar, kartu, dan permukaan muted terang`, () => {
    expect(Number.isFinite(BATAS_L) && Number.isFinite(PERSEN_CADANGAN)).toBe(true);
    let terburuk = { nilai: Infinity, warna: "" };
    for (const warna of WARNA_TEMA) {
      const { light } = generatePaletteFromSeed(warna);
      for (const latar of [light.background, light.card, light.muted, light.accent, light.secondary]) {
        for (const teks of [tautanRelatif(warna), tautanCadangan(warna)]) {
          const k = kontras(teks, dariHex(latar));
          if (!(k >= terburuk.nilai)) terburuk = { nilai: k, warna };
        }
      }
    }
    expect(terburuk.nilai).toBeGreaterThanOrEqual(4.5);
  });

  it("tema bawaan tanpa warna Pantone (#334155 di atas putih/slate) tetap sama gelapnya", () => {
    // L oklch #334155 ≈ 0,37 < batas, jadi rumus relatif tidak mengubahnya.
    expect(kontras(tautanRelatif("#334155"), dariHex("#ffffff"))).toBeCloseTo(kontras(dariHex("#334155"), dariHex("#ffffff")), 5);
    expect(kontras(tautanRelatif("#334155"), dariHex("#f1f5f9"))).toBeGreaterThanOrEqual(9);
  });
});
