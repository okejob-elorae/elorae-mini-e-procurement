/**
 * "Check-in dulu, lalu kembali ke layar tadi" untuk SPG.
 *
 * Layar yang butuh check-in (terima kiriman, opname, jual) mengirim SPG ke
 * beranda dengan `/pwa?kembali=<layar>`. Aksi `checkIn` selalu mengalihkan ke
 * halaman toko, jadi tujuan itu dititipkan di `sessionStorage` sesaat sebelum
 * check-in dan diambil halaman toko sesudahnya — terikat ke toko yang sama dan
 * hanya berlaku sebentar, supaya titipan lama tidak pernah membajak kunjungan
 * berikutnya.
 *
 * HANYA alamat di dalam aplikasi HP (`/pwa/...`) yang diterima: `kembali`
 * datang dari URL, dan URL bisa dibuat siapa saja.
 */

export const KUNCI_KEMBALI = "elorae.pwa.kembaliSetelahCheckIn";
/** Check-in (GPS + server + alih ke halaman toko) jauh lebih cepat dari ini. */
export const UMUR_TITIPAN_MS = 2 * 60 * 1000;
const PANJANG_MAKS = 300;
const ASAL_PALSU = "http://elorae.invalid";

/** Alamat `/pwa/...` yang aman dituju, dinormalkan; `null` untuk selain itu. */
export function kembaliAman(nilai: unknown): string | null {
  if (typeof nilai !== "string" || nilai.length === 0 || nilai.length > PANJANG_MAKS) return null;
  // Hanya jalur relatif-akar; "//host" dan "\\host" adalah alamat situs lain.
  if (!nilai.startsWith("/") || nilai.startsWith("//") || nilai.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(nilai)) return null;
  let url: URL;
  try {
    url = new URL(nilai, ASAL_PALSU);
  } catch {
    return null;
  }
  // `new URL` membereskan "/pwa/../admin" menjadi "/admin" — diperiksa SESUDAHNYA.
  if (url.origin !== ASAL_PALSU || !url.pathname.startsWith("/pwa/")) return null;
  return `${url.pathname}${url.search}`;
}

/** Tautan ke beranda untuk check-in, membawa layar tujuan sesudahnya. */
export function tautanCheckInLaluKembali(path: string | null | undefined): string {
  const aman = kembaliAman(path);
  return aman ? `/pwa?kembali=${encodeURIComponent(aman)}` : "/pwa";
}

/** Isi titipan di `sessionStorage`. */
export function isiTitipan(storeId: string, kembali: string, sekarang: number): string {
  return JSON.stringify({ storeId, kembali, waktu: sekarang });
}

/**
 * Baca titipan mentah: tujuan yang aman bila titipan itu untuk toko INI dan
 * masih segar, `null` untuk selain itu (rusak, toko lain, kedaluwarsa).
 */
export function bacaTitipan(mentah: string | null, storeId: string, sekarang: number): string | null {
  if (!mentah) return null;
  try {
    const d = JSON.parse(mentah) as { storeId?: unknown; kembali?: unknown; waktu?: unknown };
    if (d.storeId !== storeId || typeof d.waktu !== "number") return null;
    const umur = sekarang - d.waktu;
    if (umur < 0 || umur > UMUR_TITIPAN_MS) return null;
    return kembaliAman(d.kembali);
  } catch {
    return null;
  }
}

/** Titipkan tujuan sesaat sebelum check-in. Penyimpanan bisa dilarang — diam saja. */
export function titipKembali(storeId: string, kembali: string): void {
  const aman = kembaliAman(kembali);
  if (!aman) return;
  try {
    window.sessionStorage.setItem(KUNCI_KEMBALI, isiTitipan(storeId, aman, Date.now()));
  } catch {
    // Tanpa penyimpanan, SPG tetap mendarat di halaman tokonya.
  }
}

/** Buang titipan (check-in ditolak, atau sudah dipakai). */
export function buangTitipan(): void {
  try {
    window.sessionStorage.removeItem(KUNCI_KEMBALI);
  } catch {
    // Penyimpanan dilarang: tidak ada yang perlu dibuang.
  }
}

/** Ambil-dan-hapus titipan untuk toko ini; `null` bila tidak ada yang berlaku. */
export function ambilTitipan(storeId: string): string | null {
  let mentah: string | null = null;
  try {
    mentah = window.sessionStorage.getItem(KUNCI_KEMBALI);
  } catch {
    return null;
  }
  if (mentah === null) return null;
  buangTitipan();
  return bacaTitipan(mentah, storeId, Date.now());
}
