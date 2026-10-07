import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { JEJAK } from "@/lib/receivables/jejak";
import { hariIniWib } from "@/lib/tanggal-isian";
import type { AmbangKreatif } from "./ambang";
import { dibayar, ringkasTagihan, sisaBayar, statusBayarEfektif, type ChipBayar, type RingkasTagihan } from "./bayar-aturan";
import type { Platform } from "./aturan";
import { bacaAmbangKreatif } from "./pengaturan";
import { JALUR_KELUAR, type JenisKerjaSama, type StatusBayar, type Tahap } from "./tahap";
import { tenggatKolaborasi } from "./tenggat";

/**
 * Kueri Pembayaran KOL — KHUSUS SERVER. Klien hanya `import type`.
 *
 * Hanya kolaborasi ber-fee (fee > 0). Kolaborasi yang keluar jalur (ditolak,
 * ghosting, batal) tanpa konten tayang dan belum dibayar apa pun tidak ikut:
 * fee-nya tidak pernah terutang — aturan yang sama dengan tenggat "jatuh
 * tempo bayar" (`tenggat.ts`).
 *
 * Jatuh tempo dihitung `tenggatKolaborasi` (tayang terakhir + ambang), jadi
 * Pembayaran, Hari ini, dan Kalender tidak bisa berbeda pendapat soal kapan
 * sebuah fee terlambat.
 */

export type JatuhTempo = { tanggal: string; lewat: boolean; lewatHari: number };

export type BarisBayar = {
  id: string;
  docNo: string;
  kolId: string;
  kolNama: string;
  namaPenerima: string;
  handle: string | null;
  platform: Platform | null;
  campaignId: string | null;
  campaignNama: string | null;
  tahap: Tahap;
  jenis: JenisKerjaSama;
  fee: number;
  /** Kolom `paidAmount` apa adanya (total yang sudah dibayar). */
  paidAmount: number;
  dibayar: number;
  sisa: number;
  /** Status yang berlaku (`statusBayarEfektif`), bukan nilai kolom mentah. */
  payStatus: StatusBayar;
  /** Hari WIB. */
  paidAt: string | null;
  payNote: string | null;
  jatuhTempo: JatuhTempo | null;
};

export type SaringanBayar = { cari?: string | null; campaignId?: string | null };

function whereTagihan(s: SaringanBayar): Prisma.KolBriefWhereInput {
  const q = (s.cari ?? "").trim().replace(/^@+/, "");
  return {
    fee: { gt: 0 },
    NOT: {
      tahap: { in: [...JALUR_KELUAR] },
      payStatus: { in: ["BELUM", "TIDAK_PERLU"] },
      kolContents: { none: { link: { not: null } } },
    },
    ...(s.campaignId ? { campaignId: s.campaignId } : {}),
    ...(q
      ? {
          OR: [
            { docNo: cariTeks(q) },
            { kol: { name: cariTeks(q) } },
            { kol: { accounts: { some: { handle: cariTeks(q) } } } },
            { campaign: { name: cariTeks(q) } },
          ],
        }
      : {}),
  };
}

const PILIH = {
  id: true,
  docNo: true,
  fee: true,
  payStatus: true,
  paidAmount: true,
  paidAt: true,
  payNote: true,
  tahap: true,
  tahapAt: true,
  jenis: true,
  liveAt: true,
  updatedAt: true,
  campaign: { select: { id: true, name: true } },
  kol: {
    select: {
      id: true,
      name: true,
      recipientName: true,
      accounts: { select: { platform: true, handle: true }, orderBy: { followers: "desc" as const }, take: 1 },
    },
  },
  kolContents: { select: { id: true, link: true, liveAt: true } },
} satisfies Prisma.KolBriefSelect;

type BarisMentah = Prisma.KolBriefGetPayload<{ select: typeof PILIH }>;

function olah(b: BarisMentah, ambang: AmbangKreatif, hariIni: string): BarisBayar {
  const fee = Number(b.fee);
  const payStatus = statusBayarEfektif(fee, b.payStatus as StatusBayar);
  const keadaan = { fee, paidAmount: Number(b.paidAmount), payStatus };
  const tempo = tenggatKolaborasi(
    {
      tahap: b.tahap as Tahap,
      tahapAt: formatDateOnlyJakarta(b.tahapAt),
      liveAt: b.liveAt ? formatDateOnlyJakarta(b.liveAt) : null,
      fee,
      payStatus,
      pengiriman: [],
      konten: b.kolContents.map((k) => ({
        id: k.id,
        link: k.link,
        liveAt: k.liveAt ? formatDateOnlyJakarta(k.liveAt) : null,
        draftStatus: null,
        draftAt: null,
        angkaTerakhirHari: null,
      })),
    },
    ambang,
    hariIni,
  ).find((t) => t.jenis === "JATUH_TEMPO_BAYAR");
  const akun = b.kol.accounts[0];
  return {
    id: b.id,
    docNo: b.docNo,
    kolId: b.kol.id,
    kolNama: b.kol.name,
    namaPenerima: b.kol.recipientName?.trim() || b.kol.name,
    handle: akun?.handle ?? null,
    platform: (akun?.platform as Platform | undefined) ?? null,
    campaignId: b.campaign?.id ?? null,
    campaignNama: b.campaign?.name ?? null,
    tahap: b.tahap as Tahap,
    jenis: b.jenis as JenisKerjaSama,
    fee,
    paidAmount: keadaan.paidAmount,
    dibayar: dibayar(keadaan),
    sisa: sisaBayar(keadaan),
    payStatus,
    paidAt: b.paidAt ? formatDateOnlyJakarta(b.paidAt) : null,
    payNote: b.payNote,
    jatuhTempo: tempo ? { tanggal: tempo.tanggal, lewat: tempo.lewat, lewatHari: tempo.lewatHari } : null,
  };
}

