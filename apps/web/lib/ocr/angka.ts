/**
 * Membaca angka dari hasil OCR.
 *
 * Terpisah dari sisanya karena di sinilah letak kesalahan yang paling mahal.
 * Modul ini SUDAH pernah kena sekali: SheetJS membaca `"900.000"` sebagai
 * sembilan ratus, dan yang kena hanya nilai di bawah sejuta — jadi kerusakannya
 * tepat mengenai angka yang paling sering muncul. Tidak ada yang menyadarinya
 * sampai ada yang membandingkan totalnya dengan nota aslinya.
 *
 * Aturannya: dalam rupiah, TITIK ADALAH PEMISAH RIBUAN sampai terbukti
 * sebaliknya.
 */

/**
 * Apakah sepotong teks adalah angka.
 *
 * Menerima angka polos, bukan cuma yang berawalan `Rp` — temuan brief, dan
 * masuk akal: kolom qty dan kolom harga di nota jarang membawa "Rp".
 */
export function adalahAngka(teks: string): boolean {
  return /^(?:[Rr][Pp]\.?\s*)?\d[\d.,\s]*$/.test(teks.trim());
}

/**
 * Ubah sepotong teks jadi angka, atau `null` kalau bukan angka.
 *
 * `null`, BUKAN 0. Nol adalah nilai yang sah pada sebuah nota — barang yang
 * digratiskan, potongan penuh — jadi memakai 0 sebagai "tidak terbaca" membuat
 * kedua keadaan itu tidak bisa dibedakan lagi.
 */
export function keAngka(teks: string): number | null {
  if (!adalahAngka(teks)) return null;

  // Spasi di tengah angka adalah kebisingan OCR, bukan pemisah.
  const bersih = teks
    .trim()
    .replace(/^[Rr][Pp]\.?/, '')
    .replace(/\s/g, '');
  if (bersih === '') return null;

  const adaTitik = bersih.includes('.');
  const adaKoma = bersih.includes(',');

  let normal: string;
  if (adaTitik && adaKoma) {
    // Gaya Indonesia: titik ribuan, koma desimal.
    normal = bersih.replace(/\./g, '').replace(',', '.');
  } else if (adaKoma) {
    normal = pisahTunggal(bersih, ',');
  } else if (adaTitik) {
    normal = pisahTunggal(bersih, '.');
  } else {
    normal = bersih;
  }

  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

/**
 * Satu jenis pemisah saja: tebak ribuan atau desimal.
 *
 * Ekor TIGA digit tidak pernah berarti desimal dalam rupiah — `150.000` adalah
 * seratus lima puluh ribu, bukan seratus lima puluh koma nol. Itulah tepatnya
 * kesalahan SheetJS dulu.
 */
function pisahTunggal(bersih: string, pemisah: string): string {
  const bagian = bersih.split(pemisah);
  const ekor = bagian[bagian.length - 1];

  // Lebih dari satu pemisah tidak mungkin desimal.
  if (bagian.length > 2) return bagian.join('');
  // Ekor tepat tiga digit: pemisah ribuan.
  if (ekor.length === 3) return bagian.join('');
  // Ekor satu atau dua digit: desimal.
  if (ekor.length >= 1 && ekor.length <= 2) return `${bagian[0]}.${ekor}`;
  return bagian.join('');
}
