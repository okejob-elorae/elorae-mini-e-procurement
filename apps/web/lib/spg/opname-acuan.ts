import { BATAS_STOK_LURING_MS } from "@/lib/pwa/waktu-luring";
import { kunciBaris } from "./stok";

/*
 * Opname toko: saldo ACUAN per baris = saldo buku pada saat barang itu
 * DIHITUNG, bukan saat opname disimpan.
 *
 * Menghitung satu toko bisa setengah jam (dan draf bisa tersimpan berhari-hari
 * di HP). Penjualan, penerimaan kiriman, atau retur pembeli yang tercatat di
 * antara saat barang dihitung dan saat opname disimpan sudah ada di buku tapi
 * belum dialami rak yang dihitung. Membandingkan hitungan dengan saldo saat
 * simpan menimbulkan selisih palsu: penjualan sesudah hitungan = "lebih" palsu
 * (yang di opname berikutnya menjadi "kurang" — barang hilang yang dibebankan
 * ke SPG), kiriman sesudah hitungan = "kurang" palsu seketika.
 *
 * HP mengirim UMUR hitungan per baris (milidetik sejak baris itu terakhir
 * diubah), bukan jam: jam HP bisa salah, umur tidak — server menghitung
 * waktu hitung = jam server saat menerima (atau waktu tangkap antrean) − umur.
 *
 * Modul murni, aman diimpor komponen klien.
 */

/** Umur hitungan dibatasi sama dengan batas pekerjaan stok dari antrean HP. */
export const BATAS_UMUR_HITUNG_MS = BATAS_STOK_LURING_MS;

export type BarisBerumur = { itemId: string; variantSku: string | null; umurHitungMs?: number | null };

/** Umur hitungan satu baris di HP; jam yang mundur tidak pernah memberi umur negatif. */
export function umurHitungMs(waktuMs: number | null | undefined, sekarangMs: number): number | undefined {
  if (typeof waktuMs !== "number" || !Number.isFinite(waktuMs)) return undefined;
  return Math.max(0, Math.round(sekarangMs - waktuMs));
}

/**
 * Waktu hitung per kunci barang. Baris yang dihitung dua kali (rak depan dan
 * gudang belakang) memakai hitungan TERAKHIR. Baris tanpa umur tidak masuk:
 * waktunya tidak diketahui, jadi berlaku aturan lama (saldo saat simpan /
 * saat tangkap antrean).
 */
export function waktuHitungPerKunci(baris: BarisBerumur[], dasar: Date): Map<string, Date> {
  const umur = new Map<string, number>();
  for (const b of baris) {
    if (typeof b.umurHitungMs !== "number" || !Number.isFinite(b.umurHitungMs)) continue;
    const u = Math.min(BATAS_UMUR_HITUNG_MS, Math.max(0, Math.round(b.umurHitungMs)));
    const k = kunciBaris(b.itemId, b.variantSku);
    const ada = umur.get(k);
    umur.set(k, ada === undefined ? u : Math.min(ada, u));
  }
  const hasil = new Map<string, Date>();
  for (const [k, u] of umur) hasil.set(k, new Date(dasar.getTime() - u));
  return hasil;
}

export type GerakBertanggal = { itemId: string; variantSku: string | null; qty: number; createdAt: Date };

/**
 * Saldo acuan: saldo dasar dikurangi gerakan buku yang tercatat SESUDAH barang
 * itu dihitung. Kunci tanpa waktu hitung memakai saldo dasar apa adanya.
 */
export function saldoAcuan(
  saldoDasar: Map<string, number>,
  gerakSesudah: GerakBertanggal[],
  waktuHitung: Map<string, Date>,
): Map<string, number> {
  const hasil = new Map(saldoDasar);
  for (const g of gerakSesudah) {
    const k = kunciBaris(g.itemId, g.variantSku);
    const tc = waktuHitung.get(k);
    if (!tc || g.createdAt.getTime() <= tc.getTime()) continue;
    hasil.set(k, (hasil.get(k) ?? 0) - g.qty);
  }
  return hasil;
}

/**
 * Kunci yang sudah dihitung opname lain SESUDAH baris ini dihitung: hitungan
 * yang lebih baru itu yang berlaku, baris ini dilewati.
 */
export function dilewatiKarenaLebihBaru(waktuBaris: Map<string, Date>, terakhirLain: Map<string, Date>): Set<string> {
  const lewat = new Set<string>();
  for (const [k, t] of waktuBaris) {
    const lain = terakhirLain.get(k);
    if (lain && lain.getTime() > t.getTime()) lewat.add(k);
  }
  return lewat;
}

/** Hitungan buta: angka sistem dibuang dari muatan layar hitung. */
export function tanpaAngkaSistem<T extends { stok: number }>(baris: T[]): Omit<T, "stok">[] {
  return baris.map((b) => {
    const salinan: Partial<T> = { ...b };
    delete salinan.stok;
    return salinan as Omit<T, "stok">;
  });
}
