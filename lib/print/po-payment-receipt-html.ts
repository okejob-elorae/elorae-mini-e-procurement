/**
 * Payment receipt for a PO marked paid — uses shared print theme (po-payment-receipt visual language).
 */

import { esc, fmtDocDate, money, printCssBase, printPagePortrait } from '@/lib/print/print-theme';

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
  labels: {
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
}

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
    issuerName = 'Elorae ERP',
    labels,
  } = opts;

  const amountStr = money(currency, amountPaid);

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
      <span class="val">${esc(fmtDocDate(paidAt))}</span>
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
        <div class="meta-row"><span class="mk">${esc(labels.printed)}</span><span class="mv">${esc(fmtDocDate(printedAt))}</span></div>
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
