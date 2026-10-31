import { prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { angkaKolaborasi } from "./angka-queries";
import {
  metrikCampaign,
  ringkasCampaign,
  ringkasDaftarCampaign,
  SEMUA_STATUS_CAMPAIGN,
  type KolaborasiCampaign,
  type MetrikCampaign,
  type RingkasanCampaign,
  type RingkasanDaftarCampaign,
  type StatusCampaignKol,
} from "./campaign-aturan";
import type { Tahap } from "./tahap";

/*
 * Kueri campaign KOL — KHUSUS SERVER. Klien hanya `import type`.
 * Angka hasil (views, biaya, GMV, ROAS) SELALU dari `angkaKolaborasi`.
 */

/** Saringan ARSIP (`?status=`). Status jalan campaign (Draft/Berjalan/…) ada di `StatusCampaignKol` (`?keadaan=`). */
export type StatusCampaign = "semua" | "aktif" | "arsip";

export type BarisCampaign = RingkasanCampaign & {
  id: string;
  name: string;
  brand: string | null;
  product: string | null;
  objective: string | null;
  arsip: boolean;
  /** Draft / Berjalan / Selesai / Batal — terpisah dari arsip. */
  status: StatusCampaignKol;
  /** Hari WIB "YYYY-MM-DD". */
  startDate: string | null;
  endDate: string | null;
  anggaran: number | null;
  targetKol: number | null;
  targetContent: number | null;
  targetViews: number | null;
  /** CPV, CPE, ER aktual, dan persen target — dari ringkasan yang sama (`metrikCampaign`). */
  metrik: MetrikCampaign;
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
  targetViews: true,
  status: true,
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
  targetViews: number | null;
  status: string;
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
  const ringkas = ringkasCampaign(kolab, anggaran);
  return {
    ...ringkas,
    id: c.id,
    name: c.name,
    brand: c.brand,
    product: c.product,
    objective: c.objective,
    arsip: c.archivedAt !== null,
    status: c.status as StatusCampaignKol,
    startDate: c.startDate ? formatDateOnlyJakarta(c.startDate) : null,
    endDate: c.endDate ? formatDateOnlyJakarta(c.endDate) : null,
    anggaran,
    targetKol: c.targetKol,
    targetContent: c.targetContent,
    targetViews: c.targetViews,
    metrik: metrikCampaign(ringkas, { targetViews: c.targetViews, targetContent: c.targetContent }),
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * Daftar campaign: yang diarsip di bawah, lalu yang terbaru di atas.
 * `jumlah` dihitung atas SEMUA campaign, supaya angka di chip arsip tidak ikut
 * berubah saat saringan dipilih. `jumlahStatus` (chip Draft/Berjalan/…)
 * mengikuti saringan arsip yang sedang dipilih, tetapi tidak saringan statusnya
 * sendiri.
 */
export async function daftarCampaign(opsi: { status?: StatusCampaign; keadaan?: StatusCampaignKol | "" } = {}): Promise<{
  baris: BarisCampaign[];
  jumlah: Record<StatusCampaign, number>;
  jumlahStatus: Record<StatusCampaignKol, number>;
}> {
  const status = opsi.status ?? "semua";
  const keadaan = opsi.keadaan ?? "";
  const saringArsip = status === "aktif" ? { archivedAt: null } : status === "arsip" ? { archivedAt: { not: null } } : {};
  const [rows, aktif, arsip, perStatus] = await Promise.all([
    prisma.kolCampaign.findMany({
      where: { ...saringArsip, ...(keadaan ? { status: keadaan } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: pilihCampaign,
    }),
    prisma.kolCampaign.count({ where: { archivedAt: null } }),
    prisma.kolCampaign.count({ where: { archivedAt: { not: null } } }),
    Promise.all(SEMUA_STATUS_CAMPAIGN.map((st) => prisma.kolCampaign.count({ where: { ...saringArsip, status: st } }))),
  ]);
  const terurut = [...rows.filter((r) => !r.archivedAt), ...rows.filter((r) => r.archivedAt)];
  const kolab = await kolaborasiPerCampaign(terurut.map((r) => r.id));
  return {
    baris: terurut.map((c) => keBaris(c, kolab.get(c.id) ?? [])),
    jumlah: { semua: aktif + arsip, aktif, arsip },
    jumlahStatus: Object.fromEntries(SEMUA_STATUS_CAMPAIGN.map((st, i) => [st, perStatus[i]])) as Record<StatusCampaignKol, number>,
  };
}

/**
 * Ringkasan di atas daftar campaign — tidak ikut saringan: KOL aktif dan
 * pengikutnya (akun terbesar per KOL), campaign berjalan, serta budget,
 * terpakai, dan views semua campaign yang tidak diarsip. Terpakai dan views
 * dari `angkaKolaborasi` lewat `ringkasCampaign`, sama dengan baris tabelnya.
 */
export async function ringkasanDaftarCampaign(
  /** Hanya untuk tes: batasi ke baris tes sendiri — basis data dev dipakai bersama. */
  lingkup: { campaignIds?: readonly string[]; kolIds?: readonly string[] } = {},
): Promise<RingkasanDaftarCampaign> {
  const [campaign, kol] = await Promise.all([
    prisma.kolCampaign.findMany({
      where: { archivedAt: null, ...(lingkup.campaignIds ? { id: { in: [...lingkup.campaignIds] } } : {}) },
      select: { id: true, status: true, budget: true },
    }),
    prisma.kol.findMany({
      where: { isActive: true, blockedAt: null, ...(lingkup.kolIds ? { id: { in: [...lingkup.kolIds] } } : {}) },
      select: { accounts: { select: { followers: true } } },
    }),
  ]);
  const kolab = await kolaborasiPerCampaign(campaign.map((c) => c.id));
  return ringkasDaftarCampaign(
    campaign.map((c) => {
      const anggaran = c.budget == null ? null : Number(c.budget);
      const r = ringkasCampaign(kolab.get(c.id) ?? [], anggaran);
      return { status: c.status as StatusCampaignKol, arsip: false, anggaran, terpakai: r.terpakai, views: r.views };
    }),
    kol.map((k) => k.accounts.map((a) => a.followers)),
  );
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
