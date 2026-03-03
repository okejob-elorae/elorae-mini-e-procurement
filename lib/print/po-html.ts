/**
 * Builds a full HTML document string for printing a Purchase Order.
 * Written into an iframe's document for same-tab print without opening a new tab.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type POPrintLine = {
  itemName: string;
  itemSku?: string;
  qty: number;
  uomCode: string;
  price: number;
  amount: number;
};

export interface BuildPOPrintHtmlOptions {
  docNumber: string;
  supplierName: string;
  supplierAddress?: string | null;
  status: string;
  etaDate?: Date | string | null;
  paymentDueDate?: Date | string | null;
  currency: string;
  subtotal: number;
  taxAmount: number;
  grandTotal: number;
  notes?: string | null;
  terms?: string | null;
  lines: POPrintLine[];
  labels: {
    title: string;
    doc: string;
    supplier: string;
    address: string;
    status: string;
    etaDate: string;
    paymentDue: string;
    item: string;
    qty: string;
    uom: string;
    price: string;
    amount: string;
    subtotal: string;
    tax: string;
    grandTotal: string;
    notes: string;
    terms: string;
  };
}

export function buildPOPrintHtml(opts: BuildPOPrintHtmlOptions): string {
  const {
    docNumber,
    supplierName,
    supplierAddress,
    status,
    etaDate,
    paymentDueDate,
    currency,
    subtotal,
    taxAmount,
    grandTotal,
    notes,
    terms,
    lines,
    labels,
  } = opts;

  const etaStr =
    etaDate instanceof Date
      ? etaDate.toLocaleDateString('id-ID')
      : etaDate
        ? new Date(etaDate).toLocaleDateString('id-ID')
        : '';
  const dueStr =
    paymentDueDate instanceof Date
      ? paymentDueDate.toLocaleDateString('id-ID')
      : paymentDueDate
        ? new Date(paymentDueDate).toLocaleDateString('id-ID')
        : '';

  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.itemName)}${line.itemSku ? ` <span style="color:#6b7280">(${esc(line.itemSku)})</span>` : ''}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(line.qty).toLocaleString()}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.uomCode)}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(line.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(line.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
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
    .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #9ca3af; }
    .header h1 { margin: 0 0 4px; font-size: 18px; font-weight: 700; }
    .meta { display: grid; gap: 4px; font-size: 13px; }
    .meta p { margin: 0; }
    .meta .label { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11pt; }
    thead th { padding: 8px 10px; border: 1px solid #374151; background: #e5e7eb; font-weight: 700; text-align: left; }
    thead th.right { text-align: right; }
    .totals { margin-top: 16px; text-align: right; font-size: 12pt; }
    .totals p { margin: 4px 0; }
    .totals .grand { font-size: 14pt; font-weight: 700; margin-top: 8px; }
    .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #d1d5db; font-size: 10pt; color: #6b7280; }
    @media print {
      body { padding: 16px; }
      @page { size: A4; margin: 15mm; }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>${esc(labels.title)}</h1>
    <div class="meta">
      <p><span class="label">${esc(labels.doc)}:</span> ${esc(docNumber)}</p>
      <p><span class="label">${esc(labels.supplier)}:</span> ${esc(supplierName)}</p>
      ${supplierAddress ? `<p><span class="label">${esc(labels.address)}:</span> ${esc(supplierAddress)}</p>` : ''}
      <p><span class="label">${esc(labels.status)}:</span> ${esc(status)}</p>
      ${etaStr ? `<p><span class="label">${esc(labels.etaDate)}:</span> ${esc(etaStr)}</p>` : ''}
      ${dueStr ? `<p><span class="label">${esc(labels.paymentDue)}:</span> ${esc(dueStr)}</p>` : ''}
    </div>
  </header>
  <table>
    <thead>
      <tr>
        <th>${esc(labels.item)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th>${esc(labels.uom)}</th>
        <th class="right">${esc(labels.price)}</th>
        <th class="right">${esc(labels.amount)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <div class="totals">
    <p><span class="label">${esc(labels.subtotal)}:</span> ${currency} ${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
    <p><span class="label">${esc(labels.tax)}:</span> ${currency} ${taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
    <p class="grand">${esc(labels.grandTotal)}: ${currency} ${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
  </div>
  ${notes ? `<div class="footer"><p><strong>${esc(labels.notes)}:</strong> ${esc(notes)}</p></div>` : ''}
  ${terms ? `<div class="footer"><p><strong>${esc(labels.terms)}:</strong> ${esc(terms)}</p></div>` : ''}
</body>
</html>`;
}
