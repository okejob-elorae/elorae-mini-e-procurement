import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLabelBarcodeHtml, formatHargaLabel, type BarisCetakLabel } from "@/lib/print/label-barcode-html";
import { LABEL_MENCETAK_HARGA, opsiCetakLabel } from "./aturan-label";

const baris: BarisCetakLabel[] = [
  {
    kode: "0127000038PS",
    nama: "Kaos Polo Navy",
    varian: "S · Navy",
    sku: "27000038P-NVY-S",
    artikel: "27000038P",
    ukuran: "S",
    harga: 189000,
    jumlah: 1,
  },
];

describe("opsiCetakLabel — label barang tidak mencetak harga (keputusan pemilik)", () => {
  it("konstanta keputusan bernilai false", () => {
    expect(LABEL_MENCETAK_HARGA).toBe(false);
  });

  it("gaya RINCI dengan tampilHarga tersimpan true tetap tanpa harga", () => {
    const opsi = opsiCetakLabel({ gaya: "RINCI", ukuran: "50x30", tataLetak: "A4", tampilHarga: true, tampilNama: true });
    expect(opsi.tampilHarga).toBe(false);
    const html = buildLabelBarcodeHtml(baris, opsi);
    expect(html).toContain("Kaos Polo Navy");
    expect(html).not.toContain(formatHargaLabel(189000));
    expect(html).not.toContain('class="harga"');
  });

  it("gaya ELORAE juga tanpa harga", () => {
    const html = buildLabelBarcodeHtml(
      baris,
      opsiCetakLabel({ gaya: "ELORAE", ukuran: "50x30", tataLetak: "GULUNGAN", tampilHarga: true, tampilNama: false }),
    );
    expect(html).not.toContain(formatHargaLabel(189000));
  });

  it("opsi lain diteruskan apa adanya", () => {
    expect(
      opsiCetakLabel({ gaya: "RINCI", ukuran: "50x30", tataLetak: "A4", tampilHarga: true, tampilNama: false, lewati: 3 }),
    ).toEqual({ gaya: "RINCI", ukuran: "50x30", tataLetak: "A4", tampilHarga: false, tampilNama: false, lewati: 3 });
  });
});

describe("layar cetak label memakai opsiCetakLabel", () => {
  const layar = readFileSync(path.join(__dirname, "LabelBarcodeClient.tsx"), "utf8");

  it("setiap pembuatan HTML label lewat opsi yang sudah disaring", () => {
    const panggilan = layar.match(/buildLabelBarcodeHtml\([^;]*;/g) ?? [];
    expect(panggilan.length).toBeGreaterThan(0);
    for (const p of panggilan) expect(p).toContain("...opsiCetak");
    expect(layar).toContain("opsiCetakLabel(");
  });

  it("tidak ada sakelar harga di layar", () => {
    expect(layar).not.toContain('id="label-harga"');
    expect(layar).not.toContain("ubahOpsi({ tampilHarga");
  });
});
