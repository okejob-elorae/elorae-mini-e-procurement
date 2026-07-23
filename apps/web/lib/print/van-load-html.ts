import { esc, fmtDocDate, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

export type VanLoadPrintLine = { productName: string; variantSku: string | null; variantLabel: string | null; qty: number };

export interface BuildVanLoadOptions {
  docNo: string;
  createdAt: Date | string | null;
  canvasserName: string;
  loadedByName: string;
  lines: VanLoadPrintLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    canvasser: string;
    loadedBy: string;
    date: string;
    no: string;
    product: string;
    qty: string;
    adminSign: string;
    canvasserSign: string;
    issuedBy: string;
  };
}

export function buildVanLoadPrintHtml(opts: BuildVanLoadOptions): string {
  const { docNo, createdAt, canvasserName, loadedByName, lines, issuerName = "Elorae", labels } = opts;
  const variantBit = (l: VanLoadPrintLine) => l.variantLabel ? ` · ${esc(l.variantLabel)}` : (l.variantSku && l.variantSku !== "") ? ` · ${esc(l.variantSku)}` : "";
  const rows = lines.map((l, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${variantBit(l)}</div></td>
      <td class="right">${Number(l.qty).toLocaleString("id-ID")}</td>
    </tr>`).join("");
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
    <div><p class="block-label">${esc(labels.loadedBy)}</p><p class="payee-name">${esc(loadedByName)}</p></div>
  </div>
  <table class="lines"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.product)}</th><th class="col-num-head">${esc(labels.qty)}</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.adminSign)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.canvasserSign)}</div></div>
  </div>
</body></html>`;
}
