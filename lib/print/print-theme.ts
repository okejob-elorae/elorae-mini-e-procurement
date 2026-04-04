/**
 * Shared print document theme — visual language of lib/print/po-payment-receipt-html.ts:
 * neutral ink/muted/border tokens, serif display title, sans body, monospace data,
 * uppercase tracked labels. Aligns with shadcn-style gray scale.
 */

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtDocDate(d: Date | string | null | undefined): string {
  if (d == null) return '—';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '—';
  return x
    .toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
    .toUpperCase();
}

/** Date + time for operational timestamps (mono-friendly). */
export function fmtDocDateTime(d: Date | string | null | undefined): string {
  if (d == null || d === '') return '';
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  return x.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function money(currency: string, n: number): string {
  return `${currency} ${Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Core layout + typography (no @page — compose with printPagePortrait or printPageLandscape). */
export const printCssBase = `
    :root {
      --ink: #111827;
      --muted: #9ca3af;
      --border: #e5e7eb;
      --serif: Georgia, "Times New Roman", Times, serif;
      --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      --sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 32px 40px 48px;
      background: #fff;
      color: var(--ink);
      font-family: var(--sans);
      font-size: 10.5pt;
      line-height: 1.45;
    }
    .doc-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 24px;
      margin-bottom: 36px;
    }
    .doc-title {
      margin: 0 0 6px;
      font-family: var(--serif);
      font-size: 28pt;
      font-weight: 400;
      letter-spacing: -0.02em;
      line-height: 1.1;
      color: var(--ink);
    }
    .doc-sub {
      margin: 0;
      font-size: 11pt;
      font-style: italic;
      color: #6b7280;
    }
    .doc-ref {
      text-align: right;
      font-family: var(--mono);
      font-size: 10pt;
    }
    .doc-ref .lbl {
      display: block;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .doc-ref .val {
      display: block;
      margin-bottom: 14px;
      font-weight: 500;
      color: var(--ink);
    }
    .doc-ref .val:last-child { margin-bottom: 0; }

    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px 48px;
      margin-bottom: 32px;
    }
    .block-label {
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: var(--muted);
      text-transform: uppercase;
      margin: 0 0 10px;
    }
    .payee-name, .supplier-name {
      margin: 0 0 8px;
      font-weight: 700;
      font-size: 11.5pt;
      color: var(--ink);
    }
    .payee-addr, .supplier-addr {
      margin: 0;
      font-family: var(--mono);
      font-size: 9.5pt;
      color: #374151;
      white-space: pre-wrap;
    }
    .code-line, .attn-line {
      margin: 10px 0 0;
      font-family: var(--mono);
      font-size: 9.5pt;
      color: #374151;
    }
    .meta-grid { display: grid; gap: 12px 16px; }
    .meta-row {
      display: grid;
      grid-template-columns: minmax(100px, 140px) 1fr;
      gap: 8px;
      align-items: baseline;
    }
    .meta-row .mk {
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--muted);
      text-transform: uppercase;
    }
    .meta-row .mv {
      font-family: var(--mono);
      font-size: 10pt;
      color: var(--ink);
    }

    .summary-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 16px 24px;
      margin-bottom: 28px;
      padding: 16px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .summary-strip .sk {
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--muted);
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .summary-strip .sv {
      font-family: var(--mono);
      font-size: 11pt;
      font-weight: 600;
      color: var(--ink);
      font-variant-numeric: tabular-nums;
    }

    .stat-cards {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      border: 1px solid var(--border);
      border-radius: 2px;
      padding: 14px 16px;
      background: #fafafa;
    }
    .stat-card .sk {
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.12em;
      color: var(--muted);
      text-transform: uppercase;
      margin: 0 0 8px;
    }
    .stat-card .sv {
      font-family: var(--mono);
      font-size: 14pt;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      color: var(--ink);
    }
    .stat-card .sh {
      margin: 6px 0 0;
      font-size: 8.5pt;
      color: #6b7280;
      line-height: 1.4;
    }

    .totals-wrap {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 28px;
    }
    .totals {
      min-width: 300px;
      font-family: var(--mono);
      font-size: 10.5pt;
    }
    .tot-row {
      display: flex;
      justify-content: space-between;
      gap: 32px;
      margin-bottom: 8px;
      color: #374151;
    }
    .tot-row .tk {
      text-align: left;
      color: var(--muted);
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .tot-row .tv {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .grand-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 32px;
      padding-top: 14px;
      border-top: 1px solid var(--border);
    }
    .grand-row .gk {
      font-family: var(--serif);
      font-size: 13pt;
      font-weight: 700;
      color: var(--ink);
    }
    .grand-row .gv {
      font-family: var(--mono);
      font-size: 15pt;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }

    .section-title {
      margin: 28px 0 8px;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: var(--muted);
      text-transform: uppercase;
    }
    .section-desc {
      margin: 0 0 12px;
      font-size: 9pt;
      color: #6b7280;
      line-height: 1.5;
    }

    .legal { page-break-inside: avoid; margin-top: 8px; }
    .legal-title {
      margin: 0 0 10px;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.14em;
      color: var(--muted);
      text-transform: uppercase;
    }
    .legal-body {
      font-size: 8.5pt;
      line-height: 1.55;
      color: #9ca3af;
    }
    .legal-body p { margin: 0 0 8px; }
    .legal-body p:last-child { margin-bottom: 0; }
    .legal-inline-label { font-weight: 600; color: #a1a1aa; }

    /* PO-style line items — rules only */
    table.lines {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 28px;
    }
    table.lines thead th {
      padding: 10px 12px 10px 0;
      text-align: left;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.1em;
      color: var(--muted);
      text-transform: uppercase;
      border: none;
      border-bottom: 1px solid var(--border);
      vertical-align: bottom;
    }
    table.lines thead th.col-num-head {
      text-align: right;
      padding-right: 0;
      padding-left: 8px;
    }
    table.lines tbody td {
      padding: 14px 12px 14px 0;
      border: none;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
    }
    table.lines tbody td.col-num {
      font-family: var(--mono);
      font-size: 10pt;
      text-align: right;
      white-space: nowrap;
      padding-left: 8px;
    }
    table.lines tbody td.col-uom {
      font-family: var(--mono);
      font-size: 10pt;
      color: #374151;
    }
    .col-desc .line-name {
      font-weight: 700;
      font-size: 11pt;
      color: var(--ink);
      margin-bottom: 4px;
    }
    .col-desc .line-sku {
      font-family: var(--mono);
      font-size: 9pt;
      color: var(--muted);
    }
    .col-desc .line-meta {
      font-size: 9pt;
      color: #6b7280;
      margin-top: 4px;
    }

    /* Dense grids (inventory, stock card, vendor return, reconciliation) */
    table.data {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 24px;
      font-size: 9pt;
    }
    table.data thead th {
      padding: 8px 10px 8px 0;
      text-align: left;
      font-size: 8pt;
      font-weight: 600;
      letter-spacing: 0.1em;
      color: var(--muted);
      text-transform: uppercase;
      border: none;
      border-bottom: 1px solid var(--border);
      vertical-align: bottom;
    }
    table.data thead th.right { text-align: right; padding-right: 0; padding-left: 8px; }
    table.data thead th.center { text-align: center; }
    table.data tbody td {
      padding: 8px 10px 8px 0;
      border: none;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
      color: var(--ink);
    }
    table.data tbody td.right {
      text-align: right;
      font-family: var(--mono);
      font-size: 9.5pt;
      font-variant-numeric: tabular-nums;
      padding-left: 8px;
    }
    table.data tbody td.uom {
      font-family: var(--mono);
      font-size: 9.5pt;
      color: #374151;
    }
    table.data .col-desc .line-name {
      font-weight: 700;
      font-size: 11pt;
      color: var(--ink);
      margin-bottom: 4px;
    }
    table.data .col-desc .line-sku {
      font-family: var(--mono);
      font-size: 9pt;
      color: var(--muted);
    }
    table.data tbody td.center { text-align: center; }
    table.data tbody tr:nth-child(even) { background: #fafafa; }
    table.data tbody tr.row-over { background: #fef2f2 !important; }
    table.data tbody tr.row-under { background: #f0fdf4 !important; }
    .badge {
      display: inline-block;
      border-radius: 2px;
      padding: 2px 6px;
      font-size: 7.5pt;
      font-weight: 600;
      font-family: var(--mono);
      letter-spacing: 0.04em;
    }
    .badge-ok { border: 1px solid #4b5563; background: #e5e7eb; color: #111827; }
    .badge-over { border: 1px solid #991b1b; background: #fecaca; color: #7f1d1d; }
    .badge-under { border: 1px solid #166534; background: #bbf7d0; color: #14532d; }

    .item-block { margin-bottom: 28px; page-break-inside: avoid; }
    .item-block .item-heading {
      margin: 0 0 6px;
      font-family: var(--serif);
      font-size: 13pt;
      font-weight: 700;
      color: var(--ink);
    }
    .item-block .item-meta {
      margin: 0 0 10px;
      font-family: var(--mono);
      font-size: 9pt;
      color: #6b7280;
    }
`;

export const printPagePortrait = `
    @media print {
      body { padding: 12mm 16mm 18mm; }
      @page { size: A4; margin: 0; }
      .stat-card, .badge {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
`;

/**
 * Landscape print: use @page margins (not margin:0) so every fragment — including
 * repeated table headers — sits inside a consistent safe area. Body padding is 0
 * in print to avoid double insets with @page.
 */
export const printPageLandscape = `
    @media print {
      body {
        padding: 0;
      }
      @page {
        size: A4 landscape;
        margin: 12mm 14mm 14mm 14mm;
      }
      .doc-top {
        margin-bottom: 28px;
      }
      .summary-strip {
        margin-bottom: 22px;
        padding-top: 4px;
      }
      /* Keep section headings attached to the table that follows */
      .section-title {
        break-after: avoid;
        page-break-after: avoid;
        margin-top: 18px;
        margin-bottom: 12px;
        padding-top: 4px;
      }
      .summary-strip + .section-title {
        margin-top: 14px;
      }
      .stat-cards + .section-title {
        margin-top: 10px;
      }
      /* Major break between stacked tables (e.g. inventory → low stock) */
      table.data + .section-title {
        margin-top: 36px;
      }
      .section-desc {
        break-after: avoid;
        page-break-after: avoid;
      }
      table.data {
        margin-top: 0;
        margin-bottom: 32px;
      }
      table.data thead {
        display: table-header-group;
      }
      /* Breathing room above repeated (and first) header rows */
      table.data thead th {
        padding-top: 12px;
        padding-bottom: 10px;
      }
      .badge, .stat-card, table.data tbody tr.row-over, table.data tbody tr.row-under {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
`;
