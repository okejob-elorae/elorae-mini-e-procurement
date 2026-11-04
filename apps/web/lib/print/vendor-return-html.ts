/**
 * Nota retur ke pemasok — tema cetak bersama. Label, kode jenis/kondisi/status,
 * angka, dan tanggal berbahasa Indonesia (WIB); label bawaan `LABEL_CETAK_RETUR`.
 */

import { esc, printCssBase, printPagePortrait } from '@/lib/print/print-theme';
import { uangCetak } from '@/lib/print/po-html';

/** "6 Okt 2026, 00.30" (WIB). */
function waktuCetak(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(x);
}

const JENIS_RETUR: Record<string, string> = { FABRIC: 'Kain', ACCESSORIES: 'Aksesoris', FG_REJECT: 'Barang jadi reject' };
const KONDISI_RETUR: Record<string, string> = { GOOD: 'Baik', DAMAGED: 'Rusak', DEFECTIVE: 'Cacat' };
const STATUS_RETUR: Record<string, string> = { DRAFT: 'Draf', PROCESSED: 'Diproses', COMPLETED: 'Selesai' };

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
  /** PO yang utangnya dikurangi retur ini. */
  poDocNumber?: string | null;
  processedAt?: Date | string | null;
  completedAt?: Date | string | null;
  trackingNumber?: string | null;
  lines: VendorReturnPrintLine[];
  issuerName?: string;
  labels?: LabelCetakRetur;
}

export type LabelCetakRetur = {
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
    /** Label baris status (bawaan "Status"). */
    status?: string;
    issuedBy?: string;
    po?: string;
};

export const LABEL_CETAK_RETUR: LabelCetakRetur = {
  title: 'Nota Retur',
  doc: 'No. dokumen',
  vendor: 'Pemasok',
  totalValue: 'Nilai retur',
  workOrder: 'Perintah kerja',
  processed: 'Diproses',
  completed: 'Selesai',
  tracking: 'Resi',
  type: 'Jenis',
  item: 'Barang',
  qty: 'Qty',
  condition: 'Kondisi',
  reason: 'Alasan',
  value: 'Nilai',
  status: 'Status',
  issuedBy: 'Diterbitkan oleh',
  po: 'Mengurangi utang PO',
};

export function buildVendorReturnPrintHtml(
  opts: BuildVendorReturnPrintHtmlOptions
): string {
  const {
    docNumber,
    vendorName,
    totalValue,
    status,
    woDocNumber,
    poDocNumber,
    processedAt,
    completedAt,
    trackingNumber,
    lines,
    issuerName = 'Eloraé',
    labels = LABEL_CETAK_RETUR,
  } = opts;

  const issuedByLabel = labels.issuedBy ?? LABEL_CETAK_RETUR.issuedBy ?? '';
  const statusLabel = labels.status ?? 'Status';

  const itemDisplay = (line: VendorReturnPrintLine) => {
    const name = line.itemName ?? line.itemId;
    if (line.type === 'FABRIC' && line.rollRef) return `${name} – ${line.rollRef} (${line.qty})`;
    if (line.type === 'FG_REJECT') return `${name} — Sumber: stok reject`;
    return name;
  };

  const rows = lines
    .map(
      (line) =>
        `<tr>
          <td class="uom">${esc(JENIS_RETUR[line.type] ?? line.type)}</td>
          <td class="col-desc"><div class="line-name">${esc(itemDisplay(line))}</div></td>
          <td class="right">${Number(line.qty).toLocaleString('id-ID')}</td>
          <td>${esc(KONDISI_RETUR[line.condition] ?? line.condition)}</td>
          <td>${esc(line.reason)}</td>
          <td class="right">${esc(uangCetak('IDR', line.costValue ?? 0))}</td>
        </tr>`
    )
    .join('');

  const metaRows: string[] = [
    `<div class="meta-row"><span class="mk">${esc(statusLabel)}</span><span class="mv">${esc(STATUS_RETUR[status] ?? status)}</span></div>`,
  ];
  if (woDocNumber) {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.workOrder)}</span><span class="mv">${esc(woDocNumber)}</span></div>`
    );
  }
  if (poDocNumber) {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.po ?? LABEL_CETAK_RETUR.po ?? '')}</span><span class="mv">${esc(poDocNumber)}</span></div>`
    );
  }
  if (processedAt != null && processedAt !== '') {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.processed)}</span><span class="mv">${esc(waktuCetak(processedAt))}</span></div>`
    );
  }
  if (completedAt != null && completedAt !== '') {
    metaRows.push(
      `<div class="meta-row"><span class="mk">${esc(labels.completed)}</span><span class="mv">${esc(waktuCetak(completedAt))}</span></div>`
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
        <span class="gv">${esc(uangCetak('IDR', Number(totalValue)))}</span>
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
