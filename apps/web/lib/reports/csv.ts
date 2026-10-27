export type CsvCell = string | number | null;

/* Excel's UTF-8 signature: without it, Excel on Windows reads the file as ANSI and garbles non-ASCII names. */
export const UTF8_BOM = "\uFEFF";

/* A text cell opening with one of these is run by a spreadsheet as a formula. */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * Every cell quoted with embedded quotes doubled; an empty cell stays empty rather than printing
 * "null". A TEXT cell that would open as a formula gets a leading `'`, which a spreadsheet shows as
 * text. Numbers never do: a negative amount starts with `-` and must stay a number.
 */
export function toCsv(headers: string[], rows: Array<Record<string, CsvCell>>): string {
  const text = (value: CsvCell) => {
    if (value === null) return "";
    if (typeof value === "number") return String(value);
    return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
  };
  const quote = (value: CsvCell) => `"${text(value).replace(/"/g, `""`)}"`;
  const lines = rows.map((r) => headers.map((h) => quote(r[h] ?? null)).join(","));
  return `${UTF8_BOM}${[headers.join(","), ...lines].join("\n")}\n`;
}
