/**
 * Aturan menu bawah salesman — murni, supaya bisa dites tanpa browser.
 *
 * Satu menu untuk seluruh aplikasi salesman. Sebelumnya ada tiga cara berpindah
 * halaman (ubin di beranda, menu bawah khusus piutang, tombol kembali di
 * sisanya), dan halaman piutang sempat tidak punya jalan pulang sama sekali.
 */

export type TabSalesman = "beranda" | "toko" | "tagihan" | "pelunasan" | "lainnya";

/**
 * Layar yang MENYEMBUNYIKAN menu: alur isian dan layar jual yang punya bilah
 * aksinya sendiri di bawah (total keranjang, tombol kirim). Menu di sana akan
 * bertumpuk dengan bilah itu, dan ketukan yang meleset ke menu membuang isian.
 */
const TANPA_MENU = [
  /^\/pwa\/stores\/[^/]+\/(catalog|smart-request)(\/|$)/,
  // Formulir rekomendasi barang dari analisa toko: bilah kirim sendiri di bawah.
  /^\/pwa\/stores\/[^/]+\/analisa\/rekomendasi(\/|$)/,
  /^\/pwa\/van(\/|$)/,
  /^\/pwa\/(bkm|retur)\/baru(\/|$)/,
  // Retur lapangan satu toko, formulir pelunasan satu toko, dan bukti BKM satu
  // pelunasan: masing-masing punya bilah aksi sticky di bawah.
  /^\/pwa\/stores\/[^/]+\/retur(\/|$)/,
  /^\/pwa\/pelunasan\/[^/]+(\/|$)/,
  /^\/pwa\/bkm\/[^/]+(\/|$)/,
  /^\/pwa\/piutang\/[^/]+\/janji(\/|$)/,
  /^\/pwa\/stores\/baru(\/|$)/,
  /^\/pwa\/biaya\/baru(\/|$)/,
  /^\/pwa\/spg(\/|$)/,
  /^\/pwa\/offline(\/|$)/,
];

export function tampilkanMenu(path: string): boolean {
  return !TANPA_MENU.some((pola) => pola.test(path));
}

const DI_BAWAH = (akar: string) => (path: string) => path === akar || path.startsWith(`${akar}/`);

/** Tab yang menyala untuk sebuah alamat. Halaman di balik "Lainnya" menyalakan Lainnya. */
export function tabAktif(path: string): TabSalesman | null {
  if (path === "/pwa") return "beranda";
  if (DI_BAWAH("/pwa/stores")(path)) return "toko";
  if (DI_BAWAH("/pwa/piutang")(path)) return "tagihan";
  if (DI_BAWAH("/pwa/bkm")(path)) return "pelunasan";
  if (
    [
      "/pwa/lainnya",
      "/pwa/retur",
      "/pwa/beban",
      "/pwa/tampilan",
      "/pwa/orders",
      "/pwa/insentif",
      "/pwa/penjualan",
      "/pwa/permintaan",
      "/pwa/rekomendasi",
      "/pwa/peringkat",
      "/pwa/biaya",
      "/pwa/absen",
      "/pwa/hari-ini",
      "/pwa/tukar",
      "/pwa/rute",
      "/pwa/target",
      "/pwa/jadwal",
      "/pwa/pengumuman",
    ].some((a) => DI_BAWAH(a)(path))
  ) {
    return "lainnya";
  }
  return null;
}
