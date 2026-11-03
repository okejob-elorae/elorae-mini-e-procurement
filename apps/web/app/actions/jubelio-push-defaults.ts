"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { MARGIN_MAKS, MARKUP_MAKS, type DasarAturanHarga } from "@/lib/items/rekomendasi-harga";
import {
  gagalJubelio,
  jalankanAksiJubelio,
  type HasilJubelio,
} from "@/app/backoffice/jubelio/galat-jubelio";

export type JubelioPushDefaultsState = {
  id: string;
  sellTaxId: number;
  buyTaxId: number;
  salesAcctId: number;
  cogsAcctId: number;
  invtAcctId: number;
  purchAcctId: number | null;
  uomId: number;
  brandId: string | null;
  brandName: string | null;
  sellThis: boolean;
  buyThis: boolean;
  stockThis: boolean;
  dropshipThis: boolean;
  isActive: boolean;
  sellUnit: string;
  buyUnit: string;
  packageWeight: number;
  storePriorityQtyTreshold: number;
  rop: number;
  useSingleImageSet: boolean;
  useSerialNumber: boolean;
  buyPrice: number;
  /**
   * Persen rekomendasi bawaan (markup ATAU margin, dasarnya di `defaultPriceRuleBasis`) dan
   * bantalan margin per pcs bawaan — HANYA bahan rekomendasi harga jual di halaman barang, untuk
   * barang yang tidak punya aturan/biaya sendiri (keputusan pemilik 2026-11-01, jawaban P4 dan
   * Q5 2026-11-02). Pasangan persen + dasar dipakai utuh, tidak pernah dicampur dengan dasar
   * barang. Menyimpannya tidak mengubah harga jual barang mana pun. null = belum diisi.
   */
  defaultMarginPercent: number | null;
  defaultPriceRuleBasis: DasarAturanHarga;
  defaultAdditionalCost: number | null;
  updatedAt: string;
  updatedById: string | null;
};

export type JubelioPushDefaultsInput = Omit<
  JubelioPushDefaultsState,
  "id" | "updatedAt" | "updatedById" | "defaultPriceRuleBasis"
> & {
  /** Tidak dikirim (layar lama) = tidak disentuh. */
  defaultPriceRuleBasis?: DasarAturanHarga;
};

type BarisBawaan = NonNullable<Awaited<ReturnType<typeof prisma.jubelioPushDefaults.findFirst>>>;

/** Batas kolom `defaultAdditionalCost` (Decimal(15,2)); batas persen per dasar dari rekomendasi-harga. */
const BIAYA_BAWAAN_MAKS = 9_999_999_999_999.99;

function serialize(row: BarisBawaan): JubelioPushDefaultsState {
  return {
    ...row,
    buyPrice: Number(row.buyPrice),
    defaultMarginPercent: row.defaultMarginPercent != null ? Number(row.defaultMarginPercent) : null,
    defaultAdditionalCost: row.defaultAdditionalCost != null ? Number(row.defaultAdditionalCost) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** null/undefined lolos; angka harus terhingga dan di dalam batas kolomnya. */
function angkaBawaanSah(v: unknown, maks: number): boolean {
  if (v == null) return true;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= maks;
}

// Baris tunggal (singleton) yang hilang = BAWAAN_BELUM_ADA, bukan Error mentah.
const RINCIAN_TANPA_BARIS = "JubelioPushDefaults singleton row missing — re-run migrations";

export async function getJubelioPushDefaults(): Promise<HasilJubelio<JubelioPushDefaultsState>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

    const row = await prisma.jubelioPushDefaults.findFirst();
    if (!row) return gagalJubelio("BAWAAN_BELUM_ADA", RINCIAN_TANPA_BARIS);
    return { ok: true, data: serialize(row) };
  });
}

export async function saveJubelioPushDefaults(
  input: JubelioPushDefaultsInput,
): Promise<HasilJubelio<JubelioPushDefaultsState>> {
  return jalankanAksiJubelio(() => simpanBawaan(input));
}

async function simpanBawaan(
  input: JubelioPushDefaultsInput,
): Promise<HasilJubelio<JubelioPushDefaultsState>> {
  const session = await auth();
  if (!session) return gagalJubelio("TANPA_AKSES");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const ada = await prisma.jubelioPushDefaults.findFirst({ select: { id: true, defaultPriceRuleBasis: true } });
  if (!ada) return gagalJubelio("BAWAAN_BELUM_ADA", RINCIAN_TANPA_BARIS);

  // Persen dan bantalan margin bawaan hanya bahan rekomendasi harga: menyimpannya
  // TIDAK menghitung ulang harga jual barang mana pun. Klien yang tidak
  // mengirimnya (layar lama) tidak mengosongkan kolomnya — dasarnya juga.
  const { defaultMarginPercent, defaultAdditionalCost, defaultPriceRuleBasis, ...isian } = input;
  if (defaultPriceRuleBasis !== undefined && defaultPriceRuleBasis !== "MARKUP" && defaultPriceRuleBasis !== "MARGIN") {
    return gagalJubelio("ISIAN_TIDAK_SAH", "defaultPriceRuleBasis: MARKUP | MARGIN");
  }
  const dasar: DasarAturanHarga = defaultPriceRuleBasis ?? ada.defaultPriceRuleBasis;
  const batasPersen = dasar === "MARGIN" ? MARGIN_MAKS : MARKUP_MAKS;
  if (!angkaBawaanSah(defaultMarginPercent, batasPersen)) {
    return gagalJubelio("ISIAN_TIDAK_SAH", dasar === "MARGIN" ? "defaultMarginPercent: margin 0–99.99" : "defaultMarginPercent: markup 0–999.99");
  }
  if (!angkaBawaanSah(defaultAdditionalCost, BIAYA_BAWAAN_MAKS)) {
    return gagalJubelio("ISIAN_TIDAK_SAH", "defaultAdditionalCost: >= 0");
  }

  const row = await prisma.jubelioPushDefaults.update({
    where: { id: "singleton" },
    data: {
      ...isian,
      ...(defaultMarginPercent !== undefined ? { defaultMarginPercent } : {}),
      ...(defaultPriceRuleBasis !== undefined ? { defaultPriceRuleBasis } : {}),
      ...(defaultAdditionalCost !== undefined ? { defaultAdditionalCost } : {}),
      updatedById: session.user.id,
    },
  });

  revalidatePath("/backoffice/jubelio/settings");
  return { ok: true, data: serialize(row) };
}
