/**
 * Builds a full HTML document string for printing a Material Issue (Nota ke CMT).
 * Written into an iframe's document for same-tab print without opening a new tab.
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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
  totalCost: number;
  lines: MaterialIssuePrintLine[];
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
    totalCost: string;
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
    labels,
  } = opts;

  const dateStr =
    issuedAt instanceof Date
      ? issuedAt.toLocaleDateString('id-ID')
      : new Date(issuedAt).toLocaleDateString('id-ID');

  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.itemName)}${line.itemSku ? ` <span style="color:#6b7280">(${esc(line.itemSku)})</span>` : ''}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${Number(line.qty).toLocaleString()}</td>
          <td style="border:1px solid #d1d5db;padding:6px 8px;color:#000">${esc(line.uomCode)}</td>
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
    .header h1 { margin: 0 0 12px; font-size: 18px; font-weight: 700; }
    .meta { display: grid; gap: 4px; font-size: 13px; }
    .meta p { margin: 0; }
    .meta span.label { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 11pt; }
    thead th { padding: 8px 10px; border: 1px solid #374151; background: #e5e7eb; font-weight: 700; text-align: left; }
    thead th.right { text-align: right; }
    .total { margin-top: 12px; font-size: 14px; font-weight: 600; }
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
    <div class="meta">
      <p><span class="label">${esc(labels.doc)}:</span> ${esc(docNumber)}</p>
      <p><span class="label">${esc(labels.wo)}:</span> ${esc(woDocNumber)}</p>
      <p><span class="label">${esc(labels.vendor)}:</span> ${esc(vendorName)}</p>
      <p><span class="label">${esc(labels.date)}:</span> ${esc(dateStr)}</p>
      <p><span class="label">${esc(labels.type)}:</span> ${esc(issueType)}</p>
    </div>
  </header>
  <table>
    <thead>
      <tr>
        <th>${esc(labels.item)}</th>
        <th class="right">${esc(labels.qty)}</th>
        <th>${esc(labels.uom)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p class="total">${esc(labels.totalCost)}: ${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
</body>
</html>`;
}
