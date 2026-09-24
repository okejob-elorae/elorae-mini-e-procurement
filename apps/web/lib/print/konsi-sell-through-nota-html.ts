import { esc, fmtDocDate, money, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

export type KonsiSellThroughNotaLine = {
  productName: string;
  variantLabel: string | null;
  variantSku: string;
  billedQty: number;
  unitPrice: number;
  lineTotal: number;
};

export interface BuildKonsiSellThroughNotaOptions {
  docNo: string;
  storeName: string;
  storeAddress: string | null;
  storeNpwp: string | null;
  periodStart: Date | string | null;
  periodEnd: Date | string;
  invoiceDate: Date | string;
  dueDate: Date | string;
  salesmanName: string;
  lines: KonsiSellThroughNotaLine[];
  total: number;
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    store: string;
    npwp: string;
    period: string;
    periodFirst: string;
    date: string;
    dueDate: string;
    salesman: string;
    no: string;
    product: string;
    qty: string;
    price: string;
    lineTotal: string;
    grandTotal: string;
    issuedBy: string;
    regards: string;
    receivedBy: string;
  };
}

export function buildKonsiSellThroughNotaHtml(opts: BuildKonsiSellThroughNotaOptions): string {
  const {
    docNo,
    storeName,
    storeAddress,
    storeNpwp,
    periodStart,
    periodEnd,
    invoiceDate,
    dueDate,
    salesmanName,
    lines,
    total,
    issuerName = "Elorae",
    labels,
  } = opts;
  const variantBit = (l: KonsiSellThroughNotaLine) =>
    l.variantLabel ? ` · ${esc(l.variantLabel)}` : l.variantSku && l.variantSku !== "" ? ` · ${esc(l.variantSku)}` : "";
  const periodText = periodStart
    ? `${fmtDocDate(periodStart)} – ${fmtDocDate(periodEnd)}`
    : `${labels.periodFirst} ${fmtDocDate(periodEnd)}`;
  const rows = lines
    .map(
      (l, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${variantBit(l)}</div></td>
      <td class="col-num">${Number(l.billedQty).toLocaleString("id-ID")}</td>
      <td class="col-num">${money("Rp", l.unitPrice)}</td>
      <td class="col-num">${money("Rp", l.lineTotal)}</td>
    </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(labels.title)} — ${esc(docNo)}</title>
<style>${printCssBase}${printPagePortrait}
  .sign-row { display:flex; justify-content:space-between; gap:48px; margin-top:56px; }
  .sign-box { flex:1; text-align:center; }
  .sign-line { margin-top:56px; border-top:1px solid var(--border); padding-top:6px; font-size:9pt; color:#374151; }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(labels.title)}</h1><p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p></div>
    <div class="doc-ref"><span class="lbl">${esc(labels.doc)}</span><span class="val">${esc(docNo)}</span>
      <span class="lbl">${esc(labels.period)}</span><span class="val">${esc(periodText)}</span>
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(invoiceDate))}</span>
      <span class="lbl">${esc(labels.dueDate)}</span><span class="val">${esc(fmtDocDate(dueDate))}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.store)}</p><p class="payee-name">${esc(storeName)}</p>${storeAddress ? `<p class="payee-addr">${esc(storeAddress)}</p>` : ""}${storeNpwp ? `<p class="code-line">${esc(labels.npwp)}: ${esc(storeNpwp)}</p>` : ""}</div>
    <div><p class="block-label">${esc(labels.salesman)}</p><p class="payee-name">${esc(salesmanName)}</p></div>
  </div>
  <table class="lines"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.product)}</th><th class="col-num-head">${esc(labels.qty)}</th>
    <th class="col-num-head">${esc(labels.price)}</th><th class="col-num-head">${esc(labels.lineTotal)}</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="totals-wrap">
    <div class="totals">
      <div class="grand-row"><span class="gk">${esc(labels.grandTotal)}</span><span class="gv">${money("Rp", total)}</span></div>
    </div>
  </div>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.regards)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.receivedBy)}</div></div>
  </div>
</body></html>`;
}