const RANK: Record<StatusBayar, number> = { BELUM: 0, SEBAGIAN: 0, LUNAS: 1, TIDAK_PERLU: 2 };

/**
 * Yang belum lunas dulu, jatuh tempo terdekat (yang paling lama lewat) di
 * depan; yang lunas menurut tanggal bayar terbaru.
 */
function urutkan(a: BarisBayar, b: BarisBayar): number {
  return (
    RANK[a.payStatus] - RANK[b.payStatus] ||
    (a.payStatus === "LUNAS" ? (b.paidAt ?? "").localeCompare(a.paidAt ?? "") : 0) ||
    (a.jatuhTempo?.tanggal ?? "9999").localeCompare(b.jatuhTempo?.tanggal ?? "9999") ||
    b.docNo.localeCompare(a.docNo)
  );
}

function cocokChip(chip: ChipBayar, s: StatusBayar): boolean {
  return chip === "SEMUA" || chip === s;
}

/** Semua baris tagihan yang cocok saringannya (tanpa halaman), sudah diurut. */
export async function semuaBarisBayar(s: SaringanBayar & { chip?: ChipBayar }, hariIni = hariIniWib()): Promise<BarisBayar[]> {
  const [mentah, ambang] = await Promise.all([prisma.kolBrief.findMany({ where: whereTagihan(s), select: PILIH }), bacaAmbangKreatif()]);
  return mentah
    // Tanpa foreign key (relationMode prisma) — lewati kolaborasi yang KOL-nya sesaat hilang.
    .filter((b) => b.kol != null)
    .map((b) => olah(b, ambang, hariIni))
    .filter((b) => cocokChip(s.chip ?? "SEMUA", b.payStatus))
    .sort(urutkan);
}

export const UKURAN_HALAMAN_BAYAR = [25, 50, 100] as const;

export type HasilDaftarBayar = {
  baris: BarisBayar[];
  total: number;
  halaman: number;
  perHalaman: number;
  jumlahPerChip: Record<ChipBayar, number>;
  /** Tiga kartu untuk saringan yang sedang aktif (chip + cari + campaign). */
  ringkas: RingkasTagihan;
};

export async function daftarPembayaran(
  opsi: SaringanBayar & { chip?: ChipBayar; halaman?: number; perHalaman?: number },
  hariIni = hariIniWib(),
): Promise<HasilDaftarBayar> {
  const chip = opsi.chip ?? "BELUM";
  const semua = await semuaBarisBayar({ cari: opsi.cari, campaignId: opsi.campaignId, chip: "SEMUA" }, hariIni);
  const jumlahPerChip: Record<ChipBayar, number> = { BELUM: 0, SEBAGIAN: 0, LUNAS: 0, SEMUA: semua.length };
  for (const b of semua) if (b.payStatus === "BELUM" || b.payStatus === "SEBAGIAN" || b.payStatus === "LUNAS") jumlahPerChip[b.payStatus]++;

  const tersaring = semua.filter((b) => cocokChip(chip, b.payStatus));
  const perHalaman = (UKURAN_HALAMAN_BAYAR as readonly number[]).includes(opsi.perHalaman ?? 0) ? opsi.perHalaman! : UKURAN_HALAMAN_BAYAR[0];
  const jumlahHalaman = Math.max(1, Math.ceil(tersaring.length / perHalaman));
  const halaman = Math.min(Math.max(1, Math.trunc(opsi.halaman ?? 1) || 1), jumlahHalaman);
  return {
    baris: tersaring.slice((halaman - 1) * perHalaman, halaman * perHalaman),
    total: tersaring.length,
    halaman,
    perHalaman,
    jumlahPerChip,
    ringkas: ringkasTagihan(tersaring),
  };
}

/** Pilihan campaign untuk saringan: yang aktif, ditambah yang sedang dipilih. */
export async function pilihanCampaignBayar(terpilih?: string | null): Promise<{ id: string; name: string }[]> {
  return prisma.kolCampaign.findMany({
    where: { OR: [{ archivedAt: null }, ...(terpilih ? [{ id: terpilih }] : [])] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export type RiwayatBayar = {
  id: string;
  waktu: string;
  oleh: string;
  sebelum: { payStatus?: StatusBayar; paidAmount?: number; paidAt?: string | null; payNote?: string | null } | null;
  sesudah: { payStatus?: StatusBayar; paidAmount?: number; paidAt?: string | null; payNote?: string | null } | null;
};

export type PanelBayarData = BarisBayar & { riwayat: RiwayatBayar[] };

const objek = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Data panel pembayaran di rincian kolaborasi, dengan riwayat dari jejak. */
export async function dataPanelBayar(kolaborasiId: string, hariIni = hariIniWib()): Promise<PanelBayarData | null> {
  const [b, ambang, jejak] = await Promise.all([
    prisma.kolBrief.findUnique({ where: { id: kolaborasiId }, select: PILIH }),
    bacaAmbangKreatif(),
    prisma.auditLog.findMany({
      where: { entityType: "KolBrief", entityId: kolaborasiId, action: JEJAK.PEMBAYARAN_KOL_DICATAT },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, changes: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  if (!b) return null;
  return {
    ...olah(b, ambang, hariIni),
    riwayat: jejak.map((j) => {
      const c = objek(j.changes);
      return {
        id: j.id,
        waktu: j.createdAt.toISOString(),
        oleh: j.user?.name?.trim() || j.user?.email || "—",
        sebelum: objek(c?.before) as RiwayatBayar["sebelum"],
        sesudah: objek(c?.after) as RiwayatBayar["sesudah"],
      };
    }),
  };
}
