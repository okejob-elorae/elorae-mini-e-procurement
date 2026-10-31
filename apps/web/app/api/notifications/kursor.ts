/**
 * Kursor halaman lonceng: posisi baris terakhir yang sudah dimuat, sebagai
 * `<createdAt dalam milidetik>_<id>`.
 *
 * Berdasar (createdAt, id), bukan offset: notifikasi baru terus masuk di atas
 * selama orang menggulir, dan offset akan menggeser halaman berikutnya sehingga
 * baris terlewat atau muncul dua kali. `id` memutus seri bila beberapa baris
 * ditulis pada milidetik yang sama (fan-out menulis satu baris per penerima).
 */
export type KursorLonceng = { createdAt: Date; id: string };

export function buatKursor(baris: { createdAt: Date; id: string }): string {
  return `${baris.createdAt.getTime()}_${baris.id}`;
}

/** `null` bila kursornya bukan bentuk yang kita buat — pemanggil menolak dengan 400. */
export function bacaKursor(teks: string): KursorLonceng | null {
  const pisah = teks.indexOf("_");
  if (pisah <= 0) return null;
  const ms = teks.slice(0, pisah);
  const id = teks.slice(pisah + 1);
  if (!/^\d{1,15}$/.test(ms) || id === "") return null;
  const createdAt = new Date(Number(ms));
  if (Number.isNaN(createdAt.getTime())) return null;
  return { createdAt, id };
}

/** Syarat "lebih lama dari kursor" untuk urutan createdAt turun, id turun. */
export function sebelumKursor(k: KursorLonceng) {
  return {
    OR: [{ createdAt: { lt: k.createdAt } }, { createdAt: k.createdAt, id: { lt: k.id } }],
  };
}
