/**
 * "Harga di Jubelio berbeda dengan ERP" (owner answers 2026-11-02, P1, P2, P75) — pure, import-free,
 * so apps/api (the product push hold) and the web tests can share ONE definition.
 *
 * A price of 0 or less, or anything unreadable, is "no price", on both sides of every comparison,
 * and prices compare in whole sen — the same rules as `item-writer.ts` and as the web's
 * `lib/jubelio/harga/aturan.ts`, whose `bedaDiJubelio` is the twin of these two predicates (its
 * test checks them case by case).
 */

export type HargaMasukan = { toFixed(digits?: number): string } | number | string | null | undefined;

/** A price in whole sen when it is above 0; null for no price (empty, 0 or less, unreadable). */
export function senPositif(nilai: HargaMasukan): number | null {
  if (nilai == null || nilai === "") return null;
  const teks = typeof nilai === "object" ? nilai.toFixed() : String(nilai);
  const t = teks.trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const sen = Math.round(Number(t) * 100);
  return Number.isFinite(sen) && sen > 0 ? sen : null;
}

function samaSen(a: HargaMasukan, b: HargaMasukan): boolean {
  const x = senPositif(a);
  const y = senPositif(b);
  if (x == null || y == null) return x == null && y == null;
  return x === y;
}

/**
 * Jubelio shows a price other than the one confirmed in the ERP: its highest OR its lowest variant
 * price differs from `jubelioConfirmedPrice` (P1 takes the highest as THE Jubelio price; a lower
 * variant, or a variant with no price, is still a difference the admin must see).
 */
export function hargaJubelioBerbeda(i: {
  tertinggi: HargaMasukan;
  terendah: HargaMasukan;
  terkonfirmasi: HargaMasukan;
}): boolean {
  return !samaSen(i.tertinggi, i.terkonfirmasi) || !samaSen(i.terendah, i.terkonfirmasi);
}

/**
 * An admin's price decision (confirm, revert, "Kirim ulang harga ERP") still counts: it was taken
 * at or after the last time Jubelio's reading CHANGED. A Jubelio edit observed after the decision
 * cancels it, so that newer edit raises a fresh warning instead of being overwritten (P75).
 */
export function keputusanHargaBerlaku(i: { diputuskanPada: Date | null; berubahPada: Date | null }): boolean {
  if (i.diputuskanPada == null) return false;
  return i.berubahPada == null || i.berubahPada.getTime() <= i.diputuskanPada.getTime();
}
