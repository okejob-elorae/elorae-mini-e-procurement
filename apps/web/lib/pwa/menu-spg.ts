/**
 * Aturan menu bawah SPG — murni, supaya bisa dites tanpa browser.
 *
 * SPG punya menu sendiri, bukan menu salesman: pekerjaannya satu toko tetap
 * (jual, stok, nota), bukan berkeliling toko dan menagih.
 */

export type TabSpg = "beranda" | "jual" | "stok" | "nota" | "lainnya";

/**
 * Layar yang MENYEMBUNYIKAN menu: layar jual (punya bilah keranjang sendiri
 * di bawah — dua bilah bertumpuk membuat ketukan meleset), nota cetak, dan
 * setiap formulir SPG yang punya tombol kirim di bawah (opname, minta kiriman,
 * terima satu kiriman, retur baru, barang kembali dari pembeli, kirim mutasi).
 *
 * `/pwa/spg/terima` (daftar kiriman) TETAP bermenu; hanya formulir terima satu
 * kiriman (`/pwa/spg/terima/<jenis>/<id>`) yang tidak.
 */
const TANPA_MENU = [
  /^\/pwa\/spg\/sale(\/|$)/,
  /^\/pwa\/spg\/opname(\/|$)/,
  /^\/pwa\/spg\/stok\/minta(\/|$)/,
  /^\/pwa\/spg\/terima\/[^/]+\/[^/]+(\/|$)/,
  /^\/pwa\/spg\/mutasi\/kirim(\/|$)/,
  /^\/pwa\/retur\/baru(\/|$)/,
  /^\/pwa\/spg\/[^/]+\/(nota|kembali)(\/|$)/,
  // Tutup hari: formulir dengan bilah kirim sticky di bawah.
  /^\/pwa\/spg\/tutup(\/|$)/,
  /^\/pwa\/offline(\/|$)/,
];

export function tampilkanMenuSpg(path: string): boolean {
  return !TANPA_MENU.some((pola) => pola.test(path));
}

const DI_BAWAH = (akar: string) => (path: string) => path === akar || path.startsWith(`${akar}/`);

export function tabAktifSpg(path: string): TabSpg | null {
  if (path === "/pwa") return "beranda";
  // "Barang dicari" dibuka dari layar jual: pembeli menanyakan barang saat SPG melayaninya.
  if (["/pwa/spg/sale", "/pwa/spg/dicari", "/pwa/spg/produk", "/pwa/spg/antrean", "/pwa/spg/promo"].some((a) => DI_BAWAH(a)(path))) return "jual";
  if (["/pwa/spg/stok", "/pwa/spg/terima", "/pwa/spg/opname", "/pwa/spg/mutasi"].some((a) => DI_BAWAH(a)(path))) return "stok";
  if (path === "/pwa/spg/nota") return "nota";
  if (
    [
      "/pwa/spg/lainnya",
      "/pwa/spg/gaji",
      "/pwa/tampilan",
      "/pwa/retur",
      "/pwa/absen",
      "/pwa/pengumuman",
      "/pwa/target",
      "/pwa/peringkat",
      "/pwa/spg/analisa",
      "/pwa/spg/rekomendasi",
      "/pwa/spg/pelanggan",
      "/pwa/spg/titip",
      "/pwa/spg/tutup",
      "/pwa/spg/jadwal",
      "/pwa/spg/pengunjung",
      "/pwa/beban",
      // "Toko saya" ada di balik Lainnya — halaman toko dan checklist/panduan/harga pesaingnya.
      "/pwa/stores",
    ].some((a) => DI_BAWAH(a)(path))
  ) {
    return "lainnya";
  }
  return null;
}
