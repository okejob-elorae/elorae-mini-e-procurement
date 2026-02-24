/**
 * Builds a full HTML document string for printing the work order reconciliation.
 * Written into an iframe's document to avoid loading Next.js in the iframe (no 404s).
 */

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type ReconLine = {
  itemId: string;
  itemName: string;
  itemSku: string;
  uomCode: string;
  plannedQty: number;
  issuedQty: number;
  returnedQty: number;
  actualUsed: number;
  theoreticalUsage: number;
  variance: number;
  variancePercent: number;
  varianceValue: number;
  status: 'OK' | 'OVER' | 'UNDER';
};

export type ReconSummary = {
  totalIssuedValue: number;
  totalUsedValue: number;
  netVarianceValue: number;
};

export interface BuildReconciliationPrintHtmlOptions {
  docNumber: string;
  printDate: string;
  subtitle?: string;
  summary: ReconSummary;
  efficiencyPercent: number;
  lines: ReconLine[];
  labels: {
    title: string;
    targetCutting: string;
    issuedToCmt: string;
    returned: string;
    setoran: string;
    theoretical: string;
    selisih: string;
    value: string;
    status: string;
    varianceByMaterial: string;
    varianceByMaterialDesc: string;
    totalMaterialCost: string;
    efficiencyPct: string;
    costVariance: string;
    usedVsIssued: string;
  };
}

export function buildReconciliationPrintHtml(
  opts: BuildReconciliationPrintHtmlOptions
): string {
  const {
    docNumber,
    printDate,
    subtitle,
    summary,
    efficiencyPercent,
    lines,
    labels,
  } = opts;

  const varianceClass =
    summary.netVarianceValue > 0
      ? 'color:#b45309'
      : summary.netVarianceValue < 0
        ? 'color:#166534'
        : 'color:#000';

  const rows = lines
    .map((line, i) => {
      const rowBg =
        line.status === 'OVER'
          ? 'background:#fef2f2'
          : line.status === 'UNDER'
            ? 'background:#f0fdf4'
            : i % 2 === 1
              ? 'background:#f9fafb'
              : '';
      const badgeStyle =
        line.status === 'OK'
          ? 'border:1px solid #4b5563;background:#e5e7eb;color:#111'
          : line.status === 'OVER'
            ? 'border:1px solid #991b1b;background:#fecaca;color:#7f1d1d'
            : 'border:1px solid #166534;background:#bbf7d0;color:#14532d';
      return `<tr style="${rowBg}">
        <td style="border:1px solid #d1d5db;padding:6px 8px;font-weight:500;color:#000">${esc(line.itemName)}${line.itemSku ? ` <span style="color:#4b5563">(${esc(line.itemSku)})</span>` : ''}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.plannedQty.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.issuedQty.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.returnedQty.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.actualUsed.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.theoreticalUsage.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.variance >= 0 ? '+' : ''}${line.variance.toLocaleString()} ${esc(line.uomCode)}</td>
        <td style="border:1px solid #d1d5db;padding:4px 8px;text-align:right;color:#000">${line.variancePercent >= 0 ? '+' : ''}${line.variancePercent.toFixed(1)}%</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:right;color:#000">${line.varianceValue >= 0 ? '+' : ''}${line.varianceValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td style="border:1px solid #d1d5db;padding:6px 8px;text-align:center"><span style="${badgeStyle};border-radius:4px;padding:2px 6px;font-size:8pt;font-weight:600">${esc(line.status)}</span></td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} - ${esc(docNumber)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 24px; background: #fff; color: #000; font-family: system-ui, sans-serif; font-size: 11pt; }
    .header { margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #9ca3af; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
    .header h1 { margin: 0; font-size: 18px; font-weight: 700; }
    .header .subtitle { margin: 4px 0 0; font-size: 14px; color: #374151; font-weight: 500; }
    .header .meta { text-align: right; font-size: 14px; color: #374151; font-weight: 500; }
    .header .meta p { margin: 0 0 2px; }
    .cards { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .card { border: 1px solid #d1d5db; border-radius: 6px; padding: 12px; background: #fff; }
    .card label { display: block; font-size: 10pt; font-weight: 600; color: #374151; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .card .value { font-size: 18px; font-weight: 700; color: #000; }
    .card .hint { font-size: 9pt; color: #6b7280; margin-top: 4px; }
    .table-section { break-inside: avoid; }
    .table-section h2 { margin: 0 0 4px; font-size: 12pt; font-weight: 600; }
    .table-section .desc { margin: 0 0 8px; font-size: 10pt; color: #4b5563; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9pt; }
    thead th { padding: 6px 8px; border: 1px solid #374151; background: #e5e7eb; font-weight: 700; text-align: left; }
    thead th.right { text-align: right; }
    thead th.center { text-align: center; }
    @media print {
      body { padding: 0; }
      @page { size: A4 landscape; margin: 12mm 10mm 18mm; }
      @page { @bottom-center { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #666; } }
      .print-badge { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <header class="header">
    <div>
      <h1>${esc(labels.title)}</h1>
      ${subtitle ? `<p class="subtitle">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="meta">
      <p>${esc(docNumber)}</p>
      <p>${esc(printDate)}</p>
    </div>
  </header>
  <div class="cards">
    <div class="card">
      <label>${esc(labels.totalMaterialCost)}</label>
      <div class="value">${summary.totalUsedValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
    </div>
    <div class="card">
      <label>${esc(labels.efficiencyPct)}</label>
      <div class="value">${efficiencyPercent.toFixed(1)}%</div>
      <div class="hint">${esc(labels.usedVsIssued)}</div>
    </div>
    <div class="card">
      <label>${esc(labels.costVariance)}</label>
      <div class="value" style="${varianceClass}">${summary.netVarianceValue >= 0 ? '+' : ''}${summary.netVarianceValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
    </div>
  </div>
  <div class="table-section">
    <h2>${esc(labels.varianceByMaterial)}</h2>
    <p class="desc">${esc(labels.varianceByMaterialDesc)}</p>
    <table>
      <colgroup>
        <col style="width:24%"><col style="width:9%"><col style="width:9%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:5%"><col style="width:9%"><col style="width:10%">
      </colgroup>
      <thead>
        <tr>
          <th>Material</th>
          <th class="right">${esc(labels.targetCutting)}</th>
          <th class="right">${esc(labels.issuedToCmt)}</th>
          <th class="right">${esc(labels.returned)}</th>
          <th class="right">${esc(labels.setoran)}</th>
          <th class="right">${esc(labels.theoretical)}</th>
          <th class="right">${esc(labels.selisih)}</th>
          <th class="right">%</th>
          <th class="right">${esc(labels.value)}</th>
          <th class="center">${esc(labels.status)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}
