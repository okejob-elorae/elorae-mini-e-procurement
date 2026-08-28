/**
 * Pembagian angka lencana menu samping.
 *
 * Murni, dan tinggal di `lib/` bukan di berkas route — sempat saya taruh di
 * sana dan tesnya gagal dimuat: sebuah route menarik `auth`, yang menarik
 * next-auth, yang tidak bisa dijalankan di vitest. Logika yang perlu diuji
 * tidak boleh tinggal di berkas yang menyeret separuh kerangka kerja.
 *
 * Pembagian ini sudah salah DUA KALI, dan dua-duanya lolos type-check:
 * sekali karena draft PO ikut terhitung terlambat, sekali karena induk dan anak
 * berbagi href sehingga anak mewarisi total seluruh grupnya.
 */

export type ButirLencana = { key: string; href: string; count: number };

export function bagiLencana(
  butir: ButirLencana[],
  grupUntuk: Record<string, string>,
): { grup: Record<string, number>; halaman: Record<string, number> } {
  const grup: Record<string, number> = {};
  const halaman: Record<string, number> = {};
  for (const b of butir) {
    const g = grupUntuk[b.key];
    if (g) grup[g] = (grup[g] ?? 0) + b.count;

    /*
     * Peta HALAMAN dijaga terpisah dari peta grup, bukan digabung ke satu peta
     * ber-kunci href. Sebagian induk berbagi href dengan salah satu anaknya —
     * Produksi dan Plan Kerja dua-duanya `/backoffice/production/planning` —
     * dan satu peta membuat anak itu memakai lencana milik seluruh grupnya.
     */
    const h = b.href.split('?')[0];
    if (h) halaman[h] = (halaman[h] ?? 0) + b.count;
  }
  return { grup, halaman };
}
