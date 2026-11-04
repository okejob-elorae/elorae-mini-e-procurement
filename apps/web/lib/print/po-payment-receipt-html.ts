/**
 * Bukti bayar PO yang ditandai lunas — tema cetak bersama. Label, angka, dan
 * tanggal berbahasa Indonesia (WIB); label bawaan `LABEL_BUKTI_BAYAR_PO`.
 */

import { esc, printCssBase, printPagePortrait } from '@/lib/print/print-theme';
import { tanggalCetak, uangCetak } from '@/lib/print/po-html';

export interface BuildPOPaymentReceiptHtmlOptions {
  receiptNumber: string;
  poDocNumber: string;
  supplierName: string;
  supplierCode: string;
  supplierAddress?: string | null;
  paidAt: Date | string;
  printedAt: Date | string;
  currency: string;
  amountPaid: number;
  issuerName?: string;
  labels?: LabelBuktiBayarPo;
}

export type LabelBuktiBayarPo = {
    title: string;
    issuedBy: string;
    receiptNo: string;
    paymentDate: string;
    payee: string;
    supplierCode: string;
    poRef: string;
    status: string;
    statusPaid: string;
    printed: string;
    grandLabel: string;
    footerTitle: string;
    footerNote: string;
};

export const LABEL_BUKTI_BAYAR_PO: LabelBuktiBayarPo = {
  title: 'Bukti Pembayaran',
  issuedBy: 'Diterbitkan oleh',
  receiptNo: 'No. bukti',
  paymentDate: 'Tanggal bayar',
  payee: 'Dibayarkan kepada',
  supplierCode: 'Kode',
  poRef: 'Referensi PO',
  status: 'Status',
  statusPaid: 'Lunas',
  printed: 'Dicetak',
  grandLabel: 'Jumlah dibayar',
  footerTitle: 'Catatan',
  footerNote: 'Bukti ini mengikuti status pembayaran yang tercatat di Eloraé. Simpan untuk arsip Anda.',
};

export function buildPOPaymentReceiptHtml(
  opts: BuildPOPaymentReceiptHtmlOptions
): string {
  const {
    receiptNumber,
    poDocNumber,
    supplierName,
    supplierCode,
    supplierAddress,
    paidAt,
    printedAt,
    currency,
    amountPaid,
    issuerName = 'Eloraé',
    labels = LABEL_BUKTI_BAYAR_PO,
  } = opts;

  const amountStr = uangCetak(currency, amountPaid);

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(receiptNumber)}</title>
  <style>
${printCssBase}
${printPagePortrait}
  </style>
</head>
<body>
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.receiptNo)}</span>
      <span class="val">${esc(receiptNumber)}</span>
      <span class="lbl">${esc(labels.paymentDate)}</span>
      <span class="val">${esc(tanggalCetak(paidAt) || '—')}</span>
    </div>
  </div>

  <div class="two-col">
    <div>
      <p class="block-label">${esc(labels.payee)}</p>
      <p class="payee-name">${esc(supplierName)}</p>
      ${supplierAddress?.trim() ? `<p class="payee-addr">${esc(supplierAddress.trim())}</p>` : ''}
      <p class="code-line">${esc(labels.supplierCode)} ${esc(supplierCode)}</p>
    </div>
    <div>
      <div class="meta-grid">
        <div class="meta-row"><span class="mk">${esc(labels.poRef)}</span><span class="mv">${esc(poDocNumber)}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.status)}</span><span class="mv">${esc(labels.statusPaid)}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.printed)}</span><span class="mv">${esc(tanggalCetak(printedAt) || '—')}</span></div>
      </div>
    </div>
  </div>

  <div class="totals-wrap">
    <div class="totals">
      <div class="grand-row">
        <span class="gk">${esc(labels.grandLabel)}</span>
        <span class="gv">${esc(amountStr)}</span>
      </div>
    </div>
  </div>

  <section class="legal">
    <h2 class="legal-title">${esc(labels.footerTitle)}</h2>
    <p class="legal-body">${esc(labels.footerNote)}</p>
  </section>
</body>
</html>`;
}
