/*
 * Opname gudang yang dibekukan SEBELUM snapshot menggabung baris stok kembar
 * (variantSku null dan "") bisa punya dua baris hitung untuk barang yang sama.
 * Di layar hitung buta keduanya tampak sama persis (nama sama, tanpa SKU, tanpa
 * angka sistem), jadi penghitung bisa mengisi jumlah fisik yang sama di
 * keduanya — persetujuan menjumlahkan satu kelompok, stok jadi berlipat.
 *
 * Layar hanya menampilkan baris PERTAMA tiap kelompok: jumlah fisiknya diisi
 * di sana, kembarannya diisi 0. Modul murni, aman diimpor komponen klien.
 */

export type BarisHitungGudang = { id: string; itemId: string; variantSku?: string | null; countedQty?: unknown };

const kunci = (r: BarisHitungGudang) => `${r.itemId}::${r.variantSku ?? ""}`;

/** Baris pertama tiap kelompok → id kembarannya (hanya kelompok yang punya kembaran). */
export function kembaranBaris(rows: BarisHitungGudang[]): Map<string, string[]> {
  const pertama = new Map<string, string>();
  const hasil = new Map<string, string[]>();
  for (const r of rows) {
    const k = kunci(r);
    const p = pertama.get(k);
    if (p === undefined) {
      pertama.set(k, r.id);
      continue;
    }
    hasil.set(p, [...(hasil.get(p) ?? []), r.id]);
  }
  return hasil;
}

const angka = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Isian awal layar hitung. Kelompok kembar: jumlah yang sudah tercatat di
 * semua barisnya tampil di baris pertama (penghitung melihat totalnya dan
 * bisa membetulkannya), kembarannya 0 — persetujuan tetap mendapat total yang
 * sama. Kelompok yang belum dihitung sama sekali tetap kosong.
 */
export function isianAwalBarang(rows: BarisHitungGudang[]): Record<string, string> {
  const isian: Record<string, string> = {};
  for (const r of rows) {
    const n = angka(r.countedQty);
    isian[r.id] = n === null ? "" : String(n);
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const [p, lain] of kembaranBaris(rows)) {
    const semua = [p, ...lain].map((id) => angka(byId.get(id)?.countedQty));
    const terisi = semua.filter((n): n is number => n !== null);
    if (terisi.length === 0) continue;
    isian[p] = String(terisi.reduce((s, n) => s + n, 0));
    for (const id of lain) isian[id] = "0";
  }
  return isian;
}

/** Isian kembaran sesudah baris pertamanya diubah: 0 bila terisi, kosong bila dikosongkan. */
export function isianKembaran(kembaran: Map<string, string[]>, rowId: string, value: string): Record<string, string> {
  const lain = kembaran.get(rowId);
  if (!lain) return {};
  return Object.fromEntries(lain.map((id) => [id, value.trim() === "" ? "" : "0"]));
}
