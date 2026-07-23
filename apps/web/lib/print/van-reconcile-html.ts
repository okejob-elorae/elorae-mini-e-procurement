import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

export type VanReconcilePrintLine = { productName: string; variantSku: string | null; expectedQty: number; countedQty: number; varianceQty: number };

export interface BuildVanReconcileOptions {
  docNo: string;
  createdAt: Date | string | null;
  canvasserName: string;
  reconciledByName: string;
  note: string | null;
  totalReturnedQty: number;
  totalVarianceQty: number;
  lines: VanReconcilePrintLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    canvasser: string;
    reconciledBy: string;
    date: string;
    product: string;
    expected: string;
    counted: string;
    variance: string;
    totalReturned: string;
    totalVariance: string;
    reason: string;
    canvasserSign: string;
    adminSign: string;
    issuedBy: string;
  };
}

export function buildVanReconcilePrintHtml(opts: BuildVanReconcileOptions): string {
  const { docNo, createdAt, canvasserName, reconciledByName, note, totalReturnedQty, totalVarianceQty, lines, issuerName = "Elorae", labels } = opts;
  const variantBit = (l: VanReconcilePrintLine) => l.variantSku && l.variantSku !== "" ? ` · ${esc(l.variantSku)}` : "";
  const rowClass = (l: VanReconcilePrintLine) => l.varianceQty > 0 ? " class=\"row-over\"" : l.varianceQty < 0 ? " class=\"row-under\"" : "";
  const rows = lines.map((l) => `<tr${rowClass(l)}>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${variantBit(l)}</div></td>
      <td class="right">${Number(l.expectedQty).toLocaleString("id-ID")}</td>
      <td class="right">${Number(l.countedQty).toLocaleString("id-ID")}</td>
      <td class="right">${Number(l.varianceQty).toLocaleString("id-ID")}</td>
    </tr>`).join("");
  const reasonSection = note ? `<p class="section-title">${esc(labels.reason)}</p><p class="section-desc">${esc(note)}</p>` : "";
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
      <span class="lbl">${esc(labels.date)}</span><span class="val">${esc(fmtDocDate(createdAt))}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.canvasser)}</p><p class="payee-name">${esc(canvasserName)}</p></div>
    <div><p class="block-label">${esc(labels.reconciledBy)}</p><p class="payee-name">${esc(reconciledByName)}</p></div>
  </div>
  <table class="data"><thead><tr>
    <th>${esc(labels.product)}</th><th class="right">${esc(labels.expected)}</th><th class="right">${esc(labels.counted)}</th><th class="right">${esc(labels.variance)}</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="summary-strip">
    <div><p class="sk">${esc(labels.totalReturned)}</p><p class="sv">${Number(totalReturnedQty).toLocaleString("id-ID")}</p></div>
    <div><p class="sk">${esc(labels.totalVariance)}</p><p class="sv">${Number(totalVarianceQty).toLocaleString("id-ID")}</p></div>
  </div>
  ${reasonSection}
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.canvasserSign)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.adminSign)}</div></div>
  </div>
</body></html>`;
}
