/*
 * How much of a vendor bill has been paid through Supplier payments → Pay. Import-free: a pure rule,
 * tested on its own (`bill-paid-rule.test.ts`), used by `supplier-paid.ts` (the bill status) and by
 * `invoice-bayar-queries.ts` (the "Bayar per invoice" picker), so the two always agree.
 *
 * Supplier payments pay RECEIPTS, not invoices: an allocation names a GRN (goods) or a WO step (CMT
 * and other step work). An invoice names the receipts it bills (a GRN line per item + variant, or a
 * WO step). The rule is VALUE-based, per receipt (owner 2026-11-02, P20 + P29):
 * - what Supplier payments settled on a receipt, in cents, goes to the live bill lines on it, OLDEST
 *   INVOICE FIRST BY THE DATE ON THE PAPER (`urutkanInvoice`: the WIB calendar date of `billDate`,
 *   then `createdAt`, then `id`) — the order the owner confirmed in P29;
 * - each line takes at most its RECORDED payable: its received pieces × the receipt's recorded payable
 *   per piece (the AP its receipt journal booked, PPN included), plus its own price-difference
 *   correction while that correction waits or was accepted;
 * - pieces no invoice names get only what is left, so a payment on a receipt never makes an invoice
 *   for goods with no invoice read as paid, and a correction moves only its own line.
 * A line's paid amount is then read back in invoice terms (its room in cents × taken ÷ recorded).
 */

/** `total` cents split over `weights`, largest remainder first, so the parts add up to `total` exactly. */
export function splitCents(total: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map((r) => Math.floor(r));
  let left = total - parts.reduce((s, p) => s + p, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i] += 1;
  return parts;
}

/**
 * Cents of each line still open after the bill's vendor payments, which are allocated to the bill,
 * not to a line, and split over the lines by amount (the split `vendorPaidBySource` books).
 */
export function lineRooms(vendorPaidCents: number, lineAmountCents: number[]): number[] {
  const amounts = lineAmountCents.map((a) => Math.max(0, a));
  const vendor = splitCents(vendorPaidCents, amounts);
  return amounts.map((a, i) => Math.max(0, a - vendor[i]));
}

/** The key a GRN line and a PO item match on — item and trimmed variant, as `createGRN` matches them. */
export function grnLineKey(itemId: string, variantSku?: string | null): string {
  return `${itemId}\t${variantSku?.trim() ?? ""}`;
}

/** The pool key of one GRN key: `GRN:<grnId>|<item\tvariant>`. */
export function grnLineSource(grnId: string, key: string): string {
  return `GRN:${grnId}|${key}`;
}

/**
 * Invoiced pieces of one GRN key that a completed vendor return later took back:
 * max(0, billed + returned − received), 0 below half a cent of a piece. The bill cap nets completed
 * returns out before an invoice may bill a piece, so returns leave the un-invoiced pieces first, and
 * a key reads above zero only when a return completed AFTER an invoice had billed the pieces it took.
 */
export function invoicedReturnedQty(a: { received: number; returned: number; billed: number }): number {
  const n = Math.round((a.billed + a.returned - a.received) * 100) / 100;
  return n > 0.005 ? n : 0;
}

function bacaLarik(raw: unknown): unknown[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? arr : [];
}

/** The lines stored on `GRN.items` (a JSON array, or that array as a JSON string), as key and qty. */
export function readGrnLines(raw: unknown): Array<{ key: string; qty: number }> {
  return readGrnLinesDetail(raw).map((l) => ({ key: l.key, qty: l.qty }));
}

export type GrnLineDetail = {
  key: string;
  itemId: string;
  variantSku: string | null;
  qty: number;
  /** Stored line total: qty × unit cost on the stock card, capitalised PPN included. */
  totalCost: number;
  /** The base price per unit before PPN: the PO price (`hargaPo`) when PPN was capitalised, else `unitCost`. */
  hargaDasar: number;
  /** A PO "Exclude PPN" line received while Elorae was PKP: its PPN is input VAT (`GRN.ppnAmount`). */
  ppnMasukan: boolean;
  /** A PO "Exclude PPN" line received while Elorae was not PKP: its PPN is part of the cost. */
  ppnModal: boolean;
  itemType: string | null;
};

