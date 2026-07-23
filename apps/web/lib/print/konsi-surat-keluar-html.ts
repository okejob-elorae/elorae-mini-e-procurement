import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

export type KonsiLine = { productName: string; variantSku: string | null; variantLabel: string | null; qty: number };

export interface BuildSuratKeluarOptions {
  orderNo: string;
  storeName: string;
  salesmanName: string;
  approvedAt: Date | string | null;
  status: string;
  lines: KonsiLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    store: string;
    salesman: string;
    date: string;
    status: string;
    no: string;
    product: string;
    qty: string;
    consignmentNote: string;
    handedBy: string;
    receivedBy: string;
    issuedBy: string;
  };
}

export function buildSuratKeluarPrintHtml(opts: BuildSuratKeluarOptions): string {
  const { orderNo, storeName, salesmanName, approvedAt, status, lines, issuerName = "Elorae", labels } = opts;
  const variantBit = (l: KonsiLine) => l.variantLabel ? ` · ${esc(l.variantLabel)}` : (l.variantSku && l.variantSku !== "") ? ` · ${esc(l.variantSku)}` : "";
  const rows = lines.map((l, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${variantBit(l)}</div></td>
      <td class="right">${Number(l.qty).toLocaleString("id-ID")}</td>
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
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(approvedAt))}</span>
      <span class="lbl">${esc(labels.status)}</span><span class="val">${esc(status)}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.store)}</p><p class="payee-name">${esc(storeName)}</p></div>
    <div><p class="block-label">${esc(labels.salesman)}</p><p class="payee-name">${esc(salesmanName)}</p></div>
  </div>
  <p class="section-desc">${esc(labels.consignmentNote)}</p>
  <table class="lines"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.product)}</th><th class="col-num-head">${esc(labels.qty)}</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.handedBy)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.receivedBy)}</div></div>
  </div>
</body></html>`;
}
