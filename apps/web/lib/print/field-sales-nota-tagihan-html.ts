import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";
import type { FsPrintLine } from "@/lib/print/field-sales-nota-gudang-html";

const idr = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

export type FsTagihanLine = FsPrintLine & { unitPrice: number; lineTotal: number; discountAmount: number; appliedPromoName: string | null };

export interface BuildNotaTagihanOptions {
  orderNo: string;
  storeName: string;
  salesmanName: string;
  approvedAt: Date | string | null;
  subtotal: number;
  orderDiscountAmount: number;
  appliedOrderPromoName: string | null;
  total: number;
  lines: FsTagihanLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    store: string;
    salesman: string;
    date: string;
    no: string;
    product: string;
    qty: string;
    price: string;
    discount: string;
    lineTotal: string;
    subtotal: string;
    orderDiscount: string;
    grandTotal: string;
    regards: string;
    receivedBy: string;
    issuedBy: string;
  };
}

export function buildNotaTagihanPrintHtml(opts: BuildNotaTagihanOptions): string {
  const {
    orderNo,
    storeName,
    salesmanName,
    approvedAt,
    subtotal,
    orderDiscountAmount,
    appliedOrderPromoName,
    total,
    lines,
    issuerName = "Elorae",
    labels,
  } = opts;
  const variantBit = (l: FsTagihanLine) => l.variantLabel ? ` · ${esc(l.variantLabel)}` : (l.variantSku && l.variantSku !== "") ? ` · ${esc(l.variantSku)}` : "";
  const rows = lines.map((l, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${variantBit(l)}</div>${l.appliedPromoName ? `<div class="line-meta">${esc(l.appliedPromoName)}</div>` : ""}</td>
      <td class="col-num">${Number(l.qty).toLocaleString("id-ID")}</td>
      <td class="col-num">${idr(l.unitPrice)}</td>
      <td class="col-num">${idr(l.discountAmount)}</td>
      <td class="col-num">${idr(l.lineTotal - l.discountAmount)}</td>
    </tr>`).join("");
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(labels.title)} — ${esc(orderNo)}</title>
<style>${printCssBase}${printPagePortrait}
  .sign-row { display:flex; justify-content:space-between; gap:48px; margin-top:56px; }
  .sign-box { flex:1; text-align:center; }
  .sign-line { margin-top:56px; border-top:1px solid var(--border); padding-top:6px; font-size:9pt; color:#374151; }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(labels.title)}</h1><p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p></div>
    <div class="doc-ref"><span class="lbl">${esc(labels.doc)}</span><span class="val">${esc(orderNo)}</span>
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(approvedAt))}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.store)}</p><p class="payee-name">${esc(storeName)}</p></div>
    <div><p class="block-label">${esc(labels.salesman)}</p><p class="payee-name">${esc(salesmanName)}</p></div>
  </div>
  <table class="lines"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.product)}</th><th>${esc(labels.qty)}</th>
    <th class="col-num-head">${esc(labels.price)}</th><th class="col-num-head">${esc(labels.discount)}</th><th class="col-num-head">${esc(labels.lineTotal)}</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row"><span class="tk">${esc(labels.subtotal)}</span><span class="tv">${idr(subtotal)}</span></div>
      ${orderDiscountAmount > 0 ? `<div class="tot-row"><span class="tk">${esc(labels.orderDiscount)}${appliedOrderPromoName ? ` · ${esc(appliedOrderPromoName)}` : ""}</span><span class="tv">−${idr(orderDiscountAmount)}</span></div>` : ""}
      <div class="grand-row"><span class="gk">${esc(labels.grandTotal)}</span><span class="gv">${idr(total)}</span></div>
    </div>
  </div>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.regards)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.receivedBy)}</div></div>
  </div>
</body></html>`;
}
