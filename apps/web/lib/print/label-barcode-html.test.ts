import { describe, expect, it } from "vitest";
import { sandikanCode128, svgCode128, ZONA_TENANG_MODUL } from "@/lib/barcode/code128";
import {
  buildLabelBarcodeHtml,
  formatHargaLabel,
  MEREK_LABEL,
  JARAK_LABEL_MM,
  lebarModulMm,
  tataLembarA4,
  totalLabel,
  UKURAN_LABEL,
  type BarisCetakLabel,
  type OpsiCetakLabel,
  type UkuranLabel,
} from "./label-barcode-html";

const opsi = (o: Partial<OpsiCetakLabel> = {}): OpsiCetakLabel => ({
  gaya: "RINCI",
  ukuran: "50x30",
  tataLetak: "A4",
  tampilHarga: true,
  tampilNama: true,
  ...o,
});

const baris = (o: Partial<BarisCetakLabel> = {}): BarisCetakLabel => ({
  kode: "TS000123HTMXL",
  nama: "Kaos Oversize Hitam",
  varian: "XL · Hitam",
  sku: "TS-0123-HTM-XL",
  artikel: "TS-0123",
  ukuran: "XL",
  harga: 129000,
  jumlah: 1,
  ...o,
});

const hitung = (html: string, pola: RegExp) => (html.match(pola) ?? []).length;
const labelTerisi = (html: string) => hitung(html, /<div class="label">/g);

describe("tataLembarA4", () => {
  it.each([
    ["50x30", 3, 8, 28, 21.5],
    ["40x30", 4, 8, 22, 21.5],
    ["33x15", 5, 16, 18.5, 13.5],
  ] as [UkuranLabel, number, number, number, number][])("%s → %i kolom × %i baris, ditengahkan", (u, kolom, brs, kiri, atas) => {
    const t = tataLembarA4(u);
    expect(t).toEqual({ kolom, baris: brs, perHalaman: kolom * brs, kiriMm: kiri, atasMm: atas });
    const { lebarMm, tinggiMm } = UKURAN_LABEL[u];
    // Kisinya pas di A4 dan tepinya tidak kurang dari 8 mm.
    expect(2 * t.kiriMm + kolom * lebarMm + (kolom - 1) * JARAK_LABEL_MM).toBeCloseTo(210);
    expect(2 * t.atasMm + brs * tinggiMm + (brs - 1) * JARAK_LABEL_MM).toBeCloseTo(297);
    expect(t.kiriMm).toBeGreaterThanOrEqual(8);
    expect(t.atasMm).toBeGreaterThanOrEqual(8);
  });
});

