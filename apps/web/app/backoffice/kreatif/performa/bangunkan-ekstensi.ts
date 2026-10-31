/**
 * Bangunkan ekstensi Elorae Kreatif di Chrome yang sama (skrip konten `jembatan-elorae.js` di
 * extensions/elorae-kreatif meneruskan pesan ini ke service worker-nya) supaya ia mengecek seketika,
 * tidak menunggu alarm per menit. Tanpa ekstensi di peramban ini, pesannya tidak didengar siapa pun.
 * Bentuk pesan sama dengan yang diperiksa jembatan — ubah keduanya bersamaan.
 */
export function bangunkanEkstensi(): void {
  window.postMessage({ sumber: "elorae-kreatif-web", jenis: "bangunkan" }, window.location.origin);
}
