/**
 * Riwayat navigasi di dalam aplikasi HP — supaya tombol "Kembali" kembali ke
 * halaman yang BENAR-BENAR dibuka sebelumnya, bukan ke tujuan yang dipatok.
 *
 * Layar seperti Insentif, Jadwal, atau halaman toko bisa dibuka dari beberapa
 * tempat (beranda, Lainnya, Kabar). Tautan "← Beranda" yang dipatok membawa
 * orang yang datang dari Lainnya ke beranda — tempat yang tidak ia buka.
 *
 * Murni, supaya bisa dites. `RiwayatNavigasi` di layout mencatat setiap
 * perpindahan; `TautanKembali` memakai `adaSebelumnya` untuk memilih antara
 * `router.back()` dan tujuan cadangannya.
 *
 * Jenis perpindahan dicatat langsung dari `history.pushState` / `replaceState`
 * dan peristiwa `popstate` (lihat `RiwayatNavigasi`). Dulu memakai
 * `history.length`, tetapi Chrome membatasinya di 50 — di tab yang sudah lama
 * dipakai panjangnya berhenti naik, setiap perpindahan terbaca "ganti", dan
 * tombol kembali selalu jatuh ke tujuan cadangannya.
 */

export type JenisPerpindahan = "dorong" | "ganti" | "pop";

export type Riwayat = { tumpukan: string[] };

export const RIWAYAT_KOSONG: Riwayat = { tumpukan: [] };

const BATAS = 50;

/** Catat satu perpindahan ke `alamat`. */
export function catatPerpindahan(r: Riwayat, alamat: string, jenis: JenisPerpindahan): Riwayat {
  const t = r.tumpukan;
  if (t.length === 0) return { tumpukan: [alamat] };
  if (t[t.length - 1] === alamat) return r;
  if (jenis === "pop") {
    // Tombol mundur (browser/HP atau router.back()) ke halaman sebelumnya.
    if (t.length >= 2 && t[t.length - 2] === alamat) return { tumpukan: t.slice(0, -1) };
    // Maju lagi, atau mundur melewati halaman yang tidak tercatat: tidak bisa
    // dipastikan — mulai tumpukan baru supaya "Kembali" memakai cadangannya.
    return { tumpukan: [alamat] };
  }
  // Navigasi baru menambah halaman yang bisa dituju dengan "Kembali";
  // router.replace hanya mengganti halaman teratas.
  if (jenis === "dorong") return { tumpukan: [...t, alamat].slice(-BATAS) };
  return { tumpukan: [...t.slice(0, -1), alamat] };
}

/**
 * Jenis perpindahan dari hitungan pengamat sejak pencatatan terakhir.
 *
 * Urutan peristiwa TIDAK bisa diandalkan: di Chrome, Next sudah menggambar
 * halaman tujuan (dan pencatatan sudah berjalan) sebelum `popstate` tiba. Jadi
 * perpindahan tanpa push ke halaman tepat di bawah puncak tumpukan dianggap
 * mundur, sekalipun `popstate`-nya belum datang.
 */
export function jenisDariHitungan(hitung: { dorong: number; pop: number }, r: Riwayat, alamat: string): JenisPerpindahan {
  if (hitung.pop > 0) return "pop";
  if (hitung.dorong > 0) return "dorong";
  const t = r.tumpukan;
  return t.length >= 2 && t[t.length - 2] === alamat ? "pop" : "ganti";
}

/**
 * `popstate` yang tiba SESUDAH halamannya tercatat (lihat `jenisDariHitungan`)
 * harus diabaikan; kalau dihitung, ia tersisa dan membuat perpindahan
 * berikutnya terbaca mundur.
 */
export function popSudahTercatat(r: Riwayat, alamat: string): boolean {
  return r.tumpukan[r.tumpukan.length - 1] === alamat;
}

/** Ada halaman aplikasi sebelum halaman ini yang bisa dituju dengan `router.back()`. */
export function adaSebelumnya(r: Riwayat): boolean {
  return r.tumpukan.length >= 2;
}

export const KUNCI_RIWAYAT = "elorae.pwa.riwayat";

/** Baca dari sessionStorage; rusak/diblokir → kosong (tombol kembali memakai cadangannya). */
export function bacaRiwayat(): Riwayat {
  try {
    const raw = sessionStorage.getItem(KUNCI_RIWAYAT);
    if (!raw) return RIWAYAT_KOSONG;
    const x = JSON.parse(raw) as Partial<Riwayat>;
    if (!Array.isArray(x.tumpukan)) return RIWAYAT_KOSONG;
    return { tumpukan: x.tumpukan.filter((s): s is string => typeof s === "string") };
  } catch {
    return RIWAYAT_KOSONG;
  }
}

export function simpanRiwayat(r: Riwayat): void {
  try {
    sessionStorage.setItem(KUNCI_RIWAYAT, JSON.stringify(r));
  } catch {
    /* penyimpanan diblokir — tombol kembali memakai cadangannya */
  }
}
