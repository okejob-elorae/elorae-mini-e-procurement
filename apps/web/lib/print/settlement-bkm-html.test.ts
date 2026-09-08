import { describe, it, expect } from "vitest";
import { buildSettlementBkmPrintHtml, type BuildSettlementBkmOptions } from "./settlement-bkm-html";

const labels: BuildSettlementBkmOptions["labels"] = {
  title: "BUKTI KAS MASUK",
  doc: "No. BKM",
  date: "Tanggal",
  status: "Status",
  statusPending: "Menunggu Persetujuan",
  statusApproved: "Disetujui",
  statusRejected: "Ditolak",
  store: "Toko",
  salesman: "Sales",
  invoiceSection: "Faktur yang Dilunasi",
  no: "No",
  invoiceNo: "No. Faktur",
  agreedAmount: "Nilai Disepakati",
  deductionSection: "Rincian Potongan",
  type: "Jenis",
  percent: "Persentase",
  amount: "Nominal",
  deductionNote: "Catatan",
  typeReturOffset: "Potongan Retur",
  typeProgram: "Program Dagang",
  typeAdminFee: "Biaya Admin",
  invoiceTotal: "Total Faktur",
  returTotal: "Potongan Retur",
  programTotal: "Potongan Program",
  adminFeeBase: "Dasar Biaya Admin",
  adminFee: "Biaya Admin",
  expected: "Seharusnya Diterima",
  actual: "Diterima",
  variance: "Selisih",
  regards: "Hormat kami",
  receivedBy: "Diterima oleh",
  issuedBy: "Diterbitkan oleh",
  footerTitle: "Ketentuan",
  footerNote: "Dokumen ini adalah bukti pelunasan yang sah.",
};

function baseFixture(): BuildSettlementBkmOptions {
  return {
    docNo: "BKM/2609/0001",
    status: "APPROVED",
    storeName: "Toko Sejahtera",
    salesmanName: "Andi",
    createdAt: "2026-09-08T00:00:00Z",
    note: "Pelunasan penuh minggu ini",
    invoices: [
      { docNo: "FSD/2608/0010", agreedAmount: 500000 },
      { docNo: "FSD/2608/0011", agreedAmount: 500000 },
    ],
    deductions: [
      { type: "RETUR_OFFSET", amount: 100000, percent: null, note: "Retur barang rusak", returDocNo: "RET/2608/0005" },
      { type: "PROGRAM", amount: 0, percent: null, note: null, returDocNo: null },
      { type: "ADMIN_FEE", amount: 45000, percent: 5, note: null, returDocNo: null },
    ],
    invoiceTotal: 1000000,
    returTotal: 100000,
    programTotal: 0,
    adminFeeBase: 900000,
    adminFee: 45000,
    adminFeePercent: 5,
    expectedAmount: 855000,
    actualAmount: 855000,
    varianceAmount: 0,
    issuerName: "Elorae",
    labels,
  };
}

