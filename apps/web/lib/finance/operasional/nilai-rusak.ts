/*
 * Nilai gudang barang rusak — MURNI. Buku gudang rusak (`DamagedStockMovement`)
 * menyimpan qty; nilainya dihitung dengan memutar ulang gerakan satu barang ×
 * varian menurut urutan waktu (rata-rata bergerak):
 *
 * - MASUK_RETUR menambah nilai sebesar `value`-nya (qty × harga rata-rata
 *   barang saat dihitung gudang — sama dengan yang didebit jurnal returnya ke
 *   `INVENTORY_DAMAGED`). Baris lama tanpa `value` memakai harga cadangan.
 * - Keputusan (PERBAIKI, JUAL_OBRAL, MUSNAHKAN) mengurangi nilai sebesar
 *   bagiannya dari saldo: nilai saldo × qty keluar ÷ qty saldo, dibulatkan ke
 *   sen. Keluar yang menghabiskan saldo mengambil SELURUH sisa nilainya, jadi
 *   tidak ada sen yang tertinggal di barang yang qty-nya nol.
 *
 * Nilai keluar yang SUDAH tercatat (`value` PERBAIKI/MUSNAHKAN, atau biaya
 * JUAL_OBRAL di jejak keputusannya) dipakai apa adanya — jurnalnya sudah
 * diposting dengan angka itu.
 */

export type GerakRusak = {
  id: string;
  kind: string;
  /** Bertanda: masuk positif, keluar negatif. */
  qty: number;
  /** MASUK_RETUR: nilai masuk. PERBAIKI/MUSNAHKAN: nilai keluar (bila sudah dicatat). JUAL_OBRAL: hasil jual — DIABAIKAN di sini. */
  value: number | null;
  createdAt: Date;
};

export type HasilPutarRusak = {
  /** Nilai keluar per id gerakan keputusan, dalam sen. */
  keluarSen: Map<string, number>;
  /** Nilai masuk per id gerakan MASUK_RETUR, dalam sen (termasuk yang memakai cadangan). */
  masukSen: Map<string, number>;
  /** Saldo akhir. */
  qty: number;
  sen: number;
};

const keSen = (n: number): number => Math.round(Number(((Number.isFinite(n) ? n : 0) * 100).toFixed(4)));

/** Urutkan gerakan menurut waktu lalu id — urutan yang sama di setiap pemutaran. */
export function urutGerak<T extends { id: string; createdAt: Date }>(gerak: readonly T[]): T[] {
  return [...gerak].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Putar ulang gerakan SATU barang × varian. `hargaCadangan` = harga per potong
 * untuk MASUK_RETUR lama tanpa `value`; `keluarTercatat` = nilai keluar JUAL_OBRAL
 * yang sudah dicatat di jejaknya (per id gerakan, rupiah).
 */
export function putarGudangRusak(
  gerak: readonly GerakRusak[],
  hargaCadangan: number,
  keluarTercatat: ReadonlyMap<string, number> = new Map(),
): HasilPutarRusak {
  const keluarSen = new Map<string, number>();
  const masukSen = new Map<string, number>();
  let qty = 0;
  let sen = 0;
  for (const g of urutGerak(gerak)) {
    if (g.kind === "MASUK_RETUR") {
      const q = Math.abs(g.qty);
      const nilai = g.value !== null && Number.isFinite(g.value) ? keSen(g.value) : keSen(q * hargaCadangan);
      masukSen.set(g.id, nilai);
      qty += q;
      sen += nilai;
      continue;
    }
    const q = Math.abs(g.qty);
    const tercatat = g.kind === "JUAL_OBRAL" ? keluarTercatat.get(g.id) : g.value;
    let keluar: number;
    if (tercatat !== null && tercatat !== undefined && Number.isFinite(tercatat)) keluar = keSen(tercatat);
    else if (qty <= 0) keluar = 0;
    else if (q >= qty) keluar = sen;
    else keluar = Math.round((sen * q) / qty);
    keluarSen.set(g.id, keluar);
    qty -= q;
    sen -= keluar;
  }
  return { keluarSen, masukSen, qty, sen };
}
