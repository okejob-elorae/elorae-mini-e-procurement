/**
 * Penanda faktur beban di catatannya.
 *
 * Skema tidak punya kolom yang menautkan beban ke faktur, jadi tautannya adalah
 * penanda ini di `Receivable.note` — id beban (cuid) unik, sehingga pencarian
 * `contains` atasnya tepat satu. Jangan mengubah bentuknya tanpa memindahkan
 * faktur lama: pembacanya hanya mengenali bentuk ini.
 *
 * Berkas sendiri (tanpa Prisma) supaya penulis piutang (`writer.ts`) bisa
 * membacanya tanpa mengimpor penulis retur — yang sendiri mengimpor `writer.ts`.
 */
export function penandaBebanRetur(chargeId: string): string {
  return `[beban-retur:${chargeId}]`;
}

/** Awalan penanda — untuk membaca semua faktur beban sekaligus. */
export const AWALAN_PENANDA_BEBAN = "[beban-retur:";

/** Id beban dari catatan faktur, atau `null` kalau faktur itu bukan faktur beban. */
export function idBebanDariCatatan(note: string | null | undefined): string | null {
  const m = note?.match(/\[beban-retur:([^\]\s]+)\]/);
  return m ? m[1] : null;
}
