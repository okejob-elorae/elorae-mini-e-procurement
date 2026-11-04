import type { PostingRole } from "@/lib/constants/journal-roles";

/**
 * Peran posting persediaan untuk satu barang, menurut tipenya.
 *
 * Barang jadi masuk buku besar lewat penerimaan barang jadi (`FG_RECEIPT`),
 * yang mendebit `INVENTORY_FG`. Jadi setiap jurnal yang MENGELUARKAN atau
 * MENGEMBALIKAN barang jadi — HPP penjualan, retur penjualan, opname barang
 * jadi, muat/rekonsiliasi kanvas, GRN barang jadi yang dibeli jadi — harus
 * memakai peran yang sama. Dulu semuanya memakai `INVENTORY` (bahan baku): bila
 * kedua peran dipetakan ke akun berbeda, "Persediaan bahan baku" menjadi
 * negatif sebesar HPP penjualan dan "Persediaan barang jadi" tidak pernah
 * berkurang. Totalnya tetap benar, rinciannya salah (terukur di uji akuntansi
 * 2026-10-07: bahan baku −Rp 14,8 jt, barang jadi +Rp 38,2 jt melawan stok
 * Rp 13,0 jt / Rp 10,5 jt).
 *
 * Tipe yang tidak diketahui (baris tanpa barang) tetap `INVENTORY`, perilaku lama.
 */
export type PeranPersediaan = Extract<PostingRole, "INVENTORY" | "INVENTORY_FG">;

export function peranPersediaan(tipeBarang: string | null | undefined): PeranPersediaan {
  return tipeBarang === "FINISHED_GOOD" ? "INVENTORY_FG" : "INVENTORY";
}

export type NilaiPerPeran = { role: PeranPersediaan; nilai: number };

const URUTAN: readonly PeranPersediaan[] = ["INVENTORY", "INVENTORY_FG"];

/**
 * Jumlah nilai per peran persediaan, dihitung dalam sen supaya baris jurnal
 * yang dihasilkan menjumlah persis. Kelompok bernilai nol dibuang; urutan
 * selalu `INVENTORY` lalu `INVENTORY_FG` supaya jurnal yang sama selalu
 * tersusun sama.
 */
export function nilaiPerPeranPersediaan(baris: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>): NilaiPerPeran[] {
  const sen = new Map<PeranPersediaan, number>();
  for (const b of baris) {
    if (!Number.isFinite(b.nilai)) continue;
    const role = peranPersediaan(b.tipeBarang);
    sen.set(role, (sen.get(role) ?? 0) + Math.round(b.nilai * 100));
  }
  return URUTAN.filter((role) => (sen.get(role) ?? 0) !== 0).map((role) => ({ role, nilai: (sen.get(role) ?? 0) / 100 }));
}

/**
 * Seperti `nilaiPerPeranPersediaan`, tetapi Σ hasilnya dipaksa sama persis
 * dengan `total` (dua desimal) — untuk dokumen yang totalnya sudah tersimpan
 * terpisah dari barisnya (mis. `GRN.totalAmount` vs `GRN.items`). Selisih
 * pembulatan ditanggung kelompok terbesar. Bila baris tidak bisa dibaca sama
 * sekali, seluruh `total` jatuh ke `cadangan`.
 */
export function bagiTotalPerPeranPersediaan(
  total: number,
  baris: ReadonlyArray<{ tipeBarang: string | null | undefined; nilai: number }>,
  cadangan: PeranPersediaan = "INVENTORY",
): NilaiPerPeran[] {
  const totalSen = Math.round(total * 100);
  if (totalSen === 0) return [];
  const kelompok = nilaiPerPeranPersediaan(baris);
  if (kelompok.length === 0) return [{ role: cadangan, nilai: totalSen / 100 }];
  const senKelompok = kelompok.map((k) => Math.round(k.nilai * 100));
  const selisih = totalSen - senKelompok.reduce((s, x) => s + x, 0);
  if (selisih !== 0) {
    let terbesar = 0;
    for (let i = 1; i < senKelompok.length; i++) if (Math.abs(senKelompok[i]) > Math.abs(senKelompok[terbesar])) terbesar = i;
    senKelompok[terbesar] += selisih;
  }
  return kelompok.map((k, i) => ({ role: k.role, nilai: senKelompok[i] / 100 })).filter((k) => Math.round(k.nilai * 100) !== 0);
}
