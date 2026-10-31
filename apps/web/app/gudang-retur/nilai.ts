import type { MenungguGudang } from "@/lib/receivables/pwa-queries";

/**
 * Nota retur seperti yang dilihat penghitung gudang: TANPA klaim.
 *
 * Gudang menghitung barang yang sampai, bukan menyalin angka nota. Kalau qty
 * klaim terlihat (apalagi terisi di kolom hitung), satu tekan "Simpan" mencatat
 * fisik = klaim tanpa ada yang menghitung — dan selisih yang seharusnya ditahan
 * lenyap. Maka qty klaim dan nilai klaim tidak ikut dikirim ke peramban sama
 * sekali; klaimnya baru diperlihatkan sesudah hitungan tersimpan.
 */
export type BarisHitung = {
  itemId: string | null;
  variantSku: string;
  itemName: string;
  /** Harga baris (NRT SPG toko konsi). Nol untuk nota toko putus. */
  price: number;
  condition: "LAYAK" | "RUSAK" | "EXPIRED";
};

export type NotaHitung = {
  id: string;
  noNrt: string;
  storeName: string;
  tanggal: string;
  caraKirim: string;
  adaFoto: boolean;
  dariSpg: boolean;
  baris: BarisHitung[];
  /**
   * Nilai per potong untuk nota yang barisnya tak berharga (NRT SPG toko putus:
   * nilainya total nota toko). Nol kalau barisnya berharga atau tidak ada qty.
   */
  nilaiPerPotong: number;
  /** Penghitung adalah pelapor nota ini — server menolak hitungannya. */
  milikSendiri: boolean;
};

/** Buang klaim dari nota sebelum dikirim ke layar hitung. Murni, dites tanpa basis data. */
export function untukPenghitung(n: MenungguGudang, penghitungId: string, pelaporId: string | null): NotaHitung {
  const berharga = n.baris.some((b) => b.price > 0);
  const qtyKlaim = n.baris.reduce((s, b) => s + b.qty, 0);
  return {
    id: n.id,
    noNrt: n.noNrt,
    storeName: n.storeName,
    tanggal: n.tanggal,
    caraKirim: n.caraKirim,
    adaFoto: n.adaFoto,
    dariSpg: n.dariSpg,
    baris: n.baris.map((b) => ({
      itemId: b.itemId,
      variantSku: b.variantSku,
      itemName: b.itemName,
      price: b.price,
      condition: b.condition,
    })),
    nilaiPerPotong: !berharga && qtyKlaim > 0 ? n.nilaiKlaim / qtyKlaim : 0,
    milikSendiri: pelaporId !== null && pelaporId === penghitungId,
  };
}

/**
 * Nilai fisik awal yang diisikan ke layar hitung gudang, dari hitungan per baris.
 *
 * - Baris berharga (NRT SPG toko KONSI, nilai dihitung server): jumlah qty yang
 *   diterima × harga barisnya.
 * - Baris tanpa harga (NRT SPG toko PUTUS: barisnya hanya qty, nilainya total
 *   nota toko): potong yang diterima × nilai per potong nota.
 *
 * Baris yang belum diisi dihitung nol — bukan klaim. Hanya usulan: gudang boleh
 * mengubahnya, dan yang diketik yang tersimpan. Barang rusak ikut terhitung: ia
 * sampai di gudang. Siapa menanggung nilainya adalah keputusan beban di kantor.
 */
export function nilaiHitunganAwal(
  baris: { price: number }[],
  qtyDiterima: number[],
  nilaiPerPotong: number,
): number {
  const diterima = (i: number) => {
    const q = qtyDiterima[i];
    return Number.isFinite(q) && q > 0 ? q : 0;
  };
  if (baris.some((b) => b.price > 0)) {
    const total = baris.reduce((s, b, i) => s + diterima(i) * b.price, 0);
    return Math.round(total * 100) / 100;
  }
  const qtyMasuk = baris.reduce((s, _b, i) => s + diterima(i), 0);
  return Math.round(qtyMasuk * nilaiPerPotong);
}
