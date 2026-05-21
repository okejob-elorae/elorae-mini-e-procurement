/**
 * Purchase Order / invoice print — shared theme with po-payment-receipt-html.ts.
 */

import {
  esc,
  fmtDocDate,
  money,
  printCssBase,
  printPagePortrait,
} from '@/lib/print/print-theme';

function fmtMetaDate(d: Date | string | null | undefined): string {
  if (d == null) return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleDateString('id-ID');
}

export type POPrintLine = {
  itemName: string;
  itemSku?: string;
  variantSku?: string | null;
  variantDetail?: string | null;
  lineNotes?: string | null;
  qty: number;
  uomCode: string;
  price: number;
  amount: number;
};

export interface BuildPOPrintHtmlOptions {
  docNumber: string;
  issuedAt?: Date | string | null;
  issuerName?: string;
  supplierName: string;
  supplierAddress?: string | null;
  supplierCode?: string | null;
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
    date: string;
    issuedBy: string;
    supplier: string;
    address: string;
    attn: string;
    status: string;
    etaDate: string;
    terms: string;
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
    termsFooter: string;
  };
}

export function buildPOPrintHtml(opts: BuildPOPrintHtmlOptions): string {
  const {
    docNumber,
    issuedAt,
    issuerName = 'Elorae ERP',
    supplierName,
    supplierAddress,
    supplierCode,
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

  const etaStr = fmtMetaDate(etaDate);
  const dueStr = fmtMetaDate(paymentDueDate);
  const termsShort =
    terms?.trim() != null && terms.trim() !== ''
      ? terms.trim().length > 56
        ? `${terms.trim().slice(0, 53)}…`
        : terms.trim()
      : '—';

  const rows = lines
    .map((line) => {
      const skuLine = line.itemSku
        ? `<div class="line-sku">SKU: ${esc(line.itemSku)}</div>`
        : '';
      const variantSkuLine = line.variantSku
        ? `<div class="line-meta">Variant SKU: ${esc(line.variantSku)}</div>`
        : '';
      const variantDetailLine = line.variantDetail
        ? `<div class="line-meta">${esc(line.variantDetail)}</div>`
        : '';
      const notesLine = line.lineNotes
        ? `<div class="line-meta">${esc(line.lineNotes)}</div>`
        : '';
      return `<tr>
        <td class="col-desc">
          <div class="line-name">${esc(line.itemName)}</div>
          ${skuLine}
          ${variantSkuLine}
          ${variantDetailLine}
          ${notesLine}
        </td>
        <td class="col-num">${Number(line.qty).toLocaleString()}</td>
        <td class="col-uom">${esc(line.uomCode)}</td>
        <td class="col-num">${Number(line.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
        <td class="col-num">${Number(line.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
      </tr>`;
    })
    .join('');

  const legalParts: string[] = [];
  if (terms?.trim()) {
    legalParts.push(`<p>${esc(terms.trim())}</p>`);
  }
  if (notes?.trim()) {
    legalParts.push(
      `<p><span class="legal-inline-label">${esc(labels.notes)}</span> ${esc(notes.trim())}</p>`
    );
  }
  const legalHtml =
    legalParts.length > 0
      ? `<section class="legal">
    <h2 class="legal-title">${esc(labels.termsFooter)}</h2>
    <div class="legal-body">${legalParts.join('')}</div>
  </section>`
      : '';

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
    <div class="doc-title-block">
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(labels.issuedBy)} ${esc(issuerName)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.doc)}</span>
      <span class="val">${esc(docNumber)}</span>
      <span class="lbl">${esc(labels.date)}</span>
      <span class="val">${esc(fmtDocDate(issuedAt))}</span>
    </div>
  </div>

  <div class="two-col">
    <div>
      <p class="block-label">${esc(labels.supplier)}</p>
      <p class="supplier-name">${esc(supplierName)}</p>
      ${supplierAddress?.trim() ? `<p class="supplier-addr">${esc(supplierAddress.trim())}</p>` : ''}
      ${supplierCode?.trim() ? `<p class="attn-line">${esc(labels.attn)} ${esc(supplierCode.trim())}</p>` : ''}
    </div>
    <div>
      <div class="meta-grid">
        <div class="meta-row"><span class="mk">${esc(labels.status)}</span><span class="mv">${esc(status)}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.etaDate)}</span><span class="mv">${esc(etaStr || '—')}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.terms)}</span><span class="mv">${esc(termsShort)}</span></div>
        <div class="meta-row"><span class="mk">${esc(labels.paymentDue)}</span><span class="mv">${esc(dueStr || '—')}</span></div>
      </div>
    </div>
  </div>

  <table class="lines">
    <thead>
      <tr>
        <th>${esc(labels.item)}</th>
        <th class="col-num-head">${esc(labels.qty)}</th>
        <th>${esc(labels.uom)}</th>
        <th class="col-num-head">${esc(labels.price)}</th>
        <th class="col-num-head">${esc(labels.amount)}</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="5" style="font-family:var(--mono);color:#9ca3af;padding:20px 0;">—</td></tr>`}
    </tbody>
  </table>

  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row">
        <span class="tk">${esc(labels.subtotal)}</span>
        <span class="tv">${esc(money(currency, subtotal))}</span>
      </div>
      <div class="tot-row">
        <span class="tk">${esc(labels.tax)}</span>
        <span class="tv">${esc(money(currency, taxAmount))}</span>
      </div>
      <div class="grand-row">
        <span class="gk">${esc(labels.grandTotal)}</span>
        <span class="gv">${esc(money(currency, grandTotal))}</span>
      </div>
    </div>
  </div>

  ${legalHtml}
</body>
</html>`;
}