describe("buildSettlementBkmPrintHtml", () => {
  it("renders every field of the document", () => {
    const html = buildSettlementBkmPrintHtml(baseFixture());
    expect(html).toContain("BUKTI KAS MASUK");
    expect(html).toContain("BKM/2609/0001");
    expect(html).toContain("Disetujui");
    expect(html).toContain("Toko Sejahtera");
    expect(html).toContain("Andi");
    expect(html).toContain("SEP 8, 2026");
    expect(html).toContain("Pelunasan penuh minggu ini");
    expect(html).toContain("FSD/2608/0010");
    expect(html).toContain("FSD/2608/0011");
    expect(html).toContain("Rp 500.000");
    expect(html).toContain("RET/2608/0005");
    expect(html).toContain("Retur barang rusak");
    expect(html).toContain("Rp 1.000.000");
    expect(html).toContain("Rp 100.000");
    expect(html).toContain("Rp 900.000");
    expect(html).toContain("Rp 45.000");
    expect(html).toContain("5.00%");
    expect(html).toContain("Rp 855.000");
    expect(html).toContain("Elorae");
  });

  it("renders a portrait document, not landscape", () => {
    const html = buildSettlementBkmPrintHtml(baseFixture());
    expect(html).toContain("size: A4;");
    expect(html).not.toContain("A4 landscape");
  });

  it("renders a deduction's percent alongside its amount", () => {
    const html = buildSettlementBkmPrintHtml(baseFixture());
    /* The ADMIN_FEE deduction row: percent cell then amount cell, back to back. */
    expect(html).toMatch(/<td class="right">5\.00%<\/td>\s*<td class="right">Rp 45\.000<\/td>/);
  });

  it("shows the linked retur docNo for a RETUR_OFFSET deduction", () => {
    const html = buildSettlementBkmPrintHtml(baseFixture());
    expect(html).toContain('<div class="line-meta">RET/2608/0005</div>');
  });

  it("omits the retur docNo line when a RETUR_OFFSET deduction carries none", () => {
    const fixture = baseFixture();
    fixture.deductions = [
      { type: "RETUR_OFFSET", amount: 100000, percent: null, note: null, returDocNo: null },
    ];
    const html = buildSettlementBkmPrintHtml(fixture);
    /* The shared theme CSS always defines a `.line-meta` rule; assert no rendered DIV uses it. */
    expect(html).not.toContain('<div class="line-meta">');
  });

  it("renders a zero variance differently from a non-zero one", () => {
    /*
     * The shared CSS block always defines BOTH `.variance-zero` and `.variance-nonzero` rules,
     * so a plain `toContain("variance-nonzero")` on the whole document is satisfied by the
     * stylesheet alone regardless of which one actually applied. Extract the rendered variance
     * DIV's own class attribute instead of searching the full document.
     */
    const varianceDivClass = (html: string): string | undefined =>
      html.match(/<div class="tot-row variance-row ([a-z-]+)">/)?.[1];

    const zeroHtml = buildSettlementBkmPrintHtml(baseFixture());
    expect(varianceDivClass(zeroHtml)).toBe("variance-zero");

    const nonZeroFixture = baseFixture();
    nonZeroFixture.actualAmount = 850000;
    nonZeroFixture.varianceAmount = -5000;
    const nonZeroHtml = buildSettlementBkmPrintHtml(nonZeroFixture);
    expect(varianceDivClass(nonZeroHtml)).toBe("variance-nonzero");
    /* Negative variance renders with the minus sign and the magnitude, never a raw negative number. */
    expect(nonZeroHtml).toContain("−Rp 5.000");
    expect(nonZeroHtml).not.toContain("Rp -5.000");
  });

  it("escapes HTML-unsafe characters in the store name and a deduction note", () => {
    const fixture = baseFixture();
    fixture.storeName = "Toko <script>alert(1)</script> Jaya";
    fixture.deductions = [
      { type: "PROGRAM", amount: 20000, percent: null, note: "Diskon <b>khusus</b> & promo", returDocNo: null },
    ];
    const html = buildSettlementBkmPrintHtml(fixture);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Toko &lt;script&gt;alert(1)&lt;/script&gt; Jaya");
    expect(html).not.toContain("<b>khusus</b>");
    expect(html).toContain("Diskon &lt;b&gt;khusus&lt;/b&gt; &amp; promo");
  });

  it("renders an em dash, never null or NaN, when adminFeePercent is null", () => {
    const fixture = baseFixture();
    /* An ADMIN_FEE deduction must exist for its row to render at all (see the two tests above) — percent is nullable independent of that. */
    fixture.deductions = [{ type: "ADMIN_FEE", amount: 0, percent: null, note: null, returDocNo: null }];
    fixture.adminFeePercent = null;
    fixture.adminFee = 0;
    const html = buildSettlementBkmPrintHtml(fixture);
    expect(html).toContain("(—)");
    expect(html).not.toContain("NaN");
    expect(html).not.toMatch(/>null</);
  });

  it("renders the netted adminFeeBase, not the gross invoiceTotal, in the base row", () => {
    /*
     * invoiceTotal (gross) is 1.000.000; adminFeeBase (netted, after the 100.000 retur credit) is
     * 900.000. The fee is 5% of the netted 900.000 = 45.000 — 5% of the gross would be 50.000.
     * The builder computes nothing itself — this pins that the base-row SLOT is filled with
     * `adminFeeBase`, not `invoiceTotal`. If a future edit swapped them, "Rp 900.000" would
     * disappear from the base row and "Rp 50.000" would appear where the fee is shown instead.
     */
    const html = buildSettlementBkmPrintHtml(baseFixture());
    const baseRowMatch = html.match(/<div class="tot-row subtotal-row"><span class="tk">[^<]*<\/span><span class="tv">([^<]*)<\/span><\/div>/);
    expect(baseRowMatch?.[1]).toBe("Rp 900.000");
    expect(html).not.toContain("Rp 50.000");
  });

  it("omits the admin fee row entirely when no ADMIN_FEE deduction exists on the settlement", () => {
    const fixture = baseFixture();
    fixture.deductions = [
      { type: "RETUR_OFFSET", amount: 100000, percent: null, note: null, returDocNo: "RET/2608/0005" },
    ];
    fixture.adminFee = 0;
    fixture.adminFeePercent = null;
    fixture.adminFeeBase = 900000;
    const html = buildSettlementBkmPrintHtml(fixture);
    /*
     * Checked as "label + opening paren", not the bare label: `labels.adminFeeBase` ("Dasar Biaya
     * Admin") legitimately contains `labels.adminFee` ("Biaya Admin") as a substring, and that
     * base row always renders — a bare `not.toContain(labels.adminFee)` would false-fail on it.
     */
    expect(html).not.toContain(`${labels.adminFee} (`);
  });

  it("still shows the admin fee row for a zero-amount ADMIN_FEE deduction", () => {
    /*
     * The row's presence is driven by the deduction EXISTING, never by `adminFee > 0` — a
     * settlement can carry a genuine zero-value fee arrangement, and hiding it on `> 0` would
     * make that indistinguishable from no fee arrangement at all. This is the case a future
     * "simplify to `adminFee > 0`" would silently break.
     */
    const fixture = baseFixture();
    fixture.deductions = [{ type: "ADMIN_FEE", amount: 0, percent: 0, note: null, returDocNo: null }];
    fixture.adminFee = 0;
    fixture.adminFeePercent = 0;
    const html = buildSettlementBkmPrintHtml(fixture);
    expect(html).toContain(`${labels.adminFee} (0.00%)`);
  });
});
