/**
 * Serah terima animasi masuk dari halaman masuk ke halaman pertama sesudahnya.
 *
 * Animasinya melintasi dua dokumen: halaman masuk menutup layar dan memunculkan
 * wordmark, lalu berpindah halaman sungguhan (`window.location`), dan halaman
 * tujuan melanjutkannya dengan lelucon harian sebelum membuka aplikasi. Di
 * antara keduanya tidak ada state React yang bertahan — hanya satu entri
 * `sessionStorage` ini.
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
  /**
   * Warna wordmark persis seperti di panel halaman masuk — warna tema pengguna
   * yang sudah dinaikkan terangnya untuk latar tinta (`warnaMerekDiGelap`).
   * Ikut diserahkan karena halaman tujuan harus melukisnya SEBELUM JavaScript
   * sempat menghitung ulang.
   */
  warna: string | null;
};

/**
 * Warna CSS yang boleh lewat: hex, `rgb(...)`, `oklch(...)`, nama warna.
 * `warnaMerekDiGelap` mengembalikan nilai tema apa adanya kalau bukan hex,
 * jadi hex saja tidak cukup. Tanpa titik koma, kutip, atau kurung kurawal —
 * nilainya masuk ke `style.setProperty` dan tidak boleh bisa menutup deklarasi.
 */
const WARNA = /^[#a-zA-Z0-9(),.%\s/-]{3,64}$/;

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
  const warna = typeof o.warna === "string" && WARNA.test(o.warna) ? o.warna : null;
  return { warna };
}

/**
 * Skrip `<head>`: pasang `data-masuk` dan warna wordmark sebelum halaman
 * dilukis. Sengaja tidak menghapus entrinya — komponen tirai membacanya lagi
 * sesudah hidrasi, dan ia yang menghapus sesudah tirai terbuka.
 */
export function getMasukInitScript(): string {
  return `(function(){try{var r=sessionStorage.getItem(${JSON.stringify(KUNCI_MASUK)});if(!r)return;var d=JSON.parse(r);if(!d||typeof d.t!=="number"||Date.now()-d.t>${UMUR_MASUK_MS}||Date.now()<d.t||matchMedia("(prefers-reduced-motion: reduce)").matches){sessionStorage.removeItem(${JSON.stringify(KUNCI_MASUK)});return;}var h=document.documentElement;h.setAttribute(${JSON.stringify(ATRIBUT_MASUK)},"");if(typeof d.warna==="string"&&${WARNA.toString()}.test(d.warna)&&CSS.supports("color",d.warna))h.style.setProperty("--masuk-merek",d.warna);}catch(e){}})();`;
}
