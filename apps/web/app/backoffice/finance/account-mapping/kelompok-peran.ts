import type { PostingRole } from "@/lib/constants/journal-roles";

/*
 * Pengelompokan peran posting per area di layar Pemetaan akun, plus saringan
 * "Wajib / Belum diatur / Semua". Murni (tanpa Prisma) supaya dites dan dipakai
 * komponen klien.
 *
 * Setiap peran di `POSTING_ROLES` tepat SEKALI di salah satu area
 * (`kelompok-peran.spec.ts`). Peran baru yang belum dimasukkan ke sini tidak
 * hilang dari layar: ia jatuh ke area "LAINNYA" sampai ditempatkan.
 */

export type IdKelompokPeran =
  | "PERSEDIAAN"
  | "PENJUALAN"
  | "MARKETPLACE"
  | "KAS_BANK"
  | "PAJAK"
  | "KOMISI_BIAYA"
  | "KOL"
  | "ASET_TETAP"
  | "EKUITAS"
  | "LAINNYA";

export type KelompokPeran = { id: IdKelompokPeran; peran: readonly PostingRole[] };

export const KELOMPOK_PERAN: readonly KelompokPeran[] = [
  {
    id: "PERSEDIAAN",
    peran: [
      "INVENTORY",
      "INVENTORY_FG",
      "INVENTORY_VAN",
      "INVENTORY_CONSIGNMENT",
      "INVENTORY_DAMAGED",
      "INVENTORY_VARIANCE",
      "AP",
    ],
  },
  {
    id: "PENJUALAN",
    peran: ["SALES_REVENUE", "SALES_RETURN", "SALES_DISCOUNT", "COGS", "AR", "AR_STORE", "AR_CONSIGNMENT"],
  },
  {
    id: "MARKETPLACE",
    peran: [
      "MARKETPLACE_FEE",
      "MARKETPLACE_FEE_ADMIN",
      "MARKETPLACE_FEE_SERVICE",
      "MARKETPLACE_FEE_COMMISSION",
      "MARKETPLACE_FEE_PROCESSING",
      "MARKETPLACE_FEE_OTHER",
    ],
  },
  { id: "KAS_BANK", peran: ["BANK", "CASH", "BANK_CHARGES"] },
  {
    id: "PAJAK",
    peran: [
      "TAX",
      "PPN_MASUKAN",
      "PPN_KELUARAN",
      "PPN_PAYABLE",
      "PPH21_PAYABLE",
      "PPH23_PAYABLE",
      "PPH4_2_PAYABLE",
      "PPH_FINAL_PAYABLE",
      "PPH_FINAL_EXPENSE",
      "PPH22_PREPAID",
      "PPH23_PREPAID",
      "PPH25_PREPAID",
    ],
  },
  {
    id: "KOMISI_BIAYA",
    peran: [
      "SPG_COMMISSION_EXPENSE",
      "SALES_COMMISSION_EXPENSE",
      "COMMISSION_PAYABLE",
      "TRAVEL_EXPENSE",
      "REIMBURSE_PAYABLE",
      "LOSS_EXPENSE",
      "LOSS_RECOVERY",
      "PREPAID_EXPENSE",
      "ACCRUED_EXPENSE",
      "OTHER_INCOME",
    ],
  },
  { id: "KOL", peran: ["KOL_EXPENSE", "KOL_PAYABLE", "KOL_PREPAID"] },
  {
    id: "ASET_TETAP",
    peran: ["FIXED_ASSET", "ACCUM_DEPRECIATION", "DEPRECIATION_EXPENSE", "ASSET_DISPOSAL_GAIN_LOSS"],
  },
  { id: "EKUITAS", peran: ["RETAINED_EARNINGS", "OPENING_EQUITY"] },
];

/**
 * Peran yang diberikan, dikelompokkan per area dalam urutan `KELOMPOK_PERAN`;
 * area tanpa peran tersisa tidak ikut. Peran yang tidak dikenal area mana pun
 * dikumpulkan di "LAINNYA" (paling akhir).
 */
export function kelompokkanPeran(roles: readonly PostingRole[]): KelompokPeran[] {
  const ada = new Set(roles);
  const dikenal = new Set<PostingRole>();
  const hasil: KelompokPeran[] = [];
  for (const k of KELOMPOK_PERAN) {
    for (const p of k.peran) dikenal.add(p);
    const peran = k.peran.filter((p) => ada.has(p));
    if (peran.length > 0) hasil.push({ id: k.id, peran });
  }
  const sisa = roles.filter((p) => !dikenal.has(p));
  if (sisa.length > 0) hasil.push({ id: "LAINNYA", peran: sisa });
  return hasil;
}

export type SaringPeran = "WAJIB" | "BELUM" | "SEMUA";

export const PILIHAN_SARING_PERAN: readonly SaringPeran[] = ["WAJIB", "BELUM", "SEMUA"];

/** "Wajib" = peran yang menahan buku besar aktif; "Belum" = belum dipetakan ke akun mana pun. */
export function saringPeran(
  roles: readonly PostingRole[],
  saring: SaringPeran,
  opsi: { wajib: readonly PostingRole[]; terpetakan: (peran: PostingRole) => boolean },
): PostingRole[] {
  if (saring === "WAJIB") return roles.filter((p) => opsi.wajib.includes(p));
  if (saring === "BELUM") return roles.filter((p) => !opsi.terpetakan(p));
  return [...roles];
}
