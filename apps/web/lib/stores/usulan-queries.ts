import { prisma, type Prisma } from "@elorae/db";
import { cariKandidatDuplikat, type KandidatDuplikat, type Pembanding } from "./usulan-toko";

/**
 * Kueri usulan toko baru. `StoreProposal` sengaja tanpa relasi Prisma
 * (pengusul, peninjau, area, toko hasil), jadi namanya digabung di sini —
 * dan id yang tidak lagi menunjuk apa pun tampil kosong, tidak menjatuhkan layar.
 */

export const STATUS_USULAN = ["PENDING", "APPROVED", "REJECTED"] as const;
export type StatusUsulan = (typeof STATUS_USULAN)[number];
export type SaringanStatusUsulan = StatusUsulan | "SEMUA";

export function bacaSaringanStatus(nilai: string | undefined): SaringanStatusUsulan {
  if (nilai === "SEMUA") return "SEMUA";
  return (STATUS_USULAN as readonly string[]).includes(nilai ?? "") ? (nilai as StatusUsulan) : "PENDING";
}

function angka(v: Prisma.Decimal | null): number | null {
  return v === null ? null : v.toNumber();
}

async function namaPengguna(ids: (string | null)[]): Promise<Map<string, string>> {
  const unik = [...new Set(ids.filter((id): id is string => !!id))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

async function areaMenurutId(ids: (string | null)[]): Promise<Map<string, { code: string; name: string }>> {
  const unik = [...new Set(ids.filter((id): id is string => !!id))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.storeGroup.findMany({ where: { id: { in: unik } }, select: { id: true, code: true, name: true } });
  return new Map(rows.map((a) => [a.id, { code: a.code, name: a.name }]));
}

async function tokoMenurutId(ids: (string | null)[]): Promise<Map<string, { code: string; name: string }>> {
  const unik = [...new Set(ids.filter((id): id is string => !!id))];
  if (unik.length === 0) return new Map();
  const rows = await prisma.store.findMany({ where: { id: { in: unik } }, select: { id: true, code: true, name: true } });
  return new Map(rows.map((s) => [s.id, { code: s.code, name: s.name }]));
}

/* ------------------------------------------------------------------ */
/* Duplikat                                                             */
/* ------------------------------------------------------------------ */

/**
 * Semua toko (termasuk nonaktif) dan usulan yang masih menunggu. Usulan yang
 * sudah disetujui sudah menjadi toko; yang ditolak memang bukan toko.
 */
export async function bacaPembanding(): Promise<Pembanding[]> {
  const [toko, usulan] = await Promise.all([
    prisma.store.findMany({ select: { id: true, code: true, name: true, address: true, lat: true, lng: true, isActive: true } }),
    prisma.storeProposal.findMany({
      where: { status: "PENDING" },
      select: { id: true, name: true, address: true, lat: true, lng: true },
    }),
  ]);
  return [
    ...toko.map((s) => ({
      jenis: "TOKO" as const,
      id: s.id,
      code: s.code,
      name: s.name,
      address: s.address,
      lat: angka(s.lat),
      lng: angka(s.lng),
      aktif: s.isActive,
    })),
    ...usulan.map((p) => ({
      jenis: "USULAN" as const,
      id: p.id,
      code: null,
      name: p.name,
      address: p.address,
      lat: angka(p.lat),
      lng: angka(p.lng),
      aktif: true,
    })),
  ];
}

export async function cekDuplikatUsulan(
  usulan: { name: string; lat: number | null; lng: number | null },
  opsi: { kecualiUsulanId?: string | null; kecualiTokoId?: string | null } = {},
): Promise<KandidatDuplikat[]> {
  return cariKandidatDuplikat(usulan, await bacaPembanding(), opsi);
}

/* ------------------------------------------------------------------ */
/* HP: usulan saya                                                      */
/* ------------------------------------------------------------------ */

export type UsulanSaya = {
  id: string;
  name: string;
  address: string;
  status: StatusUsulan;
  termsType: "PUTUS" | "KONSI" | null;
  areaCode: string | null;
  reviewNote: string | null;
  storeId: string | null;
  /** Kode toko hasil, bila tokonya masih ada. */
  storeCode: string | null;
  createdAt: Date;
  reviewedAt: Date | null;
};

export async function usulanSaya(userId: string, batas = 50): Promise<UsulanSaya[]> {
  const rows = await prisma.storeProposal.findMany({
    where: { proposedById: userId },
    orderBy: { createdAt: "desc" },
    take: batas,
  });
  const [area, toko] = await Promise.all([
    areaMenurutId(rows.map((r) => r.groupId)),
    tokoMenurutId(rows.map((r) => r.storeId)),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    address: r.address,
    status: bacaStatus(r.status),
    termsType: r.termsType,
    areaCode: r.groupId ? area.get(r.groupId)?.code ?? null : null,
    reviewNote: r.reviewNote,
    // Toko yang sudah tidak ada tidak ditautkan — ketukannya hanya akan 404.
    storeId: r.storeId && toko.has(r.storeId) ? r.storeId : null,
    storeCode: r.storeId ? toko.get(r.storeId)?.code ?? null : null,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
  }));
}

/** Status yang tak dikenal (ditulis tangan di basis data) dibaca sebagai menunggu — tidak hilang dari layar. */
function bacaStatus(s: string): StatusUsulan {
  return (STATUS_USULAN as readonly string[]).includes(s) ? (s as StatusUsulan) : "PENDING";
}

/* ------------------------------------------------------------------ */
/* Backoffice                                                           */
/* ------------------------------------------------------------------ */

export async function jumlahUsulanMenunggu(): Promise<number> {
  return prisma.storeProposal.count({ where: { status: "PENDING" } });
}

export type BarisUsulan = {
  id: string;
  name: string;
  address: string;
  status: StatusUsulan;
  termsType: "PUTUS" | "KONSI" | null;
  areaCode: string | null;
  pengusul: string | null;
  adaLokasi: boolean;
  storeId: string | null;
  createdAt: Date;
};

/**
 * Daftar usulan untuk admin. "Semua" tetap menaruh yang menunggu paling atas:
 * status disimpan sebagai teks, dan urutan abjadnya (APPROVED, PENDING, …)
 * tidak berarti apa-apa — jadi dua kueri, yang menunggu dulu.
 */
export async function daftarUsulan(opsi: {
  status: SaringanStatusUsulan;
  cari?: string;
  page: number;
  pageSize: number;
}): Promise<{ items: BarisUsulan[]; total: number }> {
  const cari = opsi.cari?.trim();
  const saringCari: Prisma.StoreProposalWhereInput = cari
    ? {
        OR: [
          { name: { contains: cari, mode: "insensitive" } },
          { address: { contains: cari, mode: "insensitive" } },
        ],
      }
    : {};
  const pilih = {
    id: true,
    name: true,
    address: true,
    status: true,
    termsType: true,
    groupId: true,
    proposedById: true,
    lat: true,
    storeId: true,
    createdAt: true,
  } as const;
  const lewati = (opsi.page - 1) * opsi.pageSize;

  let rows: Prisma.StoreProposalGetPayload<{ select: typeof pilih }>[];
  let total: number;
  if (opsi.status !== "SEMUA") {
    const where = { ...saringCari, status: opsi.status };
    [rows, total] = await Promise.all([
      prisma.storeProposal.findMany({
        where,
        select: pilih,
        // Yang menunggu: tertua dulu (antre). Yang sudah diputuskan: terbaru dulu.
        orderBy: { createdAt: opsi.status === "PENDING" ? "asc" : "desc" },
        skip: lewati,
        take: opsi.pageSize,
      }),
      prisma.storeProposal.count({ where }),
    ]);
  } else {
    const whereMenunggu = { ...saringCari, status: "PENDING" };
    const whereLain = { ...saringCari, status: { not: "PENDING" } };
    const [jumlahMenunggu, jumlahLain] = await Promise.all([
      prisma.storeProposal.count({ where: whereMenunggu }),
      prisma.storeProposal.count({ where: whereLain }),
    ]);
    total = jumlahMenunggu + jumlahLain;
    const menunggu =
      lewati < jumlahMenunggu
        ? await prisma.storeProposal.findMany({
            where: whereMenunggu,
            select: pilih,
            orderBy: { createdAt: "asc" },
            skip: lewati,
            take: opsi.pageSize,
          })
        : [];
    const sisa = opsi.pageSize - menunggu.length;
    const lain =
      sisa > 0
        ? await prisma.storeProposal.findMany({
            where: whereLain,
            select: pilih,
            orderBy: { createdAt: "desc" },
            skip: Math.max(0, lewati - jumlahMenunggu),
            take: sisa,
          })
        : [];
    rows = [...menunggu, ...lain];
  }

  const [pengguna, area] = await Promise.all([
    namaPengguna(rows.map((r) => r.proposedById)),
    areaMenurutId(rows.map((r) => r.groupId)),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      status: bacaStatus(r.status),
      termsType: r.termsType,
      areaCode: r.groupId ? area.get(r.groupId)?.code ?? null : null,
      pengusul: pengguna.get(r.proposedById) ?? null,
      adaLokasi: r.lat !== null,
      storeId: r.storeId,
      createdAt: r.createdAt,
    })),
  };
}

