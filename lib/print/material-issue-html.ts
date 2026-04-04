/**
 * Material Issue (Nota ke CMT) — shared print theme.
 */

import { esc, fmtDocDate, printCssBase, printPagePortrait } from '@/lib/print/print-theme';

export type MaterialIssuePrintLine = {
  itemName: string;
  itemSku?: string;
  qty: number;
  uomCode: string;
  unitPrice?: number;
  lineTotal?: number;
};

export interface BuildMaterialIssuePrintHtmlOptions {
  docNumber: string;
  woDocNumber: string;
  vendorName: string;
  issuedAt: Date | string;
  issueType: string;
  totalCost: number;
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
    unitPrice?: string;
    lineTotal?: string;
    totalCost: string;
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
    totalCost,
    lines,
    issuerName = 'Elorae ERP',
    labels,
  } = opts;

  const issuedByLabel = labels.issuedBy ?? 'Issued by';

  const hasPrice = lines.some((l) => l.unitPrice != null || l.lineTotal != null);
  const priceLabel = labels.unitPrice ?? 'Unit Price';
  const lineTotalLabel = labels.lineTotal ?? 'Line Total';

  const rows = lines
    .map((line) => {
      const sub =
        line.itemSku != null && line.itemSku !== ''
          ? `<div class="line-sku">SKU: ${esc(line.itemSku)}</div>`
          : '';
      const priceCells = hasPrice
        ? `<td class="right">${line.unitPrice != null ? Number(line.unitPrice).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>
          <td class="right">${line.lineTotal != null ? Number(line.lineTotal).toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}</td>`
        : '';
      return `<tr>
        <td class="col-desc"><div class="line-name">${esc(line.itemName)}</div>${sub}</td>
        <td class="right">${Number(line.qty).toLocaleString()}</td>
        <td class="uom">${esc(line.uomCode)}</td>${priceCells}
      </tr>`;
    })
    .join('');

  const head = hasPrice
    ? `<tr>
        <th>${esc(labels.item)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th>${esc(labels.uom)}</th>
        <th class="right">${esc(priceLabel)}</th>
        <th class="right">${esc(lineTotalLabel)}</th>
      </tr>`
    : `<tr>
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

  <div class="totals-wrap">
    <div class="totals">
      <div class="grand-row">
        <span class="gk">${esc(labels.totalCost)}</span>
        <span class="gv">${Number(totalCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>
</body>
</html>`;
}
