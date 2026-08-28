/**
 * Penyaring menu samping.
 *
 * Ada karena menunya berisi 53 tautan dalam 11 grup yang sebagian besar
 * tertutup. Menemukan "Klasifikasi Arus Kas" berarti menebak ia ada di bawah
 * Buku Besar dan bukan Laporan — dan tebakan itu salah separuh waktu. Mengetik
 * namanya jauh lebih cepat daripada mengingat susunannya.
 *
 * Murni: menerima label yang SUDAH diterjemahkan, bukan kunci i18n. Dengan
 * begitu ia bisa diuji tanpa menyeret next-intl, dan yang lebih penting — ia
 * mencari pada teks yang benar-benar DIBACA orang, bukan pada kunci yang tidak
 * pernah mereka lihat.
 */

export type AnakTerlabel = { href: string; label: string };
export type ItemTerlabel = { href: string; label: string; anak?: AnakTerlabel[] };

export type HasilSaring = {
  item: ItemTerlabel;
  /** Anak yang lolos. Sama dengan seluruh anaknya kalau induknya sendiri cocok. */
  anak: AnakTerlabel[];
  /** Grup ini harus dibuka paksa — pencocokannya ada di dalamnya. */
  paksaBuka: boolean;
};

/**
 * Samakan teks sebelum dibandingkan.
 *
 * Huruf besar-kecil diabaikan, dan diakritik dibuang supaya "Konsinyasi" ketemu
 * oleh "konsinyasi" dan "ELORAÉ" oleh "elorae". Cacat yang sama persis dengan
 * pencarian Pantone yang baru diperbaiki — perbedaannya, di sini
 * perbandingannya di JavaScript, jadi tidak ada dialek basis data yang
 * menyelamatkan kalau lupa.
 */
function samakan(teks: string): string {
  return teks
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function saringNav(items: ItemTerlabel[], kueri: string): HasilSaring[] {
  const q = samakan(kueri);
  if (!q) {
    // Tanpa kueri: semuanya lolos apa adanya, dan TIDAK ADA yang dibuka paksa.
    // Membuka semua grup saat kotak pencarian kosong mengubah menu jadi daftar
    // 53 baris — persis yang mau dihindari.
    return items.map((item) => ({ item, anak: item.anak ?? [], paksaBuka: false }));
  }

  const hasil: HasilSaring[] = [];
  for (const item of items) {
    const indukCocok = samakan(item.label).includes(q);
    const anakCocok = (item.anak ?? []).filter((a) => samakan(a.label).includes(q));

    if (indukCocok) {
      /*
       * Induk yang cocok membawa SELURUH anaknya, bukan hanya yang cocok.
       * Mengetik "keuangan" berarti mencari bagian itu; menyaring isinya jadi
       * kosong karena tidak ada anak yang bernama "keuangan" adalah jawaban
       * yang secara teknis benar dan sama sekali tidak berguna.
       */
      hasil.push({ item, anak: item.anak ?? [], paksaBuka: anakCocok.length > 0 });
      continue;
    }
    if (anakCocok.length > 0) {
      hasil.push({ item, anak: anakCocok, paksaBuka: true });
    }
  }
  return hasil;
}