const angka = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Every stored GRN line with the fields the payable and the price difference are computed from. */
export function readGrnLinesDetail(raw: unknown): GrnLineDetail[] {
  const out: GrnLineDetail[] = [];
  for (const l of bacaLarik(raw)) {
    if (typeof l !== "object" || l === null) continue;
    const r = l as Record<string, unknown>;
    const qty = Number(r.qty);
    if (typeof r.itemId !== "string" || !Number.isFinite(qty) || qty <= 0) continue;
    const variantSku = typeof r.variantSku === "string" && r.variantSku.trim() !== "" ? r.variantSku.trim() : null;
    const unitCost = angka(r.unitCost);
    const totalCost = r.totalCost != null && Number.isFinite(Number(r.totalCost)) ? Number(r.totalCost) : qty * unitCost;
    const ppnModal = angka(r.ppnDikapitalisasi) > 0;
    out.push({
      key: grnLineKey(r.itemId, variantSku),
      itemId: r.itemId,
      variantSku,
      qty,
      totalCost,
      hargaDasar: ppnModal && r.hargaPo != null ? angka(r.hargaPo) : unitCost,
      ppnMasukan: r.ppnIncluded === false,
      ppnModal,
      itemType: typeof r.itemType === "string" ? r.itemType : null,
    });
  }
  return out;
}

const SELISIH_WIB_MS = 7 * 3_600_000;

function waktu(v: Date | string): number {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** "YYYY-MM-DD" of an instant in Asia/Jakarta (UTC+7, no daylight saving). */
function tanggalWib(v: Date | string): string {
  return new Date(waktu(v) + SELISIH_WIB_MS).toISOString().slice(0, 10);
}

/**
 * Invoices in the order they are paid: the WIB calendar date of the invoice (`billDate`, the date on
 * the paper — owner 2026-11-02, P29), then when it was recorded, then id. Returns a sorted copy. The
 * one comparator for paid attribution, the "Bayar per invoice" picker and its "ikut melunasi" notes.
 */
export function urutkanInvoice<T extends { billDate: Date | string; createdAt: Date | string; id: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = tanggalWib(a.billDate);
    const tb = tanggalWib(b.billDate);
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ca = waktu(a.createdAt);
    const cb = waktu(b.createdAt);
    if (ca !== cb) return ca - cb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * A GRN's recorded payable (cents, PPN included) split over its item keys: weight = the key's stored
 * line value (capitalised PPN included) plus its share of the GRN's input VAT, which is split over the
 * PPN-masukan keys by value. The parts add up to `hutangSen` exactly; a negative payable splits the
 * same way with the sign kept.
 */
export function hutangPerKunciGrn(a: {
  baris: ReadonlyArray<{ key: string; nilaiSen: number; ppnMasukan: boolean }>;
  ppnSen: number;
  hutangSen: number;
}): Map<string, number> {
  const kunci: string[] = [];
  const nilai = new Map<string, number>();
  const masukan = new Set<string>();
  for (const b of a.baris) {
    if (!nilai.has(b.key)) kunci.push(b.key);
    nilai.set(b.key, (nilai.get(b.key) ?? 0) + Math.max(0, b.nilaiSen));
    if (b.ppnMasukan) masukan.add(b.key);
  }
  const ppnPart = splitCents(
    Math.max(0, a.ppnSen),
    kunci.map((k) => (masukan.has(k) ? nilai.get(k) ?? 0 : 0)),
  );
  const bobot = kunci.map((k, i) => (nilai.get(k) ?? 0) + ppnPart[i]);
  const tanda = a.hutangSen < 0 ? -1 : 1;
  const bagian = splitCents(Math.abs(a.hutangSen), bobot.some((w) => w > 0) ? bobot : kunci.map(() => 1));
  return new Map(kunci.map((k, i) => [k, tanda * bagian[i]]));
}

/**
 * Hands a receipt's settled cents to its live lines in the order given (`urutkanInvoice`, then line
 * id): each line takes at most its recorded payable `tercatatSen`; its paid amount in invoice terms is
 * its open room `ruangSen` × taken ÷ recorded, exactly `ruangSen` when it took all of it. A line with
 * nothing recorded takes nothing. What is left over belongs to pieces no invoice names.
 */
export function bagiLunasKeBaris(
  lunasSen: number,
  baris: ReadonlyArray<{ billId: string; lineId: string; tercatatSen: number; ruangSen: number }>,
): Map<string, { diambilSen: number; dibayarInvoiceSen: number }> {
  const hasil = new Map<string, { diambilSen: number; dibayarInvoiceSen: number }>();
  let sisa = Math.max(0, lunasSen);
  for (const b of baris) {
    const tercatat = Math.max(0, Math.round(b.tercatatSen));
    const ambil = Math.min(sisa, tercatat);
    sisa -= ambil;
    const ruang = Math.max(0, Math.round(b.ruangSen));
    const dibayar = tercatat <= 0 || ambil <= 0 ? 0 : ambil >= tercatat ? ruang : Math.round((ruang * ambil) / tercatat);
    hasil.set(b.lineId, { diambilSen: ambil, dibayarInvoiceSen: dibayar });
  }
  return hasil;
}
