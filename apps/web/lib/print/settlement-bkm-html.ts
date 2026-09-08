import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

/* Nullable money renders as an em dash rather than "null" or "NaN" — never reaches arithmetic. */
const idr = (n: number | null): string => (n == null ? "—" : `Rp ${Math.round(n).toLocaleString("id-ID")}`);

/* Percent renders with two decimals (matches inventory-report-html.ts); em dash for null. */
const pct = (n: number | null): string => (n == null ? "—" : `${Number(n).toFixed(2)}%`);

export type SettlementBkmStatus = "PENDING" | "APPROVED" | "REJECTED";

export type SettlementBkmDeductionType = "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";

export interface SettlementBkmInvoiceRow {
  docNo: string;
  agreedAmount: number;
}

export interface SettlementBkmDeductionRow {
  type: SettlementBkmDeductionType;
  amount: number;
  /** Only meaningful for ADMIN_FEE; null on every other type. */
  percent: number | null;
  note: string | null;
  /** The linked retur's docNo — populated only for a RETUR_OFFSET row that carries one. */
  returDocNo: string | null;
}

export interface BuildSettlementBkmOptions {
  docNo: string;
  status: SettlementBkmStatus;
  storeName: string;
  salesmanName: string;
  createdAt: Date | string;
  /** Free-text settlement note, e.g. a salesman remark at filing time. Not persisted separately. */
  note?: string | null;
  invoices: SettlementBkmInvoiceRow[];
  deductions: SettlementBkmDeductionRow[];
  invoiceTotal: number;
  returTotal: number;
  programTotal: number;
  /** invoiceTotal − returTotal − programTotal — the base the admin fee percent is applied to. */
  adminFeeBase: number;
  adminFee: number;
  /** Nullable — a settlement with no ADMIN_FEE deduction carries no percent to show. */
  adminFeePercent: number | null;
  expectedAmount: number;
  actualAmount: number;
  /** actualAmount − expectedAmount. */
  varianceAmount: number;
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    date: string;
    status: string;
    statusPending: string;
    statusApproved: string;
    statusRejected: string;
    store: string;
    salesman: string;
    invoiceSection: string;
    no: string;
    invoiceNo: string;
    agreedAmount: string;
    deductionSection: string;
    type: string;
    percent: string;
    amount: string;
    deductionNote: string;
    typeReturOffset: string;
    typeProgram: string;
    typeAdminFee: string;
    invoiceTotal: string;
    returTotal: string;
    programTotal: string;
    adminFeeBase: string;
    adminFee: string;
    expected: string;
    actual: string;
    variance: string;
    regards: string;
    receivedBy: string;
    issuedBy: string;
    footerTitle: string;
    footerNote: string;
  };
}

/**
 * BKM (Bukti Kas Masuk) — the paper receipt a salesman leaves behind after settling a store's
 * outstanding invoices. Portrait, no product lines: the whole document is the money story —
 * invoices, minus what the store negotiated off (retur credit, a trade-program allowance, an
 * admin fee charged on the NETTED base, never the gross), against what was actually handed over.
 */
