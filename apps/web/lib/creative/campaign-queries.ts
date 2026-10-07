import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { angkaKolaborasi } from "./angka-queries";
import { ringkasCampaign, type KolaborasiCampaign, type RingkasanCampaign } from "./campaign-aturan";
import type { Tahap } from "./tahap";

/*
 * Kueri campaign KOL — KHUSUS SERVER. Klien hanya `import type`.
 * Angka hasil (views, biaya, GMV, ROAS) SELALU dari `angkaKolaborasi`.
 */

export type StatusCampaign = "semua" | "aktif" | "arsip";

export type BarisCampaign = RingkasanCampaign & {
  id: string;
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  arsip: boolean;
  /** Hari WIB "YYYY-MM-DD". */
  startDate: string | null;
  endDate: string | null;
  anggaran: number | null;
  targetKol: number | null;
  targetContent: number | null;
  createdAt: string;
};

const pilihCampaign = {
  id: true,
  name: true,
  brand: true,
  product: true,
  objective: true,
  startDate: true,
  endDate: true,
  budget: true,
  targetKol: true,
  targetContent: true,
  archivedAt: true,
  createdAt: true,
} as const;

type BarisDb = {
  id: string;
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  startDate: Date | null;
  endDate: Date | null;
  budget: unknown;
  targetKol: number | null;
  targetContent: number | null;
  archivedAt: Date | null;
  createdAt: Date;
};

async function kolaborasiPerCampaign(ids: string[]): Promise<Map<string, KolaborasiCampaign[]>> {
  const hasil = new Map<string, KolaborasiCampaign[]>();
  if (ids.length === 0) return hasil;
  const kolab = await prisma.kolBrief.findMany({
    where: { campaignId: { in: ids } },
    select: { id: true, kolId: true, tahap: true, campaignId: true },
  });
  const angka = await angkaKolaborasi(kolab.map((k) => k.id));
  for (const k of kolab) {
    const a = angka.get(k.id);
    if (!a || !k.campaignId) continue;
    const daftar = hasil.get(k.campaignId) ?? [];
    daftar.push({ kolId: k.kolId, tahap: k.tahap as Tahap, angka: a });
    hasil.set(k.campaignId, daftar);
  }
  return hasil;
}

function keBaris(c: BarisDb, kolab: KolaborasiCampaign[]): BarisCampaign {
  const anggaran = c.budget == null ? null : Number(c.budget);
  return {
    ...ringkasCampaign(kolab, anggaran),
    id: c.id,
    name: c.name,
    brand: c.brand,
    product: c.product,
    objective: c.objective,
    arsip: c.archivedAt !== null,
    startDate: c.startDate ? formatDateOnlyJakarta(c.startDate) : null,
    endDate: c.endDate ? formatDateOnlyJakarta(c.endDate) : null,
    anggaran,
    targetKol: c.targetKol,
    targetContent: c.targetContent,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Daftar campaign: yang diarsip di bawah, lalu yang terbaru di atas.
 * `jumlah` dihitung atas SEMUA campaign, supaya angka di chip tidak ikut
 * berubah saat saringan dipilih.
 */
export async function daftarCampaign(opsi: { status?: StatusCampaign } = {}): Promise<{
  baris: BarisCampaign[];
  jumlah: Record<StatusCampaign, number>;
}> {
  const status = opsi.status ?? "semua";
  const [rows, aktif, arsip] = await Promise.all([
    prisma.kolCampaign.findMany({
      where: status === "aktif" ? { archivedAt: null } : status === "arsip" ? { archivedAt: { not: null } } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: pilihCampaign,
    }),
    prisma.kolCampaign.count({ where: { archivedAt: null } }),
    prisma.kolCampaign.count({ where: { archivedAt: { not: null } } }),
  ]);
  const terurut = [...rows.filter((r) => !r.archivedAt), ...rows.filter((r) => r.archivedAt)];
  const kolab = await kolaborasiPerCampaign(terurut.map((r) => r.id));
  return {
    baris: terurut.map((c) => keBaris(c, kolab.get(c.id) ?? [])),
    jumlah: { semua: aktif + arsip, aktif, arsip },
  };
}

export type DetailCampaign = BarisCampaign & { brief: string | null; note: string | null };

export async function detailCampaign(id: string): Promise<DetailCampaign | null> {
  const c = await prisma.kolCampaign.findUnique({
    where: { id },
    select: { ...pilihCampaign, brief: true, note: true },
  });
  if (!c) return null;
  const kolab = (await kolaborasiPerCampaign([c.id])).get(c.id) ?? [];
  return { ...keBaris(c, kolab), brief: c.brief, note: c.note };
}

export type PilihanCampaign = { id: string; name: string; arsip: boolean; brief: string | null };

/** Untuk pemilih campaign: yang aktif dulu, lalu arsip (hanya untuk menyaring). */
export async function pilihanCampaign(): Promise<PilihanCampaign[]> {
  const rows = await prisma.kolCampaign.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, name: true, archivedAt: true, brief: true },
  });
  return [
    ...rows.filter((r) => !r.archivedAt),
    ...rows.filter((r) => r.archivedAt),
  ].map((r) => ({ id: r.id, name: r.name, arsip: r.archivedAt !== null, brief: r.brief }));
}
