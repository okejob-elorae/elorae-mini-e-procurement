"use server";

import { revalidatePath } from "next/cache";
import { prisma, recalcItemSellingPrice } from "@elorae/db";
import { auth } from "@/lib/auth";
import { dasarHargaJualProduksi } from "@/lib/production/biaya-dasar-harga-jual";
import { apiFetch } from "@/lib/internal-api";
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
  defaultMarginPercent: number | null;
  defaultAdditionalCost: number | null;
  updatedAt: string;
  updatedById: string | null;
};

export type JubelioPushDefaultsInput = Omit<
  JubelioPushDefaultsState,
  "id" | "updatedAt" | "updatedById"
>;

export type SaveJubelioPushDefaultsResult = JubelioPushDefaultsState & {
  fanOutCount: number;
};

type BarisBawaan = NonNullable<Awaited<ReturnType<typeof prisma.jubelioPushDefaults.findFirst>>>;

function serialize(row: BarisBawaan): JubelioPushDefaultsState {
  return {
    ...row,
    buyPrice: Number(row.buyPrice),
    defaultMarginPercent: row.defaultMarginPercent != null ? Number(row.defaultMarginPercent) : null,
    defaultAdditionalCost: row.defaultAdditionalCost != null ? Number(row.defaultAdditionalCost) : null,
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
): Promise<HasilJubelio<SaveJubelioPushDefaultsResult>> {
  return jalankanAksiJubelio(() => simpanBawaan(input));
}

async function simpanBawaan(
  input: JubelioPushDefaultsInput,
): Promise<HasilJubelio<SaveJubelioPushDefaultsResult>> {
  const session = await auth();
  if (!session) return gagalJubelio("TANPA_AKSES");
  requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_MANAGE);

  const userId = session.user.id;

  // Read previous defaults BEFORE the update so we can detect margin/extras change.
  const previous = await prisma.jubelioPushDefaults.findFirst({
    select: { defaultMarginPercent: true, defaultAdditionalCost: true },
  });
  if (!previous) return gagalJubelio("BAWAAN_BELUM_ADA", RINCIAN_TANPA_BARIS);

  const prevMargin = previous?.defaultMarginPercent != null ? Number(previous.defaultMarginPercent) : null;
  const nextMargin = input.defaultMarginPercent != null ? Number(input.defaultMarginPercent) : null;
  const prevExtras = previous?.defaultAdditionalCost != null ? Number(previous.defaultAdditionalCost) : null;
  const nextExtras = input.defaultAdditionalCost != null ? Number(input.defaultAdditionalCost) : null;

  const marginChanged = prevMargin !== nextMargin;
  const extrasChanged = prevExtras !== nextExtras;

  const row = await prisma.jubelioPushDefaults.update({
    where: { id: "singleton" },
    data: {
      ...input,
      defaultMarginPercent: input.defaultMarginPercent ?? null,
      defaultAdditionalCost: input.defaultAdditionalCost ?? null,
      updatedById: userId,
    },
  });

  const saved = serialize(row);
  const outboxRowIds: string[] = [];

  if (marginChanged || extrasChanged) {
    const affected = await prisma.item.findMany({
      where: {
        type: "FINISHED_GOOD",
        targetMarginPercent: null,
        source: { not: "JUBELIO_INGEST" },
      },
      select: { id: true },
    });

    const BATCH_SIZE = 100;
    const SMALL_FANOUT_THRESHOLD = 500;

    if (affected.length <= SMALL_FANOUT_THRESHOLD) {
      await prisma.$transaction(async (tx) => {
        for (const { id } of affected) {
          const recalc = await recalcItemSellingPrice(tx, {
            itemId: id,
            trigger: "DEFAULTS_CHANGE",
            // Barang jadi produksi sendiri: dasar = biaya BAHAN per pcs (lihat `dasarHargaJualProduksi`).
            newAvgCost: await dasarHargaJualProduksi(tx, id),
            changedById: userId,
          });
          if (recalc.applied && recalc.outboxRowId) outboxRowIds.push(recalc.outboxRowId);
        }
      }, { timeout: 30000 });
    } else {
      for (let i = 0; i < affected.length; i += BATCH_SIZE) {
        const batch = affected.slice(i, i + BATCH_SIZE);
        await prisma.$transaction(async (tx) => {
          for (const { id } of batch) {
            const recalc = await recalcItemSellingPrice(tx, {
              itemId: id,
              trigger: "DEFAULTS_CHANGE",
              // Barang jadi produksi sendiri: dasar = biaya BAHAN per pcs (lihat `dasarHargaJualProduksi`).
              newAvgCost: await dasarHargaJualProduksi(tx, id),
              changedById: userId,
            });
            if (recalc.applied && recalc.outboxRowId) outboxRowIds.push(recalc.outboxRowId);
          }
        }, { timeout: 15000 });
      }
    }

    // Best-effort: fire dispatch hints for the first N rows so users see immediate progress.
    // The poller drains the rest within ~5s.
    const HINT_LIMIT = 50;
    for (const rowId of outboxRowIds.slice(0, HINT_LIMIT)) {
      void apiFetch("POST", `/jubelio/outbox/enqueue/${rowId}`, { userId }).catch(() => {
        // poller picks it up within ~5s if this fails
      });
    }
  }

  revalidatePath("/backoffice/jubelio/settings");
  return { ok: true, data: { ...saved, fanOutCount: outboxRowIds.length } };
}

export async function getMarginFallbackItemCount(): Promise<HasilJubelio<number>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);

    const count = await prisma.item.count({
      where: {
        type: "FINISHED_GOOD",
        targetMarginPercent: null,
        source: { not: "JUBELIO_INGEST" },
      },
    });
    return { ok: true, data: count };
  });
}
