"use server";

import { prisma } from "@elorae/db";
import { cariTeks } from "@/lib/db/cari-teks";
import { apiFetch, extractApiMessage } from "@/lib/internal-api";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import {
  gagalJubelio,
  galatDariBalasanApi,
  jalankanAksiJubelio,
  type HasilJubelio,
} from "@/app/backoffice/jubelio/galat-jubelio";

export type JubelioCourierRow = {
  id: number;
  name: string;
  syncedAt: Date;
};

/**
 * Untuk dialog Kirim pesanan (`getCouriersForShipDialog`): tetap melempar bila
 * gagal, dan cukup sudah masuk — pengguna gudang tidak punya izin pengaturan.
 */
export async function syncJubelioCouriers(): Promise<{ count: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const r = await sinkronKurir(session.user.id);
  if (!r.ok) throw new Error(r.rincian ?? r.code);
  return r.data;
}

/** Tombol "Sinkron dari Jubelio" di halaman Kurir Jubelio: `{ ok, code }`, tidak melempar. */
export async function sinkronkanKurirJubelio(): Promise<HasilJubelio<{ count: number }>> {
  return jalankanAksiJubelio(async () => {
    const session = await auth();
    if (!session) return gagalJubelio("TANPA_AKSES");
    requirePermission(session.user.permissions, PERMISSIONS.SETTINGS_SECURITY_VIEW);
    return sinkronKurir(session.user.id);
  });
}

async function sinkronKurir(userId: string): Promise<HasilJubelio<{ count: number }>> {
  const r = await apiFetch<{ count: number }>("POST", "/jubelio/couriers/sync", {
    userId,
    body: {},
  });
  if (!r.ok) {
    return galatDariBalasanApi(r.status, extractApiMessage(r.error, `Courier sync failed (${r.status})`));
  }
  return { ok: true, data: r.data as { count: number } };
}

export async function listJubelioCouriers(): Promise<JubelioCourierRow[]> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const rows = await prisma.jubelioCourier.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, syncedAt: true },
  });
  return rows;
}

export type CourierSortField = "id" | "name" | "syncedAt";
export type CourierSortDir = "asc" | "desc";

export type ListCouriersOpts = {
  search?: string;
  sortField?: CourierSortField;
  sortDir?: CourierSortDir;
  page?: number;
  pageSize?: number;
};

export type CouriersPage = {
  couriers: JubelioCourierRow[];
  totalCount: number;
};

export async function listJubelioCouriersPaged(opts: ListCouriersOpts = {}): Promise<CouriersPage> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");

  const sortField: CourierSortField = opts.sortField ?? "name";
  const sortDir: CourierSortDir = opts.sortDir ?? "asc";
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 10;

  const where: Record<string, unknown> = {};
  if (opts.search && opts.search.trim().length > 0) {
    where.name = cariTeks(opts.search.trim());
  }

  const [rows, totalCount] = await Promise.all([
    prisma.jubelioCourier.findMany({
      where,
      orderBy: { [sortField]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, syncedAt: true },
    }),
    prisma.jubelioCourier.count({ where }),
  ]);

  return { couriers: rows, totalCount };
}
