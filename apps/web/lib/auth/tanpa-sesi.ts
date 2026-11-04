/**
 * Permintaan data (API) tanpa sesi dijawab 401 JSON oleh `proxy.ts`, tidak dialihkan ke /login.
 * Pengalihan membuat `fetch` menerima HTML halaman masuk dengan status 200, sehingga setiap
 * pembaca yang memanggil `.json()` gagal dengan "Unexpected token '<'" — terlihat 2026-10-18
 * sesudah laptop tidur lebih dari 8 jam dan sesinya habis (sinkron data referensi kantor).
 * Halaman tetap dialihkan ke /login.
 */
export function jawabTanpaSesiDenganJson(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/pwa/api/");
}
