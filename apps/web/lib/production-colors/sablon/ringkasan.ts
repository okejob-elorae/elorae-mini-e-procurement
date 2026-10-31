/**
 * Ringkasan teks untuk tukang sablon — yang disalin ke WhatsApp atau dicetak.
 *
 * Fungsi murni: semua label datang sudah diterjemahkan, angka sudah
 * diformat. Yang dijaga di sini hanya susunannya — satu blok per huruf, gram
 * yang jumlahnya tepat berat adonan — karena teks ini dipegang orang yang
 * sedang menimbang tinta, bukan orang yang sedang melihat layar.
 */

export type BarisRingkasan = {
  huruf: string;
  judul: string;
  rincian: string;
  resep: string | null;
};

export function susunRingkasan(input: {
  kepala: string[];
  baris: BarisRingkasan[];
  catatan: string;
}): string {
  const blok = input.baris.map((b) => [`${b.huruf} — ${b.judul}`, `    ${b.rincian}`, ...(b.resep ? [`    ${b.resep}`] : [])].join('\n'));
  return [...input.kepala, '', blok.join('\n\n'), '', input.catatan].join('\n');
}
