import { describe, expect, it } from "vitest";
import { buildPaletWarnaPrintHtml, type LabelPaletWarna } from "./palet-warna-html";
import type { LembarPalet } from "@/lib/production-colors/palet/lembar";

const LABELS: LabelPaletWarna = {
  title: "Palet Warna",
  untitled: "Palet tanpa nama",
  date: "Tanggal",
  rule: "Aturan harmoni",
  ruleName: "Triad",
  createdBy: "Dibuat oleh",
  fabric: "Kain",
  inks: "Warna sablon",
  swatches: "Lima warna",
  base: "Dasar",
  codes: "Kode warna",
  colColor: "Warna",
  colShare: "Porsi",
  colReadability: "Terbaca",
  role: (peran) => ({ DOMINAN: "Dominan", PENDUKUNG: "Pendukung", AKSEN: "Aksen" })[peran],
  readability: (k) => ({ KUAT: "Kuat", CUKUP: "Cukup", LEMBUT: "Lembut", SAMAR: "Samar" })[k],
  recipes: (berat, maks) => `Resep campur per ${berat} g, maks ${maks} tinta`,
  noRecipe: "Belum ada tinta dasar.",
  estimate: "perkiraan",
  notes: ["CMYK tanpa profil cetak.", "Cocokkan dengan buku Pantone fisik."],
  printedFrom: "Dicetak dari Elorae ERP",
  mockup: "Pratinjau kaos",
};

const angka = (n: number) => n.toFixed(1).replace(".", ",");

const berkain: LembarPalet = {
  nama: "Feed <Agustus>",
  aturan: "TRIAD",
  kain: { hex: "#90A8A4", nama: "PANTONE 16-5106 TCX Blue Surf" },
  berat: 1000,
  maksTinta: 3,
  baris: [
    {
      label: "A", dasar: false, hex: "#00323D", rgb: [0, 50, 61], cmyk: [100, 18, 0, 76],
      pantoneC: { kode: "547 C", deltaE: 0 }, pantoneTcx: { kode: "19-4914", nama: "Deep Teal", deltaE: 3.21 },
      porsi: 60, peran: "DOMINAN", kontras: 5.4, keterbacaan: "KUAT",
      resep: { bagian: [{ nama: "Process Blue", persen: 62.5, gram: 625 }, { nama: "Black 6", persen: 37.5, gram: 375 }], deltaE: 1.84 },
    },
    {
      label: "B", dasar: false, hex: "#FF5303", rgb: [255, 83, 3], cmyk: [0, 67, 99, 0],
      pantoneC: { kode: "Orange 021 C", deltaE: 0 }, pantoneTcx: null,
      porsi: 40, peran: "PENDUKUNG", kontras: 1.2, keterbacaan: "SAMAR", resep: null,
    },
  ],
};

describe("buildPaletWarnaPrintHtml", () => {
  const html = buildPaletWarnaPrintHtml({ lembar: berkain, tanggal: "2026-09-17T10:00:00+07:00", dibuatOleh: "Timotius", kaosSvg: "<svg id=\"kaos\"></svg>", labels: LABELS, angka });

  it("memuat nama, kain, dan semua kode tiap tinta", () => {
    expect(html).toContain("Feed &lt;Agustus&gt;");
    expect(html).not.toContain("Feed <Agustus>");
    expect(html).toContain("PANTONE 16-5106 TCX Blue Surf");
    for (const kode of ["#00323D", "0 · 50 · 61", "100 · 18 · 0 · 76", "547 C", "19-4914 Deep Teal", "Orange 021 C", "60%", "40%"]) {
      expect(html).toContain(kode);
    }
    expect(html).toContain("ΔE 3,2");
    expect(html).toContain("Dominan");
    expect(html).toContain("Samar");
    expect(html).toContain("Timotius");
  });

  it("menyisipkan gambar kaos dan resep beserta gramnya", () => {
    expect(html).toContain('<svg id="kaos"></svg>');
    expect(html).toContain("Resep campur per 1000 g, maks 3 tinta");
    expect(html).toContain("Process Blue");
    expect(html).toContain("62,5% · 625 g");
    expect(html).toContain("ΔE 1,8");
    // Tinta tanpa resep tetap punya barisnya.
    expect(html).toContain("Belum ada tinta dasar.");
  });

  it("warna dicetak apa adanya, bukan dihemat tinta oleh browser", () => {
    expect(html).toContain("print-color-adjust: exact");
  });

  it("palet bebas tanpa nama: tanpa kain, porsi, maupun resep", () => {
    const bebas: LembarPalet = {
      ...berkain,
      nama: "",
      kain: null,
      berat: null,
      baris: berkain.baris.map((b, i) => ({ ...b, label: String(i + 1), dasar: i === 1, porsi: null, peran: null, kontras: null, keterbacaan: null, resep: null })),
    };
    const h = buildPaletWarnaPrintHtml({ lembar: bebas, tanggal: null, dibuatOleh: null, kaosSvg: null, labels: LABELS, angka });
    expect(h).toContain("Palet tanpa nama");
    expect(h).toContain("Lima warna");
    expect(h).not.toContain("Resep campur");
    expect(h).not.toContain(LABELS.colShare);
    expect(h).not.toContain(LABELS.fabric);
    expect(h).toContain("Dasar");
  });
});
