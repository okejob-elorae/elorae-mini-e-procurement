/**
 * Warna tetap untuk sebuah kode.
 *
 * Kode master — jenis pemasok, kategori — dibuat pengguna, jadi warnanya tidak
 * bisa dipatok satu per satu di kode program. Diturunkan dari teksnya: kode
 * yang sama SELALU mendapat warna yang sama, di layar mana pun, tanpa perlu
 * kolom baru di basis data. Sekali orang hafal FABRIC itu biru, ia mengenalinya
 * di daftar pemasok juga.
 *
 * Warnanya BUKAN pembawa arti. Kodenya selalu tertulis di sebelahnya, jadi
 * yang buta warna tidak kehilangan apa pun — ini penanda identitas, bukan
 * pengkodean data. (Kalau suatu hari warnanya jadi satu-satunya pembeda,
 * aturannya berubah dan palet ini harus divalidasi ulang untuk peran itu.)
 *
 * Ronanya diambil dari palet kategoris yang sudah divalidasi — pita terang,
 * lantai kepekatan, dan pemisahan bagi mata buta warna semuanya sudah diukur,
 * bukan dipilih dengan mata.
 */

/**
 * TIGA rona, bukan tujuh — dan angka itu hasil pengukuran, bukan selera.
 *
 * Mula-mula saya pakai tujuh slot palet kategoris. Hasilnya ACCESSORIES dan
 * TAILOR sama-sama hijau di layar, dan tes saya sendiri meloloskannya karena
 * ia cuma memeriksa hex-nya berbeda — bukan apakah mata bisa membedakannya.
 *
 * Diukur ulang dengan pemeriksa palet pada SELURUH pasangan (bukan hanya yang
 * bersebelahan — untuk warna hasil sebar, dua kode mana pun bisa mendarat di
 * slot mana pun), tujuh rona itu GAGAL: hijau vs jingga ΔE 3,2 bagi protanopia,
 * dan merah muda vs jingga 12,9 bahkan bagi mata normal. Tidak ada rona keempat
 * yang lolos di mode terang DAN gelap sekaligus.
 *
 * AKIBATNYA JUJUR: dengan tiga rona, kode keempat pasti berbagi warna dengan
 * salah satu sebelumnya. Itu diterima karena warnanya memang bukan pembawa
 * arti — kodenya selalu tertulis di dalam kepingnya. Tiga warna yang benar-
 * benar terbedakan lebih baik daripada tujuh yang dua di antaranya kembar.
 */
const RONA = [
  { terang: '#2a78d6', gelap: '#3987e5' },
  { terang: '#eb6834', gelap: '#d95926' },
  { terang: '#1baf7a', gelap: '#199e70' },
] as const;

/**
 * Sebar teks jadi satu angka.
 *
 * FNV-1a — kecil, tanpa pustaka, dan yang penting STABIL: tidak bergantung
 * urutan, jumlah baris, atau apa pun selain teksnya sendiri. Kode yang
 * warnanya berpindah saat daftarnya bertambah tidak akan pernah dihafal
 * siapa pun.
 */
function sebar(teks: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < teks.length; i++) {
    h ^= teks.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function warnaKode(kode: string): { terang: string; gelap: string } {
  if (!kode) return RONA[0];
  return RONA[sebar(kode.trim().toUpperCase()) % RONA.length];
}

/**
 * Gaya siap pakai untuk keping kecil di samping kode.
 *
 * Latarnya sangat tipis dan tulisannya pekat — keping penuh warna di setiap
 * baris tabel membuat tabelnya jadi papan lampu, dan mata berhenti membaca
 * teksnya.
 */
export function gayaKeping(kode: string): React.CSSProperties {
  const w = warnaKode(kode);
  return {
    '--kode-warna': w.terang,
    '--kode-warna-gelap': w.gelap,
  } as React.CSSProperties;
}
