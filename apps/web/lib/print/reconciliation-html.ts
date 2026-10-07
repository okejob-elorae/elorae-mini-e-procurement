/**
 * Work order reconciliation print — shared print theme (landscape).
 */

import { esc, printCssBase, printPageLandscape } from '@/lib/print/print-theme';
import { formatRupiah } from '@/lib/format/rupiah';
import { persenBertanda, qtyBahan, statusTampilRekon, type StatusTampilRekon } from '@/lib/production/rekonsiliasi-tampil';

/** Rupiah bertanda: "+Rp 3.031.250" / "-Rp 200". */
const rupiahBertanda = (n: number) => (n > 0 ? `+${formatRupiah(n)}` : formatRupiah(n));

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
  /** null = belum ada pemakaian. */
  efficiencyPercent: number | null;
  lines: ReconLine[];
  issuerName?: string;
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
    wo?: string;
    date?: string;
    issuedBy?: string;
    material?: string;
    /** Label status per baris (sudah diterjemahkan). */
    statusLabels?: Partial<Record<StatusTampilRekon, string>>;
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
    issuerName = 'Elorae ERP',
    labels,
  } = opts;

  const woLabel = labels.wo ?? 'Work order';
  const dateLabel = labels.date ?? 'Date';
  const issuedByLabel = labels.issuedBy ?? 'Issued by';

  const varianceClass =
    summary.netVarianceValue > 0
      ? 'color:#b45309'
      : summary.netVarianceValue < 0
        ? 'color:#166534'
        : 'color:var(--ink)';

  const badgeClass = (s: StatusTampilRekon) =>
    s === 'OK' ? 'badge badge-ok' : s === 'OVER' ? 'badge badge-over' : 'badge badge-under';

  const rows = lines
    .map((line) => {
      const statusTampil = statusTampilRekon(line);
      const rowClass = statusTampil === 'OVER' ? 'row-over' : '';
      return `<tr class="${rowClass}">
        <td class="col-desc"><div class="line-name">${esc(line.itemName)}</div>${
          line.itemSku
            ? `<div class="line-sku">${esc(line.itemSku)}</div>`
            : ''
        }</td>
        <td class="right">${qtyBahan(line.plannedQty)} ${esc(line.uomCode)}</td>
        <td class="right">${qtyBahan(line.issuedQty)} ${esc(line.uomCode)}</td>
        <td class="right">${qtyBahan(line.returnedQty)} ${esc(line.uomCode)}</td>
        <td class="right">${qtyBahan(line.actualUsed)} ${esc(line.uomCode)}</td>
        <td class="right">${qtyBahan(line.theoreticalUsage)} ${esc(line.uomCode)}</td>
        <td class="right">${line.variance > 0 ? '+' : ''}${qtyBahan(line.variance)} ${esc(line.uomCode)}</td>
        <td class="right">${persenBertanda(line.variancePercent)}</td>
        <td class="right">${esc(rupiahBertanda(line.varianceValue))}</td>
        <td class="center"><span class="${badgeClass(statusTampil)}">${esc(labels.statusLabels?.[statusTampil] ?? statusTampil)}</span></td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(docNumber)}</title>
  <style>
${printCssBase}
    table.data.recon { font-size: 8pt; table-layout: fixed; }
    table.data.recon thead th { font-size: 7pt; letter-spacing: 0.06em; }
    table.data.recon tbody td { font-size: 8pt; padding: 6px 6px 6px 0; }
${printPageLandscape}
  </style>
</head>
<body>
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(issuedByLabel)} ${esc(issuerName)}</p>
      ${subtitle ? `<p class="doc-sub" style="margin-top:6px;font-style:normal;color:#374151">${esc(subtitle)}</p>` : ''}
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(woLabel)}</span>
      <span class="val">${esc(docNumber)}</span>
      <span class="lbl">${esc(dateLabel)}</span>
      <span class="val">${esc(printDate)}</span>
    </div>
  </div>

  <div class="stat-cards">
    <div class="stat-card">
      <div class="sk">${esc(labels.totalMaterialCost)}</div>
      <div class="sv">${esc(formatRupiah(summary.totalUsedValue))}</div>
    </div>
    <div class="stat-card">
      <div class="sk">${esc(labels.efficiencyPct)}</div>
      <div class="sv">${efficiencyPercent == null ? '—' : esc(`${efficiencyPercent.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`)}</div>
      <p class="sh">${esc(labels.usedVsIssued)}</p>
    </div>
    <div class="stat-card">
      <div class="sk">${esc(labels.costVariance)}</div>
      <div class="sv" style="${varianceClass}">${esc(rupiahBertanda(summary.netVarianceValue))}</div>
    </div>
  </div>

  <h2 class="section-title">${esc(labels.varianceByMaterial)}</h2>
  <p class="section-desc">${esc(labels.varianceByMaterialDesc)}</p>
  <table class="data recon">
    <colgroup>
      <col style="width:18%"><col style="width:9%"><col style="width:9%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:9%"><col style="width:6%"><col style="width:9%"><col style="width:14%">
    </colgroup>
    <thead>
      <tr>
        <th>${esc(labels.material ?? 'Bahan')}</th>
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
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}