describe("buildLabelBarcodeHtml — A4", () => {
  it("mencetak setiap baris sebanyak jumlahnya, 24 label per lembar 50×30", () => {
    const html = buildLabelBarcodeHtml([baris({ jumlah: 20 }), baris({ kode: "FG-JEANS-001-30", sku: null, jumlah: 10 })], opsi());
    expect(labelTerisi(html)).toBe(30);
    expect(hitung(html, /<section class="lembar">/g)).toBe(2);
    expect(html).toContain("@page { size: A4; margin: 0; }");
    expect(html).toContain("grid-template-columns: repeat(3, 50mm)");
    expect(html).toContain("<title>Label barcode — 30 label</title>");
  });

  it("jumlah 0, negatif, atau bukan angka tidak dicetak; pecahan dibulatkan ke bawah", () => {
    const html = buildLabelBarcodeHtml(
      [baris({ jumlah: 0 }), baris({ jumlah: -3 }), baris({ jumlah: Number.NaN }), baris({ jumlah: 2.9 })],
      opsi(),
    );
    expect(labelTerisi(html)).toBe(2);
    expect(totalLabel([{ jumlah: 0 }, { jumlah: -3 }, { jumlah: Number.NaN }, { jumlah: 2.9 }, { jumlah: 5 }])).toBe(7);
  });

  it("lewati mengosongkan kotak di awal lembar pertama, paling banyak satu lembar kurang satu", () => {
    const html = buildLabelBarcodeHtml([baris({ jumlah: 2 })], opsi({ lewati: 5 }));
    expect(hitung(html, /<div class="label kosong"><\/div>/g)).toBe(5);
    expect(labelTerisi(html)).toBe(2);
    // Kotak kosong ada SEBELUM label pertama.
    expect(html.indexOf("label kosong")).toBeLessThan(html.indexOf('<div class="label">'));

    const penuh = buildLabelBarcodeHtml([baris({ jumlah: 1 })], opsi({ lewati: 999 }));
    expect(hitung(penuh, /label kosong"><\/div>/g)).toBe(23);
    expect(hitung(penuh, /<section class="lembar">/g)).toBe(1);
  });

  it("tanpa label → dokumen tetap utuh dengan pesan", () => {
    const html = buildLabelBarcodeHtml([], opsi());
    expect(html).toContain("Belum ada label untuk dicetak.");
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
  });
});

describe("buildLabelBarcodeHtml — gulungan", () => {
  it("satu label per halaman, @page seukuran label", () => {
    const html = buildLabelBarcodeHtml([baris({ jumlah: 3 })], opsi({ tataLetak: "GULUNGAN", ukuran: "40x30", lewati: 4 }));
    expect(html).toContain("@page { size: 40mm 30mm; margin: 0; }");
    expect(hitung(html, /<section class="gulung">/g)).toBe(3);
    expect(labelTerisi(html)).toBe(3);
    // `lewati` hanya untuk lembar A4.
    expect(html).not.toContain("label kosong\"></div>");
    expect(html).not.toContain('class="lembar"');
  });
});

describe("isi label", () => {
  it("batang dari kode, teks kode di bawahnya, nama, varian, harga Rupiah, SKU berbeda", () => {
    const html = buildLabelBarcodeHtml([baris()], opsi());
    expect(html).toContain(svgCode128("TS000123HTMXL"));
    expect(html).toContain('<p class="kode">TS000123HTMXL</p>');
    expect(html).toContain('<p class="nama">Kaos Oversize Hitam</p>');
    expect(html).toContain('<span class="varian">XL · Hitam</span>');
    expect(html).toContain('<span class="harga">Rp 129.000</span>');
    expect(html).toContain('<p class="sku">TS-0123-HTM-XL</p>');
    // Batang kode ini muncul di HTML sebanyak labelnya, tidak lebih.
    expect(hitung(html, /<svg /g)).toBe(1);
  });

  it("SKU tidak ditulis ulang bila sama dengan kodenya (tanpa beda huruf besar)", () => {
    const html = buildLabelBarcodeHtml([baris({ kode: "FG-JEANS-001-30", sku: "fg-jeans-001-30" })], opsi());
    expect(html).not.toContain('class="sku"');
  });

  it("harga disembunyikan bila diminta atau belum diset; nama bisa disembunyikan", () => {
    expect(buildLabelBarcodeHtml([baris()], opsi({ tampilHarga: false }))).not.toContain("Rp ");
    expect(buildLabelBarcodeHtml([baris({ harga: null })], opsi())).not.toContain("Rp ");
    expect(buildLabelBarcodeHtml([baris()], opsi({ tampilNama: false }))).not.toContain('class="nama"');
    // Tanpa varian dan tanpa harga: baris info tidak ada sama sekali.
    expect(buildLabelBarcodeHtml([baris({ varian: null, harga: null })], opsi())).not.toContain('class="info"');
  });

  it("label kecil 33×15 tidak memuat baris SKU dan nama satu baris", () => {
    const html = buildLabelBarcodeHtml([baris()], opsi({ ukuran: "33x15" }));
    expect(html).not.toContain('<p class="sku">');
    expect(html).toContain("-webkit-line-clamp: 1");
    expect(html).toContain('<span class="harga">Rp 129.000</span>');
  });

  it("semua teks dari data di-escape", () => {
    const html = buildLabelBarcodeHtml(
      [baris({ nama: '<script>alert("x")</script>', varian: "<b>XL</b>", sku: "A&B<1>", kode: 'K"<i>' })],
      opsi(),
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>XL</b>");
    expect(html).not.toContain("<i>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;XL&lt;/b&gt;");
    expect(html).toContain("A&amp;B&lt;1&gt;");
    expect(html).toContain('<p class="kode">K&quot;&lt;i&gt;</p>');
  });

  it("kode yang tidak bisa disandikan tidak menggagalkan dokumen — kotaknya ditandai", () => {
    const html = buildLabelBarcodeHtml([baris({ kode: "KAOS-É-01" }), baris()], opsi());
    expect(html).toContain("Kode tidak bisa dibuat batang");
    expect(html).toContain('<p class="kode">KAOS-É-01</p>');
    expect(labelTerisi(html)).toBe(2);
  });
});

describe("gaya ELORAE — meniru label pemilik", () => {
  const pemilik = baris({ kode: "0127000038PS", artikel: "27000038P", ukuran: "S", nama: "Kaos", varian: "S · Hitam", sku: "27000038P-BLK-S" });

  it("STKCOD artikel, batang, kode dengan kotak size, merek; tanpa nama, harga, dan SKU", () => {
    const html = buildLabelBarcodeHtml([pemilik], opsi({ gaya: "ELORAE", tampilHarga: true, tampilNama: true }));
    expect(html).toContain('<p class="stk">STKCOD&nbsp;: 27000038P</p>');
    expect(html).toContain(svgCode128("0127000038PS"));
    expect(html).toContain('<div class="bawah"><p class="kode">0127000038PS</p><span class="size">size <b>S</b></span></div>');
    expect(html).toContain(`<p class="merek">${MEREK_LABEL}</p>`);
    expect(MEREK_LABEL).toBe("Eloraé");
    // Pemilik: "harga tidak di cetak di label" — pilihan harga tidak berlaku di gaya ini.
    expect(html).not.toContain("Rp ");
    expect(html).not.toContain('class="nama"');
    expect(html).not.toContain('class="sku"');
    expect(hitung(html, /<div class="label elorae">/g)).toBe(1);
  });

  it("barang tanpa ukuran: kotak size tidak dicetak", () => {
    const html = buildLabelBarcodeHtml([baris({ ukuran: null })], opsi({ gaya: "ELORAE" }));
    expect(html).not.toContain('class="size"');
    expect(html).toContain('<div class="bawah"><p class="kode">TS000123HTMXL</p></div>');
  });

  it("label kecil 33×15: hanya batang, kode, dan size", () => {
    const html = buildLabelBarcodeHtml([pemilik], opsi({ gaya: "ELORAE", ukuran: "33x15" }));
    expect(html).not.toContain('<p class="stk">');
    expect(html).not.toContain('<p class="merek">');
    expect(html).toContain('<span class="size">size <b>S</b></span>');
  });

  it("teks artikel dan ukuran di-escape", () => {
    const html = buildLabelBarcodeHtml([baris({ artikel: "<b>A</b>", ukuran: "<i>S</i>" })], opsi({ gaya: "ELORAE" }));
    expect(html).not.toContain("<b>A</b>");
    expect(html).not.toContain("<i>S</i>");
    expect(html).toContain("&lt;b&gt;A&lt;/b&gt;");
  });
});

describe("pembantu", () => {
  it("formatHargaLabel memakai titik ribuan Indonesia", () => {
    expect(formatHargaLabel(129000)).toBe("Rp 129.000");
    expect(formatHargaLabel(1250000)).toBe("Rp 1.250.000");
    expect(formatHargaLabel(0)).toBe("Rp 0");
  });

  it("lebarModulMm = (lebar label − 2 mm) ÷ modul termasuk zona tenang", () => {
    const modul = sandikanCode128("ABC-123").modul + 2 * ZONA_TENANG_MODUL;
    expect(lebarModulMm("ABC-123", "50x30")).toBeCloseTo(48 / modul);
    expect(lebarModulMm("ABC-123", "33x15")).toBeCloseTo(31 / modul);
    expect(lebarModulMm("é", "50x30")).toBeNull();
  });
});
