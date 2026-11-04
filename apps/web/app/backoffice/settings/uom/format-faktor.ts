/** Faktor konversi satuan dalam format Indonesia ("25", "0,9144", "1.000"), paling banyak 6 desimal. */
export function formatFaktor(faktor: number | string): string {
  const n = Number(faktor);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("id-ID", { maximumFractionDigits: 6 });
}
