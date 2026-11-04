import { describe, expect, it } from "vitest";
import { buildBuktiTerimaPrintHtml } from "./bukti-terima-html";

const labels = {
  title: "TANDA TERIMA BARANG",
  doc: "No. Nota",
  orderRef: "Ref. Pesanan",
  store: "Toko",
  salesman: "Sales",
  deliveredAt: "Tanggal kirim",
  receivedBy: "Diterima oleh",
  receivedAt: "Waktu diterima",
  evidence: "Bukti",
  no: "No",
  product: "Produk",
  qty: "Qty",
  totalQty: "Total",
  statement: "Barang di atas sudah diterima dalam keadaan baik.",
  notYetReceived: "Belum dikonfirmasi",
  signature: "Tanda tangan & nama penerima",
  issuedBy: "Diterbitkan oleh",
};

const dasar = {
  docNo: "DLV/2609/0003",
  orderNo: "PUTUS/2609/0011",
  storeName: "Toko <Maju> & Jaya",
  salesmanName: "Budi",
  deliveredAt: "2026-09-12T02:15:00.000Z",
  lines: [
    { productName: "Kaos", variantSku: "K-M", variantLabel: "size: M", qty: 6 },
    { productName: "Kemeja", variantSku: "", variantLabel: null, qty: 4 },
  ],
  labels,
};

describe("buildBuktiTerimaPrintHtml", () => {
  it("prints the recorded proof with WIB time and the internal image, but never a price", () => {
    const html = buildBuktiTerimaPrintHtml({
      ...dasar,
      receivedByName: "Bu Siti",
      receivedAt: "2026-09-12T16:30:00.000Z",
      podPhotoUrl: "/api/foto/ckfoto1",
    });
    expect(html).toContain("TANDA TERIMA BARANG");
    expect(html).toContain("DLV/2609/0003");
    expect(html).toContain("PUTUS/2609/0011");
    expect(html).toContain("Bu Siti");
    // 16:30 UTC = 23:30 WIB on the 12th — the WIB pin keeps it on the right day.
    expect(html).toMatch(/12 Sep 2026.*23[.:]30/);
    expect(html).toContain('src="/api/foto/ckfoto1"');
    expect(html).toContain("size: M");
    expect(html).toContain(">10<");
    expect(html).not.toMatch(/Rp\s/);
  });

  it("escapes names", () => {
    const html = buildBuktiTerimaPrintHtml({ ...dasar, receivedByName: "<b>x</b>", receivedAt: null, podPhotoUrl: null });
    expect(html).toContain("Toko &lt;Maju&gt; &amp; Jaya");
    expect(html).not.toContain("<b>x</b>");
  });

  it("prints a blank form to be signed when nothing is recorded yet", () => {
    const html = buildBuktiTerimaPrintHtml({ ...dasar, receivedByName: null, receivedAt: null, podPhotoUrl: null });
    expect(html).toContain("Belum dikonfirmasi");
    expect(html).toContain("Tanda tangan &amp; nama penerima");
    expect(html).not.toContain("<img");
  });

  it("never embeds an image that is not an internal photo path", () => {
    const html = buildBuktiTerimaPrintHtml({
      ...dasar,
      receivedByName: "Bu Siti",
      receivedAt: "2026-09-12T04:00:00.000Z",
      podPhotoUrl: 'https://evil.example/x.png" onerror="alert(1)',
    });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });
});
