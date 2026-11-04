/**
 * Rupiah untuk layar — hasilnya SAMA PERSIS di server dan di setiap browser.
 *
 * Kenapa tidak `Intl.NumberFormat(..., { style: 'currency', currency: 'IDR' })`:
 * keluarannya bergantung pada data ICU tiap mesin. Node menulis "Rp 0", Safari
 * menulis "Rp0". Komponen yang dirender di server lalu dihidupkan di Safari
 * mendapat dua teks berbeda, dan React melaporkan hydration mismatch lalu
 * membangun ulang seluruh pohonnya di browser. Pengelompokan titik dan spasi
 * tak-putus ditulis tangan di sini supaya tidak ada yang bisa berbeda.
 */

const SPASI = ' ';

function bulatkan(nilai: number | string | null | undefined): number {
  const n = Number(nilai ?? 0);
  if (!Number.isFinite(n)) return 0;
  // Setengah menjauh dari nol, sama dengan pembulatan Intl.
  const r = Math.sign(n) * Math.round(Math.abs(n));
  return r === 0 ? 0 : r; // tidak pernah "-0"
}

const kelompokkan = (n: number) => String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** "Rp 22.850.000" — rupiah utuh, pengelompokan titik. */
export function formatRupiah(nilai: number | string | null | undefined): string {
  const n = bulatkan(nilai);
  return `${n < 0 ? '-' : ''}Rp${SPASI}${kelompokkan(n)}`;
}

/** "Rp 14,2 jt" — untuk ruang sempit. Satu desimal, ",0" dibuang. */
export function formatRupiahRingkas(nilai: number | string | null | undefined): string {
  const n = bulatkan(nilai);
  const abs = Math.abs(n);
  const tanda = n < 0 ? '-' : '';
  const satuan: [number, string][] = [
    [1e9, 'M'],
    [1e6, 'jt'],
    [1e3, 'rb'],
  ];
  for (const [batas, nama] of satuan) {
    if (abs >= batas) {
      const angka = (abs / batas).toFixed(1).replace(/\.0$/, '').replace('.', ',');
      return `${tanda}Rp${SPASI}${angka}${SPASI}${nama}`;
    }
  }
  return `${tanda}Rp${SPASI}${abs}`;
}
