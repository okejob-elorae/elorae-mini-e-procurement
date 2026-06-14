export const PRINT_STYLES = `
@page { size: A4; margin: 12mm; }

@media print {
  body * { visibility: hidden !important; }
  .print-root, .print-root * { visibility: visible !important; }
  .print-root {
    position: absolute !important;
    left: 0 !important;
    top: 0 !important;
    width: 100% !important;
  }
  nav, aside, .quick-action-fab, [data-sonner-toaster] { display: none !important; }
}

.print-root {
  font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
  font-size: 11pt;
  color: #000;
  background: #fff;
  max-width: 186mm;
  margin: 0 auto;
  padding: 12mm 0;
}

.print-root .print-header {
  font-size: 16pt;
  font-weight: 600;
  margin-bottom: 4mm;
}

.print-root .print-subheader {
  font-size: 10pt;
  color: #555;
  margin-bottom: 8mm;
}

.print-root .print-meta {
  margin-bottom: 8mm;
  font-size: 10pt;
}

.print-root .print-meta-row {
  display: flex;
  gap: 8mm;
  margin-bottom: 1mm;
}

.print-root .print-meta-label {
  font-weight: 600;
  min-width: 22mm;
}

.print-root .print-divider {
  border-top: 1px solid #000;
  margin: 4mm 0;
}

.print-root table {
  width: 100%;
  border-collapse: collapse;
  margin: 4mm 0;
}

.print-root th, .print-root td {
  padding: 3px 6px;
  text-align: left;
  vertical-align: top;
  font-size: 10pt;
}

.print-root th {
  border-bottom: 1px solid #000;
  font-weight: 600;
}

.print-root td.num, .print-root th.num {
  text-align: right;
  white-space: nowrap;
}

.print-root .print-signature {
  margin-top: 12mm;
  font-size: 10pt;
}

.print-root .print-signature-line {
  border-bottom: 1px solid #000;
  display: inline-block;
  min-width: 60mm;
  height: 1em;
  margin-left: 2mm;
}

.print-root .print-footer {
  margin-top: 8mm;
  text-align: center;
  font-size: 9pt;
  color: #555;
}

.print-root .print-address-block {
  white-space: pre-line;
  line-height: 1.4;
}
`;

export const BRAND = {
  name: "ELORAÉ",
  address: "Jl. Example No. 123\nJakarta Selatan 12345\nIndonesia",
  email: "support@elorae.example",
} as const;
