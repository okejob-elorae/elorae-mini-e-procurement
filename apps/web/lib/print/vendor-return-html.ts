/**
 * Vendor Return (Nota Retur) — shared print theme.
 */

import {
  esc,
  fmtDocDateTime,
  printCssBase,
  printPagePortrait,
} from '@/lib/print/print-theme';

export type VendorReturnPrintLine = {
  type: string;
  itemId: string;
  itemName?: string;
  rollRef?: string;
  qty: number;
  reason: string;
  condition: string;
  costValue?: number;
};

export interface BuildVendorReturnPrintHtmlOptions {
  docNumber: string;
  vendorName: string;
  totalValue: number;
  status: string;
  woDocNumber?: string;
  processedAt?: Date | string | null;
  completedAt?: Date | string | null;
  trackingNumber?: string | null;
  lines: VendorReturnPrintLine[];
  issuerName?: string;
  labels: {
    title: string;
    doc: string;
    vendor: string;
    totalValue: string;
    workOrder: string;
    processed: string;
    completed: string;
    tracking: string;
    type: string;
    item: string;
    qty: string;
    condition: string;
    reason: string;
    value: string;
    /** Label for status row (default "Status"). */
    status?: string;
    issuedBy?: string;
  };
}

export function buildVendorReturnPrintHtml(
  opts: BuildVendorReturnPrintHtmlOptions
): string {
  const {
    docNumber,
    vendorName,
    totalValue,
    status,
    woDocNumber,
    processedAt,
    completedAt,
    trackingNumber,
    lines,
    issuerName = 'Elorae ERP',
    labels,
  } = opts;

  const issuedByLabel = labels.issuedBy ?? 'Issued by';
  const statusLabel = labels.status ?? 'Status';

  const itemDisplay = (line: VendorReturnPrintLine) => {
    const name = line.itemName ?? line.itemId;
    if (line.type === 'FABRIC' && line.rollRef) return `${name} – ${line.rollRef} (${line.qty})`;
    if (line.type === 'FG_REJECT') return `${name} — Source: Reject stock`;
    return name;
  };

  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td class="uom">${esc(line.type)}</td>
          <td class="col-desc"><div class="line-name">${esc(itemDisplay(line))}</div></td>
          <td class="right">${Number(line.qty).toLocaleString()}</td>
          <td>${esc(line.condition)}</td>
          <td>${esc(line.reason)}</td>
          <td class="right">${(line.costValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        </tr>`
    )
    .join('');

  const metaRows: string[] = [
    `<div class="meta-row"><span class="mk">${esc(statusLabel)}</span><span class="mv">${esc(status)}</span></div>`,
  ];
  if (woDocNumber) {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.workOrder)}</span><span class="mv">${esc(woDocNumber)}</span></div>`
    );
  }
  if (processedAt != null && processedAt !== '') {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.processed)}</span><span class="mv">${esc(fmtDocDateTime(processedAt))}</span></div>`
    );
  }
  if (completedAt != null && completedAt !== '') {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.completed)}</span><span class="mv">${esc(fmtDocDateTime(completedAt))}</span></div>`
    );
  }
  if (trackingNumber?.trim()) {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.tracking)}</span><span class="mv">${esc(trackingNumber.trim())}</span></div>`
    );
  }

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
    </div>
  </div>

  <div class="two-col">
    <div>
      <p class="block-label">${esc(labels.vendor)}</p>
      <p class="payee-name">${esc(vendorName)}</p>
    </div>
    <div>
      <div class="meta-grid">${metaRows.join('')}</div>
    </div>
  </div>

  <div class="totals-wrap">
    <div class="totals">
      <div class="grand-row">
        <span class="gk">${esc(labels.totalValue)}</span>
        <span class="gv">Rp ${Number(totalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>

  <table class="data">
    <thead>
      <tr>
        <th>${esc(labels.type)}</th>
        <th>${esc(labels.item)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th>${esc(labels.condition)}</th>
        <th>${esc(labels.reason)}</th>
        <th class="right">${esc(labels.value)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
