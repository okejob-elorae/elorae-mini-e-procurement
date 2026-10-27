/**
 * Material Issue print (Surat Jalan CMT) — shared print theme. A delivery note to the CMT:
 * quantities and units only, never material cost.
 */

import { esc, fmtDocDate, printCssBase, printPagePortrait } from '@/lib/print/print-theme';

export type MaterialIssuePrintLine = {
  itemName: string;
  itemSku?: string;
  qty: number;
  uomCode: string;
};

export interface BuildMaterialIssuePrintHtmlOptions {
  docNumber: string;
  woDocNumber: string;
  vendorName: string;
  issuedAt: Date | string;
  issueType: string;
  lines: MaterialIssuePrintLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    wo: string;
    vendor: string;
    date: string;
    type: string;
    item: string;
    qty: string;
    uom: string;
    /** Subtitle prefix before issuer name (default: "Issued by"). */
    issuedBy?: string;
  };
}

export function buildMaterialIssuePrintHtml(
  opts: BuildMaterialIssuePrintHtmlOptions
): string {
  const {
    docNumber,
    woDocNumber,
    vendorName,
    issuedAt,
    issueType,
    lines,
    issuerName = 'Elorae ERP',
    labels,
  } = opts;

  const issuedByLabel = labels.issuedBy ?? 'Issued by';

  const rows = lines
    .map((line) => {
      const sub =
        line.itemSku != null && line.itemSku !== ''
          ? `<div class="line-sku">SKU: ${esc(line.itemSku)}</div>`
          : '';
      return `<tr>
        <td class="col-desc"><div class="line-name">${esc(line.itemName)}</div>${sub}</td>
        <td class="right">${Number(line.qty).toLocaleString()}</td>
        <td class="uom">${esc(line.uomCode)}</td>
      </tr>`;
    })
    .join('');

  const head = `<tr>
        <th>${esc(labels.item)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th>${esc(labels.uom)}</th>
      </tr>`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(docNumber)}</title>
  <style>
${printCssBase}
${printPagePortrait}
  </style>
</head>
<body>
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(issuedByLabel)} ${esc(issuerName)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.doc)}</span>
      <span class="val">${esc(docNumber)}</span>
      <span class="lbl">${esc(labels.date)}</span>
      <span class="val">${esc(fmtDocDate(issuedAt))}</span>
    </div>
  </div>

  <div class="two-col">
    <div>
      <p class="block-label">${esc(labels.vendor)}</p>
      <p class="payee-name">${esc(vendorName)}</p>
    </div>
    <div>
      <div class="meta-grid">
        <div class="meta-row"><span class="mk">${esc(labels.wo)}</span><span class="mv">${esc(woDocNumber)}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.type)}</span><span class="mv">${esc(issueType)}</span></div>
      </div>
    </div>
  </div>

  <table class="data">
    <thead>${head}</thead>
    <tbody>${rows}</tbody>
  </table>

</body>
</html>`;
}
