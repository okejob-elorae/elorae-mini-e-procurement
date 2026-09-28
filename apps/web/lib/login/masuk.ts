/**
 * Serah terima animasi masuk dari halaman masuk ke halaman pertama sesudahnya.
 *
 * Animasinya melintasi dua dokumen: halaman masuk memudar ke hitam dan
 * menampilkan kartu judul, lalu berpindah halaman sungguhan
 * (`window.location`), dan halaman tujuan menyapa pengguna lalu memudar dari
 * hitam. Di antara keduanya tidak ada state React yang bertahan — hanya satu
 * entri `sessionStorage` ini.
 *
 * Bingkai pertama halaman tujuan HARUS sudah bertirai, atau dasbornya berkedip
 * sekejap sebelum tirainya muncul. Karena itu skrip di `<head>`
 * (`getMasukInitScript`) memasang `data-masuk` di `<html>` SEBELUM `<body>`
 * diurai, dan CSS-nya menampilkan tirai yang sudah ada di HTML server.
 */

export const KUNCI_MASUK = "elorae.masuk";

/** Atribut di `<html>` yang membuat tirai lanjutan tampil sejak bingkai pertama. */
export const ATRIBUT_MASUK = "data-masuk";

/**
 * Batas umur serah terima. Di produksi halaman tujuan tiba dalam satu detik;
 * di `next dev` kompilasi pertama bisa jauh lebih lama. Lewat dari ini, entrinya
 * dianggap basi — muat ulang halaman setengah menit kemudian tidak boleh
 * memutar ulang animasi masuk.
 */
export const UMUR_MASUK_MS = 30_000;

export type DataMasuk = {
  /** Nama depan untuk sapaan, kalau sesinya sempat terbaca. */
  nama: string | null;
};

export function simpanMasuk(data: DataMasuk): void {
  try {
    window.sessionStorage.setItem(KUNCI_MASUK, JSON.stringify({ ...data, t: Date.now() }));
  } catch {
    /* penyimpanan diblokir: halaman tujuan tampil tanpa tirai, tidak rusak */
  }
}

/** Baca serah terima tanpa menghapusnya — StrictMode menjalankan efek dua kali. */
export function bacaMasuk(sekarang: number = Date.now()): DataMasuk | null {
  try {
    const mentah = window.sessionStorage.getItem(KUNCI_MASUK);
    return uraiMasuk(mentah, sekarang);
  } catch {
    return null;
  }
}

export function hapusMasuk(): void {
  try {
    window.sessionStorage.removeItem(KUNCI_MASUK);
  } catch {
    /* diabaikan */
  }
}

/** Murni, supaya bisa diuji tanpa peramban. */
export function uraiMasuk(mentah: string | null, sekarang: number): DataMasuk | null {
  if (!mentah) return null;
  let d: unknown;
  try {
    d = JSON.parse(mentah);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;
  if (typeof o.t !== "number" || sekarang - o.t > UMUR_MASUK_MS || sekarang < o.t) return null;
  const nama = typeof o.nama === "string" && o.nama.trim() ? o.nama.trim().slice(0, 40) : null;
  return { nama };
}

/** Nama depan saja: "Timotius Maxmillian Widodo" → "Timotius". */
export function namaDepan(nama: string | null | undefined): string | null {
  const depan = nama?.trim().split(/\s+/)[0];
  return depan ? depan : null;
}

/**
 * Skrip `<head>`: pasang `data-masuk` sebelum halaman dilukis. Sengaja tidak
 * menghapus entrinya — komponen tirai masih perlu namanya, dan ia yang
 * menghapus sesudah tirai terbuka.
 */
export function getMasukInitScript(): string {
  return `(function(){try{var r=sessionStorage.getItem(${JSON.stringify(KUNCI_MASUK)});if(!r)return;var d=JSON.parse(r);if(!d||typeof d.t!=="number"||Date.now()-d.t>${UMUR_MASUK_MS}||Date.now()<d.t||matchMedia("(prefers-reduced-motion: reduce)").matches){sessionStorage.removeItem(${JSON.stringify(KUNCI_MASUK)});return;}document.documentElement.setAttribute(${JSON.stringify(ATRIBUT_MASUK)},"");}catch(e){}})();`;
}
