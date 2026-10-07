import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generatePaletteFromSeed } from "@/lib/theme/generate-palette-from-seed";

/*
 * Warna sorot baris (`--sorot-baru` di globals.css) di puncaknya, di tema
 * terang dan gelap, untuk tema bawaan dan warna merek pilihan pengguna:
 *  - teks redup (muted-foreground) tetap terbaca ≥ 3:1 dan teks biasa ≥ 4,5:1;
 *  - sorotnya sendiri terlihat terhadap kartu (≥ 1,3:1) — campuran dengan
 *    --primary saja dulu nyaris tak terlihat pada merek seterang kartunya.
 * Angkanya dibaca dari globals.css, jadi mengubah CSS tanpa mengukur ulang
 * akan menggagalkan tes ini.
 */

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");

// --- konversi warna (sRGB ↔ OKLab), sama dengan app/kontras-tautan.spec.ts ---
type Rgb = [number, number, number];
const keLinier = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const dariHex = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => keLinier(parseInt(h.slice(i, i + 2), 16) / 255)) as Rgb;
};
const keOklab = ([r, g, b]: Rgb): Rgb => {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
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
  return [
    jepit(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    jepit(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    jepit(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
};
const dariOklch = (L: number, C: number, hDerajat: number): Rgb => {
  const h = (hDerajat * Math.PI) / 180;
  return dariOklab([L, C * Math.cos(h), C * Math.sin(h)]);
};
const luminans = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const kontras = (a: Rgb, b: Rgb) => {
  const [t, r] = [luminans(a), luminans(b)].sort((x, y) => y - x);
  return (t + 0.05) / (r + 0.05);
};
/** Warna CSS yang dipakai di sini: `#rrggbb` atau `oklch(L C h)`. */
const warna = (teks: string): Rgb => {
  const t = teks.trim();
  if (t.startsWith("#")) return dariHex(t);
  const m = t.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) throw new Error(`warna tak dikenal: ${t}`);
  return dariOklch(Number(m[1]), Number(m[2]), Number(m[3]));
};

// --- rumus yang dibaca dari globals.css ---
const relatif = [...css.matchAll(/--sorot-baru:\s*oklch\(from var\(--primary\) ([\d.]+) min\(c,\s*([\d.]+)\) h\)/g)];
const cadangan = [...css.matchAll(/--sorot-baru:\s*color-mix\(in oklab, var\(--primary\) (\d+)%, var\(--card\)\)/g)];

/** `oklch(from primer L min(c, cMaks) h)`: kecerahan tetap, rona merek. */
function sorotRelatif(primer: Rgb, L: number, cMaks: number): Rgb {
  const [, a, b] = keOklab(primer);
  const C = Math.min(Math.hypot(a, b), cMaks);
  const h = Math.atan2(b, a);
  return dariOklab([L, C * Math.cos(h), C * Math.sin(h)]);
}
/** `color-mix(in oklab, primer P%, kartu)`. */
function sorotCampur(primer: Rgb, kartu: Rgb, persen: number): Rgb {
  const p = keOklab(primer);
  const k = keOklab(kartu);
  const t = persen / 100;
  return dariOklab(k.map((v, i) => v * (1 - t) + p[i] * t) as Rgb);
}

/** Token tema bawaan dari blok `:root { … --card … }` dan `.dark { … --card … }` pertama. */
function tokenBawaan(pemilih: ":root" | ".dark") {
  const pola = pemilih === ":root" ? /(?:^|\n):root\s*\{([^}]*--card:[^}]*)\}/ : /(?:^|\n)\.dark\s*\{([^}]*--card:[^}]*)\}/;
  const isi = css.match(pola)?.[1] ?? "";
  const ambil = (nama: string) => {
    const m = isi.match(new RegExp(`--${nama}:\\s*([^;]+);`));
    if (!m) throw new Error(`--${nama} tidak ada di ${pemilih}`);
    return warna(m[1]);
  };
  return { kartu: ambil("card"), primer: ambil("primary"), teks: ambil("foreground"), redup: ambil("muted-foreground") };
}

/** Warna merek contoh: 12 rona × gelap/sedang/terang, ditambah abu, hitam, limau, dan batu tulis. */
function benihMerek(): string[] {
  const hsl = (h: number, s: number, l: number) => {
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return "#" + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, "0")).join("");
  };
  const hasil = ["#c0db3a", "#334155", "#111111", "#e5e7eb", "#64748b", "#facc15"];
  for (let h = 0; h < 360; h += 30) for (const l of [0.2, 0.5, 0.85]) hasil.push(hsl(h, 0.8, l));
  return hasil;
}

describe("rumus sorot terbaca dari globals.css", () => {
  it("ada versi terang dan gelap, untuk peramban baru (warna relatif) dan lama (color-mix)", () => {
    expect(relatif).toHaveLength(2);
    expect(cadangan).toHaveLength(2);
  });
});

describe("sorot di peramban dengan warna relatif (kecerahan tetap, rona merek)", () => {
  const [terang, gelap] = relatif.map((m) => ({ L: Number(m[1]), cMaks: Number(m[2]) }));

  it("tema bawaan: teks redup ≥ 3:1, teks ≥ 4,5:1, sorot terlihat ≥ 1,3:1 — terang dan gelap", () => {
    for (const [t, rumus] of [
      [tokenBawaan(":root"), terang],
      [tokenBawaan(".dark"), gelap],
    ] as const) {
      const sorot = sorotRelatif(t.primer, rumus.L, rumus.cMaks);
      expect(kontras(t.redup, sorot)).toBeGreaterThanOrEqual(3);
      expect(kontras(t.teks, sorot)).toBeGreaterThanOrEqual(4.5);
      expect(kontras(sorot, t.kartu)).toBeGreaterThanOrEqual(1.3);
    }
  });

  it.each(benihMerek())("warna merek %s: sama, di tema terang dan gelap", (benih) => {
    const palet = generatePaletteFromSeed(benih);
    const primer = dariHex(benih);
    for (const [mode, rumus] of [
      [palet.light, terang],
      [palet.dark, gelap],
    ] as const) {
      const sorot = sorotRelatif(primer, rumus.L, rumus.cMaks);
      expect(kontras(dariHex(mode.mutedForeground), sorot)).toBeGreaterThanOrEqual(3);
      expect(kontras(dariHex(mode.foreground), sorot)).toBeGreaterThanOrEqual(4.5);
      expect(kontras(sorot, dariHex(mode.card))).toBeGreaterThanOrEqual(1.3);
    }
  });
});

describe("sorot di peramban lama (color-mix dengan --primary)", () => {
  it("tema bawaan: teks redup tetap ≥ 3:1 di terang dan gelap", () => {
    const [terang, gelap] = cadangan.map((m) => Number(m[1]));
    for (const [t, persen] of [
      [tokenBawaan(":root"), terang],
      [tokenBawaan(".dark"), gelap],
    ] as const) {
      const sorot = sorotCampur(t.primer, t.kartu, persen);
      expect(kontras(t.redup, sorot)).toBeGreaterThanOrEqual(3);
      expect(kontras(t.teks, sorot)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
