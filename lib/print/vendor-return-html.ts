/**
 * Builds a full HTML document string for printing a Vendor Return (Nota Retur).
 * Written into an iframe's document for same-tab print without opening a new tab.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type VendorReturnPrintLine = {
  type: string;
  itemId: string;
  itemName?: string;
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
    labels,
  } = opts;

  const processedStr =
    processedAt instanceof Date
      ? processedAt.toLocaleString()
      : processedAt
        ? new Date(processedAt).toLocaleString()
        : '';
  const completedStr =
    completedAt instanceof Date
      ? completedAt.toLocaleString()
      : completedAt
        ? new Date(completedAt).toLocaleString()
        : '';

  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.type)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.itemName ?? line.itemId)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(line.qty).toLocaleString()}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.condition)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.reason)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${(line.costValue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        </tr>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} - ${esc(docNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #fff; color: #000; font-family: system-ui, sans-serif; font-size: 11pt; }
    .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #9ca3af; text-align: center; }
    .header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    .header .doc { font-size: 14px; color: #6b7280; }
    .summary { margin-bottom: 20px; padding: 16px; border: 1px solid #d1d5db; border-radius: 6px; background: #f9fafb; }
    .summary p { margin: 0 0 8px; font-size: 13px; }
    .summary p:last-child { margin-bottom: 0; }
    .summary .label { color: #6b7280; }
    .summary .total { font-size: 18px; font-weight: 700; margin: 8px 0 12px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11pt; }
    thead th { padding: 8px 10px; border: 1px solid #374151; background: #e5e7eb; font-weight: 700; text-align: left; }
    thead th.right { text-align: right; }
    @media print {
      body { padding: 16px; }
      @page { size: A4; margin: 15mm; }
      @page { @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #666; } }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>${esc(labels.title)}</h1>
    <p class="doc">${esc(docNumber)}</p>
  </header>
  <div class="summary">
    <p><span class="label">${esc(labels.vendor)}:</span> ${esc(vendorName)}</p>
    <p><span class="label">${esc(labels.totalValue)}:</span></p>
    <p class="total">Rp ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
    ${woDocNumber ? `<p><span class="label">${esc(labels.workOrder)}:</span> ${esc(woDocNumber)}</p>` : ''}
    <p><span class="label">Status:</span> ${esc(status)}</p>
    ${processedStr ? `<p><span class="label">${esc(labels.processed)}:</span> ${esc(processedStr)}</p>` : ''}
    ${completedStr ? `<p><span class="label">${esc(labels.completed)}:</span> ${esc(completedStr)}</p>` : ''}
    ${trackingNumber ? `<p><span class="label">${esc(labels.tracking)}:</span> ${esc(trackingNumber)}</p>` : ''}
  </div>
  <table>
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
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}