export function buildSettlementBkmPrintHtml(opts: BuildSettlementBkmOptions): string {
  const {
    docNo,
    status,
    storeName,
    salesmanName,
    createdAt,
    note,
    invoices,
    deductions,
    invoiceTotal,
    returTotal,
    programTotal,
    adminFeeBase,
    adminFee,
    adminFeePercent,
    expectedAmount,
    actualAmount,
    varianceAmount,
    issuerName = "Elorae",
    labels,
  } = opts;

  const statusLabel: Record<SettlementBkmStatus, string> = {
    PENDING: labels.statusPending,
    APPROVED: labels.statusApproved,
    REJECTED: labels.statusRejected,
  };
  const statusClass: Record<SettlementBkmStatus, string> = {
    PENDING: "status-pending",
    APPROVED: "status-approved",
    REJECTED: "status-rejected",
  };

  const typeLabel: Record<SettlementBkmDeductionType, string> = {
    RETUR_OFFSET: labels.typeReturOffset,
    PROGRAM: labels.typeProgram,
    ADMIN_FEE: labels.typeAdminFee,
  };

  const invoiceRows = invoices
    .map(
      (inv, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc">${esc(inv.docNo)}</td>
      <td class="right">${idr(inv.agreedAmount)}</td>
    </tr>`
    )
    .join("");

  const deductionRows = deductions
    .map((d, i) => {
      const returBit =
        d.type === "RETUR_OFFSET" && d.returDocNo
          ? `<div class="line-meta">${esc(d.returDocNo)}</div>`
          : "";
      return `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(typeLabel[d.type])}</div>${returBit}</td>
      <td class="right">${pct(d.percent)}</td>
      <td class="right">${idr(d.amount)}</td>
      <td>${d.note ? esc(d.note) : "—"}</td>
    </tr>`;
    })
    .join("");

  const noteHtml =
    note && note.trim() !== "" ? `<div class="footnote">${esc(note).replace(/\n/g, "<br>")}</div>` : "";

  /*
   * The admin fee row renders when an ADMIN_FEE deduction EXISTS on the settlement, never on
   * `adminFee > 0` — a genuine zero-value fee arrangement is a real thing the store agreed to
   * and must still show, and `adminFeePercent !== null` is equally wrong since percent is
   * nullable on the underlying model independent of whether a fee was charged. Existence of the
   * deduction row is the only honest signal; the amount and percent are just what it says.
   */
  const hasAdminFee = deductions.some((d) => d.type === "ADMIN_FEE");

  const varianceIsZero = varianceAmount === 0;
  const varianceClass = varianceIsZero ? "variance-zero" : "variance-nonzero";
  const varianceSign = varianceAmount > 0 ? "+" : varianceAmount < 0 ? "−" : "";

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(labels.title)} — ${esc(docNo)}</title>
<style>${printCssBase}${printPagePortrait}
  .sign-row { display:flex; justify-content:space-between; gap:48px; margin-top:56px; }
  .sign-box { flex:1; text-align:center; }
  .sign-line { margin-top:56px; border-top:1px solid var(--border); padding-top:6px; font-size:9pt; color:#374151; }
  .footnote { margin-top:24px; font-size:9pt; color:#6b7280; line-height:1.5; }
  .status-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 2px;
    font-family: var(--mono);
    font-size: 8pt;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .status-pending { border: 1px solid #92400e; background: #fef3c7; color: #78350f; }
  .status-approved { border: 1px solid #166534; background: #bbf7d0; color: #14532d; }
  .status-rejected { border: 1px solid #991b1b; background: #fecaca; color: #7f1d1d; }
  .subtotal-row { padding-top:8px; margin-bottom:8px; border-top:1px solid var(--border); font-style:italic; }
  .variance-row { padding-top:10px; margin-top:6px; border-top:1px dashed var(--border); font-weight:600; }
  .variance-zero .tv { color: #374151; }
  .variance-nonzero .tv { color: #991b1b; }
  @media print {
    .status-pill {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
  }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(labels.title)}</h1><p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p></div>
    <div class="doc-ref"><span class="lbl">${esc(labels.doc)}</span><span class="val">${esc(docNo)}</span>
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(createdAt))}</span>
      <span class="lbl">${esc(labels.status)}</span><span class="val"><span class="status-pill ${statusClass[status]}">${esc(statusLabel[status])}</span></span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.store)}</p><p class="payee-name">${esc(storeName)}</p></div>
    <div><p class="block-label">${esc(labels.salesman)}</p><p class="payee-name">${esc(salesmanName)}</p></div>
  </div>
  ${noteHtml}
  <p class="section-title">${esc(labels.invoiceSection)}</p>
  <table class="data"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.invoiceNo)}</th><th class="right">${esc(labels.agreedAmount)}</th>
  </tr></thead><tbody>${invoiceRows}</tbody></table>
  <p class="section-title">${esc(labels.deductionSection)}</p>
  <table class="data"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.type)}</th><th class="right">${esc(labels.percent)}</th><th class="right">${esc(labels.amount)}</th><th>${esc(labels.deductionNote)}</th>
  </tr></thead><tbody>${deductionRows}</tbody></table>
  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row"><span class="tk">${esc(labels.invoiceTotal)}</span><span class="tv">${idr(invoiceTotal)}</span></div>
      ${returTotal > 0 ? `<div class="tot-row"><span class="tk">${esc(labels.returTotal)}</span><span class="tv">−${idr(returTotal)}</span></div>` : ""}
      ${programTotal > 0 ? `<div class="tot-row"><span class="tk">${esc(labels.programTotal)}</span><span class="tv">−${idr(programTotal)}</span></div>` : ""}
      <div class="tot-row subtotal-row"><span class="tk">${esc(labels.adminFeeBase)}</span><span class="tv">${idr(adminFeeBase)}</span></div>
      ${hasAdminFee ? `<div class="tot-row"><span class="tk">${esc(labels.adminFee)} (${pct(adminFeePercent)})</span><span class="tv">−${idr(adminFee)}</span></div>` : ""}
      <div class="grand-row"><span class="gk">${esc(labels.expected)}</span><span class="gv">${idr(expectedAmount)}</span></div>
    </div>
  </div>
  <div class="totals-wrap">
    <div class="totals">
      <div class="grand-row"><span class="gk">${esc(labels.actual)}</span><span class="gv">${idr(actualAmount)}</span></div>
      <div class="tot-row variance-row ${varianceClass}"><span class="tk">${esc(labels.variance)}</span><span class="tv">${varianceSign}${idr(Math.abs(varianceAmount))}</span></div>
    </div>
  </div>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.regards)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.receivedBy)}</div></div>
  </div>
  <section class="legal">
    <h2 class="legal-title">${esc(labels.footerTitle)}</h2>
    <p class="legal-body">${esc(labels.footerNote)}</p>
  </section>
</body></html>`;
}
