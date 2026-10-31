import { bagiKomisi } from "@/lib/konsinyasi/aturan";

/**
 * Aturan stok toko untuk SPG — murni, tanpa basis data.
 *
 * Saldo = Σ gerakan (masuk dari penerimaan kiriman, keluar dari penjualan,
 * koreksi dari opname). Dihitung, tidak disimpan. Saldo NEGATIF dibiarkan:
 * barang yang laku di toko sungguh laku, dan menolaknya hanya karena buku
 * sistem nol membuat penjualan tidak tercatat sama sekali.
 */

/** Kunci satu baris stok. Varian kosong dan null adalah hal yang sama. */
export function kunciBaris(itemId: string, variantSku: string | null | undefined): string {
  return `${itemId}::${variantSku ?? ""}`;
}

export type Gerakan = { itemId: string; variantSku: string | null; qty: number };

export function saldoDariGerakan(gerakan: Gerakan[]): Map<string, number> {
  const saldo = new Map<string, number>();
  for (const g of gerakan) {
    const k = kunciBaris(g.itemId, g.variantSku);
    saldo.set(k, (saldo.get(k) ?? 0) + g.qty);
  }
  return saldo;
}

export type BarisHitung = { itemId: string; variantSku: string | null; qtyCounted: number };
export type BarisOpname = {
  itemId: string;
  variantSku: string;
  qtySystem: number;
  qtyCounted: number;
  /** Gerakan OPNAME yang harus ditulis: hitungan − saldo sistem. */
  selisih: number;
};

/**
 * Hasil opname per baris. Barang yang dihitung dua kali dijumlahkan (SPG
 * menghitung rak depan dan gudang belakang terpisah). Barang yang tidak
 * dihitung tidak muncul — opname sebagian tidak menihilkan sisanya.
 */
export function rencanaOpname(hitung: BarisHitung[], saldo: Map<string, number>): BarisOpname[] {
  const gabung = new Map<string, { itemId: string; variantSku: string; qtyCounted: number }>();
  for (const h of hitung) {
    const k = kunciBaris(h.itemId, h.variantSku);
    const ada = gabung.get(k);
    if (ada) ada.qtyCounted += h.qtyCounted;
    else gabung.set(k, { itemId: h.itemId, variantSku: h.variantSku ?? "", qtyCounted: h.qtyCounted });
  }
  return [...gabung.entries()].map(([k, b]) => {
    const qtySystem = saldo.get(k) ?? 0;
    return { ...b, qtySystem, selisih: b.qtyCounted - qtySystem };
  });
}

export type BarisKatalogKode = {
  itemId: string;
  sku: string;
  variantSku: string | null;
  barcode: string | null;
};

export type HasilKode =
  | { jenis: "varian"; itemId: string; variantSku: string | null }
  | { jenis: "barang"; itemId: string };

const rapikan = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * Cocokkan hasil pindai (atau ketikan) ke barang.
 *
 * Urutannya: barcode varian, SKU varian, lalu SKU barang. Label barcode belum
 * diputuskan pemilik — urutan ini bekerja untuk label berisi barcode dari
 * Jubelio maupun label berisi SKU. SKU induk dari barang bervarian tidak
 * cukup: hasilnya "barang", dan layar menanyakan ukurannya.
 */
export function cocokkanKode(kode: string, katalog: BarisKatalogKode[]): HasilKode | null {
  const k = rapikan(kode);
  if (!k) return null;
  const barcode = katalog.find((b) => b.barcode && rapikan(b.barcode) === k);
  if (barcode) return { jenis: "varian", itemId: barcode.itemId, variantSku: barcode.variantSku };
  const varian = katalog.find((b) => b.variantSku && rapikan(b.variantSku) === k);
  if (varian) return { jenis: "varian", itemId: varian.itemId, variantSku: varian.variantSku };
  const induk = katalog.filter((b) => rapikan(b.sku) === k);
  if (induk.length === 0) return null;
  if (induk.length === 1 && !induk[0].variantSku) return { jenis: "varian", itemId: induk[0].itemId, variantSku: null };
  return { jenis: "barang", itemId: induk[0].itemId };
}

/** Baris yang stoknya di bawah atau sama dengan batas, paling sedikit dulu. */
export function hampirHabis<T extends { qty: number }>(baris: T[], batas: number): T[] {
  return baris.filter((b) => b.qty <= batas).sort((a, b) => a.qty - b.qty);
}

/**
 * Perkiraan komisi bulan berjalan: unit terjual × tarif komisi barang, dibagi
 * rata antar SPG toko itu — aturan yang sama dengan hitungan resmi saat siklus
 * konsinyasi dikunci (`bagiKomisi`). Ini PERKIRAAN; yang dibayar tetap angka
 * siklus yang dikunci.
 */
export function perkiraanKomisi(
  terjual: { qty: number; commissionPerPcs: number }[],
  jumlahSpg: number,
): { totalToko: number; bagianSaya: number } {
  const { totalKomisi, perSpg } = bagiKomisi(terjual, jumlahSpg);
  // Bagian SPG yang MELIHAT layar: pembagian rata (sisa receh jatuh ke SPG
  // pertama di hitungan resmi; perkiraan tidak mengklaim sisa itu).
  return { totalToko: totalKomisi, bagianSaya: perSpg.length ? perSpg[perSpg.length - 1] : 0 };
}
