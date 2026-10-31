"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
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
  updatedAt: string;
  updatedById: string | null;
};

export type JubelioPushDefaultsInput = Omit<
  JubelioPushDefaultsState,
  "id" | "updatedAt" | "updatedById"
>;

type BarisBawaan = NonNullable<Awaited<ReturnType<typeof prisma.jubelioPushDefaults.findFirst>>>;

/**
 * Margin dan biaya tambahan bawaan tidak dikirim ke layar: harga jual diisi
 * manual pemilik (keputusan pemilik 2026-10-08), jadi keduanya tidak dipakai
 * lagi. Kolomnya dibiarkan di basis data.
 */
function serialize(row: BarisBawaan): JubelioPushDefaultsState {
  const { defaultMarginPercent: _margin, defaultAdditionalCost: _biaya, ...sisa } = row;
  void _margin;
  void _biaya;
  return {
    ...sisa,
    buyPrice: Number(row.buyPrice),
    updatedAt: row.updatedAt.toISOString(),
  };
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

  const ada = await prisma.jubelioPushDefaults.findFirst({ select: { id: true } });
  if (!ada) return gagalJubelio("BAWAAN_BELUM_ADA", RINCIAN_TANPA_BARIS);

  // Klien lama bisa masih mengirim margin/biaya tambahan bawaan: dibuang, kolomnya
  // tidak disentuh, dan tidak ada harga barang yang dihitung ulang.
  const {
    defaultMarginPercent: _margin,
    defaultAdditionalCost: _biaya,
    ...isian
  } = input as JubelioPushDefaultsInput & { defaultMarginPercent?: unknown; defaultAdditionalCost?: unknown };
  void _margin;
  void _biaya;

  const row = await prisma.jubelioPushDefaults.update({
    where: { id: "singleton" },
    data: { ...isian, updatedById: session.user.id },
  });

  revalidatePath("/backoffice/jubelio/settings");
  return { ok: true, data: serialize(row) };
}
