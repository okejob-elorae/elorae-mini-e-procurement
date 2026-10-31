import type { AccountType } from "@/lib/constants/enums";
import type { PostingRole } from "@/lib/constants/journal-roles";

/*
 * Templat bagan akun "Dagang & produksi fesyen" — sekali klik di Bagan Akun.
 *
 * Murni (tanpa Prisma) supaya dites dan dimuat komponen klien. Pemasangnya
 * (`pasang.ts`) hanya MEMBUAT akun yang kodenya belum ada dan hanya MEMETAKAN
 * peran yang masih kosong — pemetaan yang sudah ada tidak pernah ditimpa.
 *
 * Kode dan nama mengikuti uji akuntansi 2026-10-07 (data UJIAKUN): kode yang
 * sudah dipakai di sana berarti hal yang SAMA di sini, karena pemasang
 * mencocokkan akun lewat kode. Karena itu 1103 ("Bank BCA" di uji itu) sengaja
 * tidak dipakai: nama bank adalah milik pemilik, peran BANK di templat jatuh ke
 * 1102 "Bank" yang sudah ada di kerangka SAK-EMKM.
 *
 * Setiap peran posting muncul tepat sekali (`templat.test.ts`), dan tipe akunnya
 * selalu tipe yang diizinkan perannya (`POSTING_ROLE_ACCOUNT_TYPES`). Peran baru
 * di `POSTING_ROLES` harus ditambahkan di sini juga — tesnya gagal bila tidak.
 */

export type AkunTemplat = {
  kode: string;
  nama: string;
  /** Kode induk dalam templat; null = akun puncak. Tipe anak selalu tipe induknya. */
  induk: string | null;
  /** Hanya untuk akun puncak (anak mewarisi tipe induk). */
  tipe?: AccountType;
  /** Peran posting yang dipetakan ke akun ini bila perannya masih kosong. */
  peran?: readonly PostingRole[];
};

export const NAMA_TEMPLAT_AKUN = "Dagang & produksi fesyen";

