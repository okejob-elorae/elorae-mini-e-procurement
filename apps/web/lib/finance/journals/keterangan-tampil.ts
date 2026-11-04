import { POSTING_ROLES } from "@/lib/constants/journal-roles";
import { formatRupiah } from "@/lib/format/rupiah";

/*
 * Keterangan jurnal otomatis untuk DITAMPILKAN (daftar Jurnal, rincian jurnal,
 * buku besar).
 *
 * Penulis jurnal lama menyimpan keterangan Inggris ("Sale SP-…", "COGS …",
 * "Opname adjustment …", "GRN reversal …", "Supplier payment …", "Van sale …",
 * "FG receipt …"), dan jurnal yang sudah tersimpan tidak pernah ditulis ulang.
 * Di sini keterangan itu diperlakukan sebagai KODE + nomor dokumen dan
 * diterjemahkan lewat `financeJournals.keterangan.<kunci>` — jadi jurnal lama
 * dan baru tampil dalam bahasa pembaca tanpa migrasi data (pola sama dengan
 * `catatan-riwayat.ts` PO dan `tampilan-lonceng.ts`). Keterangan Indonesia
 * penulis baru dikenali juga, supaya pembaca berbahasa Inggris membacanya
 * dalam bahasanya. Jurnal manual dan teks yang tidak cocok pola tampil apa
 * adanya. Murni: aman untuk komponen klien.
 */

export const KUNCI_KETERANGAN = [
  "penjualan",
  "hppPenjualan",
  "retur",
  "hppRetur",
  "penerimaanBarang",
  "batalPenerimaanBarang",
  "penerimaanBarangJadi",
  "penyesuaianOpname",
  "muatKanvas",
  "penjualanKanvas",
  "rekonsiliasiKanvas",
  "pembayaranPemasok",
  "batalPembayaranPemasok",
  "settlement",
] as const;

export type KunciKeterangan = (typeof KUNCI_KETERANGAN)[number];

export type KeteranganTampil =
  | { kunci: KunciKeterangan; nilai: Record<string, string> }
  | { teks: string };

/**
 * Urutan penting: awalan yang lebih panjang lebih dulu ("Return COGS" sebelum
 * "Return", "Penjualan kanvas" sebelum "Penjualan", "Penerimaan barang jadi"
 * sebelum "Penerimaan barang").
 */
const POLA: ReadonlyArray<[RegExp, KunciKeterangan, string]> = [
  // Inggris (penulis lama, sebelum 2026-10-08)
  [/^Return COGS (.+)$/, "hppRetur", "nomor"],
  [/^Return (.+)$/, "retur", "nomor"],
  [/^COGS (.+)$/, "hppPenjualan", "nomor"],
  [/^Sale (.+)$/, "penjualan", "nomor"],
  [/^GRN reversal (.+)$/, "batalPenerimaanBarang", "nomor"],
  [/^GRN (.+)$/, "penerimaanBarang", "nomor"],
  [/^FG receipt (.+)$/, "penerimaanBarangJadi", "nomor"],
  [/^Opname adjustment (.+)$/, "penyesuaianOpname", "nomor"],
  [/^Van load (.+)$/, "muatKanvas", "nomor"],
  [/^Van sale (.+)$/, "penjualanKanvas", "nomor"],
  [/^Van reconcile (.+)$/, "rekonsiliasiKanvas", "nomor"],
  [/^Supplier payment reversal (.+)$/, "batalPembayaranPemasok", "nomor"],
  [/^Supplier payment (.+)$/, "pembayaranPemasok", "nomor"],
  [/^Marketplace settlement — (.+)$/, "settlement", "toko"],
  // Indonesia (penulis baru) — hanya bentuk yang pasti; bentuk umum ("Penjualan …")
  // hanya bila sisanya satu nomor dokumen, supaya "Penjualan konsinyasi …" tidak tertangkap.
  [/^HPP retur penjualan (.+)$/, "hppRetur", "nomor"],
  [/^Retur penjualan (.+)$/, "retur", "nomor"],
  [/^HPP penjualan (.+)$/, "hppPenjualan", "nomor"],
  [/^Penjualan kanvas (.+)$/, "penjualanKanvas", "nomor"],
  [/^Penjualan (\S+)$/, "penjualan", "nomor"],
  [/^Pembatalan penerimaan barang (.+)$/, "batalPenerimaanBarang", "nomor"],
  [/^Penerimaan barang jadi (\S+(?: \(WO [^)]+\))?)$/, "penerimaanBarangJadi", "nomor"],
  [/^Penerimaan barang (\S+)$/, "penerimaanBarang", "nomor"],
  [/^Muat kanvas (.+)$/, "muatKanvas", "nomor"],
  [/^Rekonsiliasi kanvas (.+)$/, "rekonsiliasiKanvas", "nomor"],
];

/** Keterangan → kode + nilai, atau teks apa adanya. `manual` = jurnal manual (selalu apa adanya). */
export function keteranganJurnal(deskripsi: string | null | undefined, opsi: { manual?: boolean } = {}): KeteranganTampil {
  const teks = (deskripsi ?? "").trim();
  if (!teks || opsi.manual) return { teks };
  for (const [pola, kunci, nama] of POLA) {
    const cocok = pola.exec(teks);
    if (!cocok) continue;
    const isi = cocok[1].trim();
    if (!isi) return { teks };
    return { kunci, nilai: { [nama]: isi } };
  }
  return { teks };
}

/**
 * Teks siap tampil. `t` = penerjemah namespace `financeJournals`
 * (`useTranslations("financeJournals")`).
 */
export function teksKeteranganJurnal(
  t: (kunci: string, nilai?: Record<string, string>) => string,
  deskripsi: string | null | undefined,
  opsi: { manual?: boolean } = {},
): string {
  const k = keteranganJurnal(deskripsi, opsi);
  return "kunci" in k ? t(`keterangan.${k.kunci}`, k.nilai) : k.teks;
}

const PERAN = new Set<string>(POSTING_ROLES);
const PEMISAH_MEMO = " · ";
const POLA_DPP = /^DPP (\d+(?:\.\d{1,2})?)$/;

/**
 * Memo baris jurnal untuk ditampilkan. Penulis otomatis menyimpan nama PERAN
 * ("BANK", "AR_STORE") dan DPP baris PPN ("PPN_KELUARAN · DPP 1000000.00") di
 * memo supaya bisa dibaca kembali oleh mesin; pembaca melihat label peran dan
 * DPP dalam rupiah. Bagian lain tampil apa adanya. Kosong → null.
 */
export function memoJurnal(memo: string | null | undefined, labelPeran: (peran: string) => string | null): string | null {
  const teks = (memo ?? "").trim();
  if (!teks) return null;
  return teks
    .split(PEMISAH_MEMO)
    .map((bagian) => {
      const b = bagian.trim();
      if (PERAN.has(b)) return labelPeran(b) ?? b;
      const dpp = POLA_DPP.exec(b);
      if (dpp) return `DPP ${formatRupiah(Number(dpp[1]))}`;
      return b;
    })
    .join(PEMISAH_MEMO);
}
