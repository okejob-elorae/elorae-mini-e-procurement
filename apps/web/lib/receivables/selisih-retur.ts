/**
 * Selisih retur toko — aturan murni, tanpa impor (aman untuk komponen klien).
 *
 * Satu sumber untuk tugas cek sales di HP, halaman rincian retur, teks kabar,
 * stok titipan konsinyasi, dan koreksi buku stok toko sesudah barang susulan
 * datang. Uangnya di `rules.ts`; berkas ini hanya menghitung barang.
 */

/** Satu baris barang dengan jumlahnya (nota toko atau hitungan gudang). */
export type BarisQty = { itemId: string | null; variantSku: string | null; itemName: string; qty: number };

/**
 * Kunci satu barang di nota retur: barang + ukuran, atau nama untuk baris yang
 * hanya diketik namanya. Aturan yang sama dengan penulis retur.
 */
export function kunciBarangRetur(b: { itemId?: string | null; variantSku?: string | null; itemName: string }): string {
  return b.itemId ? `${b.itemId}::${b.variantSku?.trim() ?? ""}` : `nama::${b.itemName.trim()}`;
}

/**
 * Barang yang KURANG per kunci: jumlah di nota toko dikurangi seluruh yang
 * dihitung gudang — hitungan asli DITAMBAH setiap hitungan susulan yang sudah
 * final. Barang RUSAK atau KEDALUWARSA tetap terhitung diterima (barangnya
 * sampai). Tidak pernah negatif: kelebihan satu barang tidak menutupi
 * kekurangan barang lain.
 */
export function kurangPerBarang(
  klaim: readonly BarisQty[],
  hitungan: readonly BarisQty[],
): {
  kunci: string;
  itemId: string | null;
  itemName: string;
  variantSku: string | null;
  qtyKlaim: number;
  qtyDiterima: number;
  qtyKurang: number;
}[] {
  const diterima = new Map<string, number>();
  for (const h of hitungan) {
    const k = kunciBarangRetur(h);
    diterima.set(k, (diterima.get(k) ?? 0) + h.qty);
  }
  const perKunci = new Map<string, { itemId: string | null; itemName: string; variantSku: string | null; qtyKlaim: number }>();
  for (const b of klaim) {
    const k = kunciBarangRetur(b);
    const ada = perKunci.get(k);
    if (ada) ada.qtyKlaim += b.qty;
    else perKunci.set(k, { itemId: b.itemId, itemName: b.itemName, variantSku: b.variantSku, qtyKlaim: b.qty });
  }
  return [...perKunci].map(([kunci, b]) => {
    const qtyDiterima = diterima.get(kunci) ?? 0;
    return { kunci, ...b, qtyDiterima, qtyKurang: Math.max(0, b.qtyKlaim - qtyDiterima) };
  });
}

/**
 * Sisa selisih rupiah sebuah nota: nilai klaim dikurangi nilai fisik (asli +
 * susulan), dalam sen, tidak pernah negatif. `nilaiFisik` null = gudang belum
 * menghitung apa pun, jadi seluruh klaimnya masih selisih.
 */
export function sisaSelisih(nilaiKlaim: number, nilaiFisik: number | null): number {
  const sen = (n: number) => Math.round(n * 100);
  if (nilaiFisik === null) return Math.max(0, sen(nilaiKlaim)) / 100;
  return Math.max(0, sen(nilaiKlaim) - sen(nilaiFisik)) / 100;
}

type KunciStok = { itemId: string; variantSku: string | null };
const kunciStok = (b: KunciStok) => `${b.itemId}::${b.variantSku ?? ""}`;

/**
 * Berapa dari barang susulan yang harus DIKELUARKAN lagi dari buku stok toko.
 *
 * Saat nota retur dicatat, seluruh klaimnya keluar dari buku toko (RETUR_KELUAR).
 * Barang yang ternyata tertinggal di toko baru terlihat lagi kalau opname toko
 * menemukannya (OPNAME tambah) SESUDAH keluarnya itu. Susulannya hanya boleh
 * mengeluarkan sebanyak kelebihan opname itu, dikurangi yang sudah dikeluarkan
 * susulan sebelumnya — tanpa opname tidak ada yang dikeluarkan, karena buku
 * toko sudah tidak memuatnya. Kelebihan opname SEBELUM nota retur keluar bukan
 * barang ini dan diabaikan.
 */
export function keluarBukuSusulan(input: {
  susulan: readonly (KunciStok & { qty: number })[];
  keluarNrt: readonly (KunciStok & { pertama: Date })[];
  opnamePlus: readonly (KunciStok & { qty: number; pada: Date })[];
  sudahSusulan: readonly (KunciStok & { qty: number })[];
}): { itemId: string; variantSku: string | null; qty: number }[] {
  const keluar = new Map(input.keluarNrt.map((k) => [kunciStok(k), k.pertama.getTime()]));
  const sudah = new Map<string, number>();
  for (const s of input.sudahSusulan) sudah.set(kunciStok(s), (sudah.get(kunciStok(s)) ?? 0) + s.qty);
  const terpakai = new Map<string, number>();
  const hasil: { itemId: string; variantSku: string | null; qty: number }[] = [];
  for (const s of input.susulan) {
    const k = kunciStok(s);
    const sejak = keluar.get(k);
    if (sejak === undefined || !(s.qty > 0)) continue;
    const lebih = input.opnamePlus
      .filter((o) => kunciStok(o) === k && o.pada.getTime() > sejak)
      .reduce((n, o) => n + Math.max(0, o.qty), 0);
    const ruang = Math.max(0, lebih - (sudah.get(k) ?? 0) - (terpakai.get(k) ?? 0));
    const qty = Math.min(s.qty, ruang);
    if (qty <= 0) continue;
    terpakai.set(k, (terpakai.get(k) ?? 0) + qty);
    hasil.push({ itemId: s.itemId, variantSku: s.variantSku, qty });
  }
  return hasil;
}
