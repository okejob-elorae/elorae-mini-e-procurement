import { idFotoDariUrl } from "@/lib/field-sales/delivery/bukti-terima";
import { esc, fmtDocDate, fmtDocDateTime, printCssBase, printPagePortrait } from "@/lib/print/print-theme";

export type BuktiTerimaPrintLine = { productName: string; variantSku: string | null; variantLabel: string | null; qty: number };

export interface BuildBuktiTerimaOptions {
  docNo: string;
  orderNo: string;
  storeName: string;
  salesmanName: string;
  deliveredAt: Date | string | null;
  lines: BuktiTerimaPrintLine[];
  receivedByName: string | null;
  receivedAt: Date | string | null;
  podPhotoUrl: string | null;
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    orderRef: string;
    store: string;
    salesman: string;
    deliveredAt: string;
    receivedBy: string;
    receivedAt: string;
    evidence: string;
    no: string;
    product: string;
    qty: string;
    totalQty: string;
    statement: string;
    notYetReceived: string;
    signature: string;
    issuedBy: string;
  };
}

/**
 * Tanda terima barang untuk satu pengiriman.
 *
 * Dua wujud dari satu dokumen: sebelum dikonfirmasi ia lembar kosong untuk
 * ditandatangani toko (dibawa bersama barang); sesudahnya ia salinan bukti yang
 * tercatat — nama penerima, jam terima (WIB), dan gambar buktinya.
 *
 * Tanpa harga, seperti nota gudang: yang diakui toko di sini barangnya, bukan
 * tagihannya. Gambar hanya disematkan bila jalurnya foto internal
 * `/api/foto/<id>` — nilai lain tidak pernah masuk ke atribut `src`.
 */
export function buildBuktiTerimaPrintHtml(opts: BuildBuktiTerimaOptions): string {
  const { docNo, orderNo, storeName, salesmanName, deliveredAt, lines, receivedByName, receivedAt, podPhotoUrl, issuerName = "Elorae", labels } =
    opts;
  const tercatat = Boolean(receivedAt);
  const gambar = podPhotoUrl && idFotoDariUrl(podPhotoUrl) ? podPhotoUrl : null;
  const varian = (l: BuktiTerimaPrintLine) =>
    l.variantLabel ? ` · ${esc(l.variantLabel)}` : l.variantSku ? ` · ${esc(l.variantSku)}` : "";
  const totalQty = lines.reduce((n, l) => n + l.qty, 0);
  const rows = lines
    .map(
      (l, i) => `<tr>
      <td class="uom">${i + 1}</td>
      <td class="col-desc"><div class="line-name">${esc(l.productName)}${varian(l)}</div></td>
      <td class="right">${Number(l.qty).toLocaleString("id-ID")}</td>
    </tr>`,
    )
    .join("");

  const bukti = tercatat
    ? `<div class="receipt">
    <div class="two-col">
      <div><p class="block-label">${esc(labels.receivedBy)}</p><p class="payee-name">${esc(receivedByName ?? "—")}</p></div>
      <div><p class="block-label">${esc(labels.receivedAt)}</p><p class="payee-name">${esc(fmtDocDateTime(receivedAt))} WIB</p></div>
    </div>
    ${gambar ? `<p class="block-label">${esc(labels.evidence)}</p><img class="evidence" src="${esc(gambar)}" alt="${esc(labels.evidence)}">` : ""}
  </div>`
    : `<p class="pending">${esc(labels.notYetReceived)}</p>
  <div class="sign-row">
    <div class="sign-box"><div class="sign-line">${esc(labels.receivedAt)}</div></div>
    <div class="sign-box"><div class="sign-line">${esc(labels.signature)}</div></div>
  </div>`;

  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>${esc(labels.title)} — ${esc(docNo)}</title>
<style>${printCssBase}${printPagePortrait}
  .statement { margin-top:18px; font-size:10pt; }
  .pending { margin-top:18px; font-size:9pt; color:#6b7280; text-transform:uppercase; letter-spacing:.06em; }
  .receipt { margin-top:18px; }
  .evidence { display:block; margin-top:6px; max-width:100%; max-height:9cm; border:1px solid var(--border); border-radius:4px; object-fit:contain; }
  .sign-row { display:flex; justify-content:space-between; gap:48px; margin-top:48px; }
  .sign-box { flex:1; text-align:center; }
  .sign-line { margin-top:56px; border-top:1px solid var(--border); padding-top:6px; font-size:9pt; color:#374151; }
</style></head>
<body>
  <div class="doc-top">
    <div><h1 class="doc-title">${esc(labels.title)}</h1><p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p></div>
    <div class="doc-ref"><span class="lbl">${esc(labels.doc)}</span><span class="val">${esc(docNo)}</span>
      <span class="lbl">${esc(labels.orderRef)}</span><span class="val">${esc(orderNo)}</span>
      <span class="lbl">${esc(labels.deliveredAt)}</span><span class="val">${esc(fmtDocDate(deliveredAt))}</span></div>
  </div>
  <div class="two-col">
    <div><p class="block-label">${esc(labels.store)}</p><p class="payee-name">${esc(storeName)}</p></div>
    <div><p class="block-label">${esc(labels.salesman)}</p><p class="payee-name">${esc(salesmanName)}</p></div>
  </div>
  <table class="lines"><thead><tr>
    <th>${esc(labels.no)}</th><th>${esc(labels.product)}</th><th class="col-num-head">${esc(labels.qty)}</th>
  </tr></thead><tbody>${rows}
    <tr><td></td><td class="right">${esc(labels.totalQty)}</td><td class="right">${totalQty.toLocaleString("id-ID")}</td></tr>
  </tbody></table>
  <p class="statement">${esc(labels.statement)}</p>
  ${bukti}
</body></html>`;
}