export type DetailUsulan = {
  id: string;
  name: string;
  address: string;
  phone: string | null;
  contactName: string | null;
  termsType: "PUTUS" | "KONSI" | null;
  groupId: string | null;
  area: { code: string; name: string } | null;
  lat: number | null;
  lng: number | null;
  photoUrl: string | null;
  note: string | null;
  status: StatusUsulan;
  proposedById: string;
  pengusul: string | null;
  reviewer: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  store: { id: string; code: string; name: string } | null;
  createdAt: Date;
};

export async function detailUsulan(id: string): Promise<DetailUsulan | null> {
  const r = await prisma.storeProposal.findUnique({ where: { id } });
  if (!r) return null;
  const [pengguna, area, toko] = await Promise.all([
    namaPengguna([r.proposedById, r.reviewedById]),
    areaMenurutId([r.groupId]),
    tokoMenurutId([r.storeId]),
  ]);
  const hasil = r.storeId ? toko.get(r.storeId) : undefined;
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    phone: r.phone,
    contactName: r.contactName,
    termsType: r.termsType,
    groupId: r.groupId,
    area: r.groupId ? area.get(r.groupId) ?? null : null,
    lat: angka(r.lat),
    lng: angka(r.lng),
    photoUrl: r.photoUrl,
    note: r.note,
    status: bacaStatus(r.status),
    proposedById: r.proposedById,
    pengusul: pengguna.get(r.proposedById) ?? null,
    reviewer: r.reviewedById ? pengguna.get(r.reviewedById) ?? null : null,
    reviewedAt: r.reviewedAt,
    reviewNote: r.reviewNote,
    store: r.storeId && hasil ? { id: r.storeId, ...hasil } : null,
    createdAt: r.createdAt,
  };
}

/** Semua kode toko — bahan saran kode berikutnya. */
export async function semuaKodeToko(): Promise<string[]> {
  const rows = await prisma.store.findMany({ select: { code: true } });
  return rows.map((r) => r.code);
}
