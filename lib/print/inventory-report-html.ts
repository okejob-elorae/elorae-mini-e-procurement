/**
 * Builds a full HTML document string for printing the Inventory Report (snapshot).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  };

  const generatedStr = generatedAt.toLocaleString('id-ID');
  const asOfStr = asOfDate.toLocaleDateString('id-ID');

  const rows = details
    .map(
      (d) =>
        `<tr>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(d.sku)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(d.name)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(d.type)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(d.uomCode)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(d.qtyOnHand).toLocaleString()}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(d.avgCost).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(d.totalValue).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(d.percentageOfTotal).toFixed(2)}%</td>
        </tr>`
    )
    .join('');

  const lowStockRows =
    lowStockAlerts.length > 0
      ? lowStockAlerts
          .map(
            (a) =>
              `<tr>
                <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(a.sku)}</td>
                <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(a.name)}</td>
                <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(a.qtyOnHand).toLocaleString()}</td>
                <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(a.reorderPoint).toLocaleString()}</td>
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
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #fff; color: #000; font-family: system-ui, sans-serif; font-size: 10pt; }
    .header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #9ca3af; }
    .header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    .meta { font-size: 12px; color: #6b7280; }
    .summary { margin: 16px 0; padding: 12px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; display: grid; grid-template-columns: auto auto auto; gap: 8px 24px; }
    .summary p { margin: 0; font-size: 12px; }
    .summary .label { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 10pt; }
    thead th { padding: 6px 8px; border: 1px solid #374151; background: #e5e7eb; font-weight: 700; text-align: left; }
    thead th.right { text-align: right; }
    h2 { font-size: 14px; margin: 20px 0 8px; }
    @media print {
      body { padding: 16px; }
      @page { size: A4 landscape; margin: 12mm; }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>${esc(labels.title)}</h1>
    <p class="meta">${esc(labels.asOf)}: ${esc(asOfStr)} | ${esc(labels.generated)}: ${esc(generatedStr)}</p>
  </header>
  <div class="summary">
    <p><span class="label">Items:</span> ${summary.totalItems}</p>
    <p><span class="label">Total Qty:</span> ${summary.totalQuantity.toLocaleString()}</p>
    <p><span class="label">Total Value:</span> Rp ${summary.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
  </div>
  <table>
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
    <tbody>
      ${rows}
    </tbody>
  </table>
  ${lowStockAlerts.length > 0 ? `
  <h2>${esc(labels.lowStock)}</h2>
  <table>
    <thead>
      <tr>
        <th>${esc(labels.sku)}</th>
        <th>${esc(labels.name)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th class="right">Reorder Point</th>
      </tr>
    </thead>
    <tbody>
      ${lowStockRows}
    </tbody>
  </table>
  ` : ''}
</body>
</html>`;
}
