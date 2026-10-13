/**
 * Pure parse of the workbook's BELI sheet (purchase receipts) into notas for the legacy GRN
 * import (#438). One nota = one supplier delivery on one day = one GRN.
 */

export type BeliLine = {
  excelRow: number;
  nota: string;
  date: Date;
  kode: string;
  nama: string;
  supplier: string;
  sat: string;
  qty: number;
  price: number;
};

export type BeliSkip = { excelRow: number; reason: "NO_NOTA" | "NO_QTY" | "NO_PRICE" | "NO_KODE" };

export type BeliNota = { nota: string; date: Date; supplier: string; lines: BeliLine[] };

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** A workbook date serial is a calendar day in Jakarta; store it as WIB midnight. */
export function excelSerialToWibDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial) * DAY_MS - WIB_OFFSET_MS);
}

const COLUMNS = {
  tgl: "TGL",
  nota: "NO NOTA",
  kode: "KODE BARANG",
  nama: "NAMA BARANG",
  supplier: "SUPLLIER",
  sat: "SAT",
  qty: "QTY BELI",
  price: "HARGA BELI",
} as const;

const str = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function parseBeliMatrix(matrix: unknown[][]): { lines: BeliLine[]; skipped: BeliSkip[] } {
  const header = (matrix[0] ?? []).map((h) => str(h).toUpperCase());
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => {
      const i = header.indexOf(name);
      if (i < 0) throw new Error(`BELI header missing column "${name}"`);
      return [key, i];
    }),
  ) as Record<keyof typeof COLUMNS, number>;

  const lines: BeliLine[] = [];
  const skipped: BeliSkip[] = [];
  matrix.slice(1).forEach((row, i) => {
    const excelRow = i + 2;
    const tgl = num(row?.[col.tgl]);
    if (tgl == null) return; // blank or summary row
    const nota = str(row[col.nota]);
    const kode = str(row[col.kode]);
    const qty = num(row[col.qty]);
    const price = num(row[col.price]);
    if (!nota) return void skipped.push({ excelRow, reason: "NO_NOTA" });
    if (!kode) return void skipped.push({ excelRow, reason: "NO_KODE" });
    if (qty == null || qty <= 0) return void skipped.push({ excelRow, reason: "NO_QTY" });
    if (price == null || price < 0) return void skipped.push({ excelRow, reason: "NO_PRICE" });
    lines.push({
      excelRow,
      nota,
      date: excelSerialToWibDate(tgl),
      kode,
      nama: str(row[col.nama]),
      supplier: str(row[col.supplier]),
      sat: str(row[col.sat]),
      qty,
      price,
    });
  });
  return { lines, skipped };
}

/** Groups lines into notas ordered by date, then nota number. A nota mixing suppliers or days is a conflict. */
export function groupBeliNotas(lines: BeliLine[]): { notas: BeliNota[]; conflicts: string[] } {
  const byNota = new Map<string, BeliLine[]>();
  for (const l of lines) byNota.set(l.nota, [...(byNota.get(l.nota) ?? []), l]);

  const notas: BeliNota[] = [];
  const conflicts: string[] = [];
  for (const [nota, ls] of byNota) {
    const suppliers = new Set(ls.map((l) => l.supplier.toUpperCase()));
    const days = new Set(ls.map((l) => l.date.getTime()));
    if (suppliers.size > 1 || days.size > 1) conflicts.push(nota);
    else notas.push({ nota, date: ls[0]!.date, supplier: ls[0]!.supplier, lines: ls });
  }
  const notaNum = (n: string) => (Number.isFinite(Number(n)) ? Number(n) : Number.MAX_SAFE_INTEGER);
  notas.sort((a, b) => a.date.getTime() - b.date.getTime() || notaNum(a.nota) - notaNum(b.nota) || a.nota.localeCompare(b.nota));
  return { notas, conflicts };
}
