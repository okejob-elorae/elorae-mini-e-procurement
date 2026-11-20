/**
 * Import-free WO-step label for bills, pay pickers, and linked lists.
 * Prefer service type name, then stepName snapshot, then sequence alone.
 */

export function namaLangkahWo(input: {
  serviceTypeName?: string | null;
  stepName?: string | null;
  sequence: number;
}): string {
  const tipe = input.serviceTypeName?.trim();
  if (tipe) return tipe;
  const nama = input.stepName?.trim();
  if (nama) return nama;
  return String(input.sequence);
}

/** Document-style: `WO/2026/001 · 2 · Jahit/CMT` */
export function labelLangkahWoDoc(input: {
  woDocNumber: string;
  sequence: number;
  serviceTypeName?: string | null;
  stepName?: string | null;
}): string {
  const nama = namaLangkahWo(input);
  return `${input.woDocNumber} · ${input.sequence} · ${nama}`;
}
