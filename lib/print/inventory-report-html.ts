/**
 * Inventory Report snapshot — shared print theme (landscape for wide grid).
 */

import {
  esc,
  fmtDocDate,
  fmtDocDateTime,
  printCssBase,
  printPageLandscape,
} from '@/lib/print/print-theme';

export type InventoryReportDetail = {
  sku: string;
  name: string;
  type: string;
  uomCode: string;
  qtyOnHand: number;
  avgCost: number;
  totalValue: number;
  percentageOfTotal: number;
};

export interface BuildInventoryReportPrintHtmlOptions {
  generatedAt: Date;
  asOfDate: Date;
  summary: {
    totalItems: number;
    totalSKUs: number;
    totalQuantity: number;
    totalValue: number;
    avgValuePerItem: number;
  };
  details: InventoryReportDetail[];
  lowStockAlerts: Array<{ sku: string; name: string; qtyOnHand: number; reorderPoint: number }>;
  issuerName?: string;
  labels?: {
    title?: string;
    asOf?: string;
    generated?: string;
    sku?: string;
    name?: string;
    type?: string;
    uom?: string;
    qty?: string;
    avgCost?: string;
    totalValue?: string;
    pct?: string;
    summary?: string;
    lowStock?: string;
    items?: string;
    totalQty?: string;
    reorderPoint?: string;
    issuedBy?: string;
  };
}

export function buildInventoryReportPrintHtml(
  opts: BuildInventoryReportPrintHtmlOptions
): string {
  const {
    generatedAt,
    asOfDate,
    summary,
    details,
    lowStockAlerts,
    issuerName = 'Elorae ERP',
    labels: customLabels = {},
  } = opts;

  const labels = {
    title: customLabels.title ?? 'Inventory Report',
    asOf: customLabels.asOf ?? 'As of',
    generated: customLabels.generated ?? 'Generated',
    sku: customLabels.sku ?? 'SKU',
    name: customLabels.name ?? 'Name',
    type: customLabels.type ?? 'Type',
    uom: customLabels.uom ?? 'UOM',
    qty: customLabels.qty ?? 'Qty',
    avgCost: customLabels.avgCost ?? 'Avg Cost',
    totalValue: customLabels.totalValue ?? 'Total Value',
    pct: customLabels.pct ?? '%',
    summary: customLabels.summary ?? 'Summary',
    lowStock: customLabels.lowStock ?? 'Low Stock Alerts',
    items: customLabels.items ?? 'Items',
    totalQty: customLabels.totalQty ?? 'Total Qty',
    reorderPoint: customLabels.reorderPoint ?? 'Reorder Point',
    issuedBy: customLabels.issuedBy ?? 'Issued by',
  };

  const rows = details
    .map(
      (d) =>
        `<tr>
          <td class="uom">${esc(d.sku)}</td>
          <td>${esc(d.name)}</td>
          <td>${esc(d.type)}</td>
          <td class="uom">${esc(d.uomCode)}</td>
          <td class="right">${Number(d.qtyOnHand).toLocaleString()}</td>
          <td class="right">${Number(d.avgCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td class="right">${Number(d.totalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td class="right">${Number(d.percentageOfTotal).toFixed(2)}%</td>
        </tr>`
    )
    .join('');

  const lowStockRows =
    lowStockAlerts.length > 0
      ? lowStockAlerts
          .map(
            (a) =>
              `<tr>
                <td class="uom">${esc(a.sku)}</td>
                <td>${esc(a.name)}</td>
                <td class="right">${Number(a.qtyOnHand).toLocaleString()}</td>
                <td class="right">${Number(a.reorderPoint).toLocaleString()}</td>
              </tr>`
          )
          .join('')
      : '';

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)}</title>
  <style>
${printCssBase}
${printPageLandscape}
  </style>
</head>
<body>
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.asOf)}</span>
      <span class="val">${esc(fmtDocDate(asOfDate))}</span>
      <span class="lbl">${esc(labels.generated)}</span>
      <span class="val">${esc(fmtDocDateTime(generatedAt))}</span>
    </div>
  </div>

  <div class="summary-strip">
    <div>
      <div class="sk">${esc(labels.items)}</div>
      <div class="sv">${summary.totalItems}</div>
    </div>
    <div>
      <div class="sk">${esc(labels.totalQty)}</div>
      <div class="sv">${summary.totalQuantity.toLocaleString()}</div>
    </div>
    <div>
      <div class="sk">${esc(labels.totalValue)}</div>
      <div class="sv">Rp ${summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
    </div>
  </div>

  <h2 class="section-title">${esc(labels.summary)}</h2>
  <table class="data">
    <thead>
      <tr>
        <th>${esc(labels.sku)}</th>
        <th>${esc(labels.name)}</th>
        <th>${esc(labels.type)}</th>
        <th>${esc(labels.uom)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th class="right">${esc(labels.avgCost)}</th>
        <th class="right">${esc(labels.totalValue)}</th>
        <th class="right">${esc(labels.pct)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  ${
    lowStockAlerts.length > 0
      ? `
  <h2 class="section-title">${esc(labels.lowStock)}</h2>
  <table class="data">
    <thead>
      <tr>
        <th>${esc(labels.sku)}</th>
        <th>${esc(labels.name)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th class="right">${esc(labels.reorderPoint)}</th>
      </tr>
    </thead>
    <tbody>${lowStockRows}</tbody>
  </table>`
      : ''
  }
</body>
</html>`;
}