export const TEMPLAT_DAGANG_FESYEN: readonly AkunTemplat[] = [
  // ── Aset ──
  { kode: "1", nama: "Aset", induk: null, tipe: "ASET" },
  { kode: "11", nama: "Aset Lancar", induk: "1" },
  { kode: "1101", nama: "Kas", induk: "11", peran: ["CASH"] },
  { kode: "1102", nama: "Bank", induk: "11", peran: ["BANK"] },
  { kode: "1104", nama: "Piutang usaha (toko)", induk: "11", peran: ["AR_STORE"] },
  { kode: "1105", nama: "Piutang marketplace", induk: "11", peran: ["AR"] },
  { kode: "1106", nama: "Persediaan bahan baku", induk: "11", peran: ["INVENTORY"] },
  { kode: "1107", nama: "Persediaan barang jadi", induk: "11", peran: ["INVENTORY_FG"] },
  { kode: "1108", nama: "Persediaan kanvas", induk: "11", peran: ["INVENTORY_VAN"] },
  { kode: "1109", nama: "Uang muka endorse / KOL", induk: "11", peran: ["KOL_PREPAID"] },
  { kode: "1110", nama: "Piutang toko konsinyasi", induk: "11", peran: ["AR_CONSIGNMENT"] },
  { kode: "1111", nama: "Persediaan di toko konsinyasi", induk: "11", peran: ["INVENTORY_CONSIGNMENT"] },
  { kode: "1112", nama: "Persediaan rusak", induk: "11", peran: ["INVENTORY_DAMAGED"] },
  { kode: "1113", nama: "PPN masukan", induk: "11", peran: ["PPN_MASUKAN"] },
  { kode: "1114", nama: "PPh 22 dibayar dimuka", induk: "11", peran: ["PPH22_PREPAID"] },
  { kode: "1115", nama: "PPh 23 dibayar dimuka", induk: "11", peran: ["PPH23_PREPAID"] },
  { kode: "1116", nama: "PPh 25 dibayar dimuka", induk: "11", peran: ["PPH25_PREPAID"] },
  { kode: "1117", nama: "Biaya dibayar dimuka", induk: "11", peran: ["PREPAID_EXPENSE"] },
  { kode: "12", nama: "Aset Tetap", induk: "1" },
  { kode: "1201", nama: "Peralatan & perlengkapan", induk: "12", peran: ["FIXED_ASSET"] },
  { kode: "1209", nama: "Akumulasi penyusutan", induk: "12", peran: ["ACCUM_DEPRECIATION"] },

  // ── Liabilitas ──
  { kode: "2", nama: "Liabilitas", induk: null, tipe: "LIABILITAS" },
  { kode: "21", nama: "Utang Lancar", induk: "2" },
  { kode: "2101", nama: "Utang usaha", induk: "21", peran: ["AP"] },
  { kode: "2102", nama: "Utang pajak (PPh final)", induk: "21", peran: ["PPH_FINAL_PAYABLE", "TAX"] },
  { kode: "2103", nama: "Utang fee KOL", induk: "21", peran: ["KOL_PAYABLE"] },
  { kode: "2104", nama: "Utang PPh 21", induk: "21", peran: ["PPH21_PAYABLE"] },
  { kode: "2105", nama: "Utang PPh 23", induk: "21", peran: ["PPH23_PAYABLE"] },
  { kode: "2106", nama: "Utang PPh 4(2)", induk: "21", peran: ["PPH4_2_PAYABLE"] },
  { kode: "2107", nama: "PPN keluaran", induk: "21", peran: ["PPN_KELUARAN"] },
  { kode: "2108", nama: "Utang PPN", induk: "21", peran: ["PPN_PAYABLE"] },
  { kode: "2109", nama: "Utang komisi & gaji lapangan", induk: "21", peran: ["COMMISSION_PAYABLE"] },
  { kode: "2110", nama: "Utang penggantian biaya", induk: "21", peran: ["REIMBURSE_PAYABLE"] },
  { kode: "2111", nama: "Biaya yang masih harus dibayar", induk: "21", peran: ["ACCRUED_EXPENSE"] },

  // ── Ekuitas ──
  { kode: "3", nama: "Ekuitas", induk: null, tipe: "EKUITAS" },
  { kode: "3101", nama: "Modal disetor", induk: "3" },
  { kode: "3102", nama: "Laba ditahan", induk: "3", peran: ["RETAINED_EARNINGS"] },
  { kode: "3103", nama: "Ekuitas saldo awal", induk: "3", peran: ["OPENING_EQUITY"] },

  // ── Pendapatan ──
  { kode: "4", nama: "Pendapatan", induk: null, tipe: "PENDAPATAN" },
  { kode: "4101", nama: "Penjualan", induk: "4", peran: ["SALES_REVENUE"] },
  { kode: "4103", nama: "Retur penjualan", induk: "4", peran: ["SALES_RETURN"] },
  { kode: "4104", nama: "Potongan penjualan", induk: "4", peran: ["SALES_DISCOUNT"] },
  { kode: "42", nama: "Pendapatan lain-lain", induk: "4" },
  { kode: "4201", nama: "Pendapatan lain-lain", induk: "42", peran: ["OTHER_INCOME"] },
  { kode: "4202", nama: "Penggantian barang hilang", induk: "42", peran: ["LOSS_RECOVERY"] },
  { kode: "4203", nama: "Laba (rugi) pelepasan aset", induk: "42", peran: ["ASSET_DISPOSAL_GAIN_LOSS"] },

  // ── HPP ──
  { kode: "5", nama: "HPP", induk: null, tipe: "HPP" },
  { kode: "5101", nama: "HPP barang terjual", induk: "5", peran: ["COGS"] },

  // ── Beban ──
  { kode: "6", nama: "Beban", induk: null, tipe: "BEBAN" },
  { kode: "61", nama: "Beban penjualan", induk: "6" },
  { kode: "6101", nama: "Biaya administrasi marketplace", induk: "61", peran: ["MARKETPLACE_FEE_ADMIN"] },
  { kode: "6102", nama: "Biaya layanan marketplace", induk: "61", peran: ["MARKETPLACE_FEE_SERVICE"] },
  { kode: "6103", nama: "Komisi afiliasi marketplace (AMS)", induk: "61", peran: ["MARKETPLACE_FEE_COMMISSION"] },
  { kode: "6104", nama: "Biaya proses pesanan", induk: "61", peran: ["MARKETPLACE_FEE_PROCESSING"] },
  { kode: "6105", nama: "Biaya marketplace lainnya", induk: "61", peran: ["MARKETPLACE_FEE_OTHER", "MARKETPLACE_FEE"] },
  { kode: "6106", nama: "Beban iklan & promosi", induk: "61" },
  { kode: "6107", nama: "Beban packing & pengiriman", induk: "61" },
  { kode: "6108", nama: "Beban endorse & KOL", induk: "61", peran: ["KOL_EXPENSE"] },
  { kode: "6109", nama: "Beban komisi SPG", induk: "61", peran: ["SPG_COMMISSION_EXPENSE"] },
  { kode: "6110", nama: "Beban komisi sales", induk: "61", peran: ["SALES_COMMISSION_EXPENSE"] },
  { kode: "6111", nama: "Beban perjalanan dinas", induk: "61", peran: ["TRAVEL_EXPENSE"] },
  { kode: "62", nama: "Beban umum & administrasi", induk: "6" },
  { kode: "6201", nama: "Beban gaji", induk: "62" },
  { kode: "6202", nama: "Beban sewa", induk: "62" },
  { kode: "6203", nama: "Beban listrik & internet", induk: "62" },
  { kode: "6204", nama: "Selisih persediaan", induk: "62", peran: ["INVENTORY_VARIANCE"] },
  { kode: "6205", nama: "Beban pajak (PPh final 0,5%)", induk: "62", peran: ["PPH_FINAL_EXPENSE"] },
  { kode: "6206", nama: "Beban barang hilang & rusak", induk: "62", peran: ["LOSS_EXPENSE"] },
  { kode: "6207", nama: "Beban penyusutan", induk: "62", peran: ["DEPRECIATION_EXPENSE"] },
  { kode: "6208", nama: "Biaya administrasi bank", induk: "62", peran: ["BANK_CHARGES"] },
];

/** Tipe akun templat: tipe akun puncaknya (anak selalu mewarisi tipe induk). */
export function tipeAkunTemplat(templat: readonly AkunTemplat[], kode: string): AccountType | null {
  const perKode = new Map(templat.map((a) => [a.kode, a]));
  let a = perKode.get(kode);
  const dilihat = new Set<string>();
  while (a && a.induk !== null) {
    if (dilihat.has(a.kode)) return null;
    dilihat.add(a.kode);
    a = perKode.get(a.induk);
  }
  return a?.tipe ?? null;
}
