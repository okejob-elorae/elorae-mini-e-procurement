import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildNotaKainHtml } from "./nota-kain-html";

/*
 * Cetak "Nota Kain per Roll" di rincian perintah kerja. Dulu ref/catatan rol,
 * nama pemasok, nama barang, dan bahan ditulis mentah ke `document.write` —
 * catatan rol berisi `<img src=x onerror=…>` menjalankan skrip di jendela cetak
 * (yang sama asalnya dengan aplikasi) siapa pun yang mencetak nota itu.
 */

const JAHAT = `<img src=x onerror="alert(1)">`;

function nota(over: Partial<Parameters<typeof buildNotaKainHtml>[0]> = {}) {
  return buildNotaKainHtml({
    docNumber: "WO/2026/0001",
    vendorName: "CMT Maju",
    fgName: "Kemeja Linen",
    labelKonsumsi: "Estimasi konsumsi / pcs",
    rolls: [{ rollRef: "R-01", qty: 12.5, notes: "aman" }],
    materials: [{ itemName: "Linen Putih", itemId: "i1", plannedQty: 30, uomCode: "M" }],
    ...over,
  });
}

describe("buildNotaKainHtml", () => {
  it("menulis isi nota seperti sebelumnya", () => {
    const html = nota();
    expect(html).toContain("<title>Nota Kain per Roll - WO/2026/0001</title>");
    expect(html).toContain("<td>R-01</td><td>12.5</td><td>aman</td>");
    expect(html).toContain("<td>Linen Putih</td><td>30</td><td>M</td>");
    expect(html).toContain("<th>Estimasi konsumsi / pcs</th>");
    expect(html).toContain("CMT Maju");
    expect(html).toContain("Kemeja Linen");
  });

  it.each([
    ["ref rol", { rolls: [{ rollRef: JAHAT, qty: 1, notes: "" }] }],
    ["catatan rol", { rolls: [{ rollRef: "R-01", qty: 1, notes: JAHAT }] }],
    ["nama pemasok", { vendorName: JAHAT }],
    ["nama barang jadi", { fgName: JAHAT }],
    ["nomor dokumen", { docNumber: JAHAT }],
    ["nama bahan", { materials: [{ itemName: JAHAT, plannedQty: 1, uomCode: "M" }] }],
    ["id bahan tanpa nama", { materials: [{ itemName: null, itemId: JAHAT, plannedQty: 1, uomCode: "M" }] }],
    ["satuan bahan", { materials: [{ itemName: "x", plannedQty: 1, uomCode: JAHAT }] }],
    ["label terjemahan", { labelKonsumsi: JAHAT }],
  ])("meloloskan %s sebagai teks, bukan markup", (_n, over) => {
    const html = nota(over as Partial<Parameters<typeof buildNotaKainHtml>[0]>);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });

  it("nilai kosong tidak tercetak sebagai 'null'/'undefined'", () => {
    const html = nota({
      vendorName: null,
      fgName: undefined,
      rolls: [{ rollRef: null, qty: null, notes: null }],
      materials: [{ itemName: null, itemId: null, plannedQty: null, uomCode: null }],
    });
    expect(html).not.toMatch(/null|undefined/);
    expect(html).toContain("<td></td><td>0</td><td></td>");
  });

  it("halaman rincian WO mencetak lewat pembangun ini, bukan templat mentah", () => {
    const halaman = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    expect(halaman).toMatch(/win\.document\.write\(\s*buildNotaKainHtml\(/);
    expect(halaman).not.toContain("${r.notes");
    expect(halaman).not.toContain("${r.rollRef");
  });
});
