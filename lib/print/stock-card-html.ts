/**
 * Stock card print — shared print theme (landscape).
 */

import { esc, printCssBase, printPageLandscape } from '@/lib/print/print-theme';

function fmtDateTime(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return x.toLocaleString('id-ID', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type StockCardMovementRowFull = {
  date: Date | string;
  docNumber: string | null;
  description: string;
  notes: string | null;
  variantSku: string | null;
  in: number | null;
  out: number | null;
  balance: number;
  unitCost: number | null;
  balanceValue: number;
};

export type StockCardMovementRowCompact = {
  date: Date | string;
  docNumber: string | null;
  description: string;
  notes: string | null;
  in: number | null;
  out: number | null;
  balance: number;
};

export type StockCardPrintLabels = {
  title: string;
  period: string;
  openingBalance: string;
  openingValue: string;
  closingBalance: string;
  closingValue: string;
  variant: string;
  colDate: string;
  colDoc: string;
  colDesc: string;
  colNotes: string;
  colVariant: string;
  colIn: string;
  colOut: string;
  colBalance: string;
  colUnitCost: string;
  colBalanceValue: string;
  noMovements: string;
  issuedBy?: string;
};

const defaultLabels: StockCardPrintLabels = {
  title: 'Stock Card',
  period: 'Period',
  openingBalance: 'Opening balance',
  openingValue: 'Opening value',
  closingBalance: 'Closing balance',
  closingValue: 'Closing value',
  variant: 'Variant',
  colDate: 'Date',
  colDoc: 'Document',
  colDesc: 'Description',
  colNotes: 'Notes',
  colVariant: 'Variant',
  colIn: 'In',
  colOut: 'Out',
  colBalance: 'Balance',
  colUnitCost: 'Unit cost',
  colBalanceValue: 'Inventory value',
  noMovements: 'No movements in this period.',
};

function mergeLabels(partial?: Partial<StockCardPrintLabels>): StockCardPrintLabels {
  return { ...defaultLabels, ...partial };
}

export type BuildStockCardPrintHtmlByItem = {
  kind: 'item';
  itemSku: string;
  itemName: string;
  uomCode: string;
  variantFilterLabel: string;
  dateFromLabel: string;
  dateToLabel: string;
  openingBalance: number;
  openingValue: number;
  closingBalance: number;
  closingValue: number;
  movements: StockCardMovementRowFull[];
  labels?: Partial<StockCardPrintLabels>;
  issuerName?: string;
};

export type StockCardAggregateItem = {
  sku: string;
  name: string;
  uomCode: string;
  openingBalance: number;
  closingBalance: number;
  movements: StockCardMovementRowCompact[];
};

export type BuildStockCardPrintHtmlByType = {
  kind: 'byType';
  typeTitle: string;
  dateFromLabel: string;
  dateToLabel: string;
  items: StockCardAggregateItem[];
  labels?: Partial<StockCardPrintLabels>;
  issuerName?: string;
};

export type BuildStockCardPrintHtmlByCategory = {
  kind: 'byCategory';
  categoryTitle: string;
  categoryCode: string | null;
  dateFromLabel: string;
  dateToLabel: string;
  items: StockCardAggregateItem[];
  labels?: Partial<StockCardPrintLabels>;
  issuerName?: string;
};

export type BuildStockCardPrintHtmlOptions =
  | BuildStockCardPrintHtmlByItem
  | BuildStockCardPrintHtmlByType
  | BuildStockCardPrintHtmlByCategory;

function renderSingleItemTable(
  movements: StockCardMovementRowFull[],
  labels: StockCardPrintLabels
): string {
  const rows =
    movements.length === 0
      ? `<tr><td colspan="10" class="center" style="padding:16px;color:var(--muted)">${esc(labels.noMovements)}</td></tr>`
      : movements
          .map(
            (m) => `<tr>
          <td class="uom">${esc(fmtDateTime(m.date))}</td>
          <td class="uom">${esc(m.docNumber ?? '')}</td>
          <td>${esc(m.description)}</td>
          <td>${esc(m.notes?.trim() ? m.notes : '-')}</td>
          <td class="uom">${esc(m.variantSku ?? '-')}</td>
          <td class="right">${m.in != null ? Number(m.in).toLocaleString() : '—'}</td>
          <td class="right">${m.out != null ? Number(m.out).toLocaleString() : '—'}</td>
          <td class="right">${Number(m.balance).toLocaleString()}</td>
          <td class="right">${m.unitCost != null ? `Rp ${Number(m.unitCost).toLocaleString()}` : '—'}</td>
          <td class="right">Rp ${Number(m.balanceValue).toLocaleString()}</td>
        </tr>`
          )
          .join('');
  return `<table class="data stock-lines">
    <thead>
      <tr>
        <th>${esc(labels.colDate)}</th>
        <th>${esc(labels.colDoc)}</th>
        <th>${esc(labels.colDesc)}</th>
        <th>${esc(labels.colNotes)}</th>
        <th>${esc(labels.colVariant)}</th>
        <th class="right">${esc(labels.colIn)}</th>
        <th class="right">${esc(labels.colOut)}</th>
        <th class="right">${esc(labels.colBalance)}</th>
        <th class="right">${esc(labels.colUnitCost)}</th>
        <th class="right">${esc(labels.colBalanceValue)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderAggregateMovementTable(
  movements: StockCardMovementRowCompact[],
  labels: StockCardPrintLabels
): string {
  const rows =
    movements.length === 0
      ? `<tr><td colspan="7" class="center" style="padding:12px;color:var(--muted)">${esc(labels.noMovements)}</td></tr>`
      : movements
          .map(
            (m) => `<tr>
          <td class="uom">${esc(fmtDateTime(m.date))}</td>
          <td class="uom">${esc(m.docNumber ?? '')}</td>
          <td>${esc(m.description)}</td>
          <td>${esc(m.notes?.trim() ? m.notes : '-')}</td>
          <td class="right">${m.in != null ? Number(m.in).toLocaleString() : '—'}</td>
          <td class="right">${m.out != null ? Number(m.out).toLocaleString() : '—'}</td>
          <td class="right">${Number(m.balance).toLocaleString()}</td>
        </tr>`
          )
          .join('');
  return `<table class="data">
    <thead>
      <tr>
        <th>${esc(labels.colDate)}</th>
        <th>${esc(labels.colDoc)}</th>
        <th>${esc(labels.colDesc)}</th>
        <th>${esc(labels.colNotes)}</th>
        <th class="right">${esc(labels.colIn)}</th>
        <th class="right">${esc(labels.colOut)}</th>
        <th class="right">${esc(labels.colBalance)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildStockCardPrintHtml(opts: BuildStockCardPrintHtmlOptions): string {
  const labels = mergeLabels(opts.labels);
  const issuerName = opts.issuerName ?? 'Elorae ERP';
  const issuedByLabel = labels.issuedBy ?? 'Issued by';

  const extra = `
    table.data.stock-lines { font-size: 8pt; }
    table.data.stock-lines thead th { font-size: 7pt; }
`;

  if (opts.kind === 'item') {
    const body = `
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(issuedByLabel)} ${esc(issuerName)}</p>
      <p class="doc-sub" style="margin-top:8px;font-style:normal;font-weight:600;color:#374151">${esc(opts.itemSku)} — ${esc(opts.itemName)}${opts.uomCode ? ` (${esc(opts.uomCode)})` : ''}</p>
      <p class="doc-sub" style="margin-top:4px;font-style:normal;font-size:10pt">${esc(labels.variant)}: ${esc(opts.variantFilterLabel)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.period)}</span>
      <span class="val">${esc(opts.dateFromLabel)} — ${esc(opts.dateToLabel)}</span>
    </div>
  </div>

  <div class="summary-strip">
    <div>
      <div class="sk">${esc(labels.openingBalance)}</div>
      <div class="sv">${Number(opts.openingBalance).toLocaleString()} ${esc(opts.uomCode)}</div>
    </div>
    <div>
      <div class="sk">${esc(labels.closingBalance)}</div>
      <div class="sv">${Number(opts.closingBalance).toLocaleString()} ${esc(opts.uomCode)}</div>
    </div>
    <div>
      <div class="sk">${esc(labels.openingValue)}</div>
      <div class="sv">Rp ${Number(opts.openingValue).toLocaleString()}</div>
    </div>
    <div>
      <div class="sk">${esc(labels.closingValue)}</div>
      <div class="sv">Rp ${Number(opts.closingValue).toLocaleString()}</div>
    </div>
  </div>

  ${renderSingleItemTable(opts.movements, labels)}`;

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(opts.itemSku)}</title>
  <style>
${printCssBase}
${extra}
${printPageLandscape}
  </style>
</head>
<body>${body}</body>
</html>`;
  }

  if (opts.kind === 'byType') {
    const sections = opts.items
      .map(
        (it) => `<section class="item-block">
    <h2 class="item-heading">${esc(it.sku)} — ${esc(it.name)}</h2>
    <p class="item-meta">
      ${esc(labels.openingBalance)}: ${Number(it.openingBalance).toLocaleString()} ${esc(it.uomCode)}
      · ${esc(labels.closingBalance)}: ${Number(it.closingBalance).toLocaleString()} ${esc(it.uomCode)}
    </p>
    ${renderAggregateMovementTable(it.movements, labels)}
  </section>`
      )
      .join('\n');

    const body = `
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(issuedByLabel)} ${esc(issuerName)}</p>
      <p class="doc-sub" style="margin-top:8px;font-style:normal;font-weight:600;color:#374151">${esc(opts.typeTitle)}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.period)}</span>
      <span class="val">${esc(opts.dateFromLabel)} — ${esc(opts.dateToLabel)}</span>
    </div>
  </div>
  ${sections}`;

    return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(opts.typeTitle)}</title>
  <style>
${printCssBase}
${extra}
${printPageLandscape}
  </style>
</head>
<body>${body}</body>
</html>`;
  }

  const codeSuffix = opts.categoryCode ? ` (${esc(opts.categoryCode)})` : '';
  const sections = opts.items
    .map(
      (it) => `<section class="item-block">
    <h2 class="item-heading">${esc(it.sku)} — ${esc(it.name)}</h2>
    <p class="item-meta">
      ${esc(labels.openingBalance)}: ${Number(it.openingBalance).toLocaleString()} ${esc(it.uomCode)}
      · ${esc(labels.closingBalance)}: ${Number(it.closingBalance).toLocaleString()} ${esc(it.uomCode)}
    </p>
    ${renderAggregateMovementTable(it.movements, labels)}
  </section>`
    )
    .join('\n');

  const body = `
  <div class="doc-top">
    <div>
      <h1 class="doc-title">${esc(labels.title)}</h1>
      <p class="doc-sub">${esc(issuedByLabel)} ${esc(issuerName)}</p>
      <p class="doc-sub" style="margin-top:8px;font-style:normal;font-weight:600;color:#374151">${esc(opts.categoryTitle)}${codeSuffix}</p>
    </div>
    <div class="doc-ref">
      <span class="lbl">${esc(labels.period)}</span>
      <span class="val">${esc(opts.dateFromLabel)} — ${esc(opts.dateToLabel)}</span>
    </div>
  </div>
  ${sections}`;

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <title>${esc(labels.title)} — ${esc(opts.categoryTitle)}</title>
  <style>
${printCssBase}
${extra}
${printPageLandscape}
  </style>
</head>
<body>${body}</body>
</html>`;
}
