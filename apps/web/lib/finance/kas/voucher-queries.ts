// Bukan aksi server — pembaca voucher kas & bank. KHUSUS SERVER: komponen klien
// hanya boleh `import type` dari berkas ini.

import { prisma, type Prisma } from "@elorae/db";
import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";
import { cariTeks } from "@/lib/db/cari-teks";
import { bacaJenisPotongPemasok, type JenisPotongPemasok } from "@/lib/finance/pajak/pemotongan";
import { SUMBER_VOUCHER_KAS, SUMBER_VOUCHER_KAS_BALIK, type JenisVoucher } from "./aturan";
import { JEJAK_KAS } from "./jejak";

type Klien = Prisma.TransactionClient | typeof prisma;
const sen = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

export type SaringVoucher = {
  jenis?: JenisVoucher | null;
  rekeningId?: string | null;
  status?: "POSTED" | "CANCELLED" | null;
  dari?: string | null;
  sampai?: string | null;
  cari?: string | null;
  halaman?: number;
  ukuran?: number;
};

export type BarisVoucher = {
  id: string;
  nomor: string;
  jenis: JenisVoucher;
  tanggal: string;
  rekening: string;
  rekeningTujuan: string | null;
  pihak: string | null;
  keterangan: string | null;
  total: number;
  potong: number;
  neto: number;
  status: "POSTED" | "CANCELLED";
  pencatat: string | null;
};

export type HalamanVoucher = {
  baris: BarisVoucher[];
  total: number;
  halaman: number;
  ukuran: number;
  /** Ringkasan atas SELURUH hasil saring (bukan halaman ini), voucher berlaku saja. */
  ringkasan: { keluar: number; masuk: number; transfer: number; jumlahBerlaku: number };
};

function whereVoucher(s: SaringVoucher): Prisma.CashVoucherWhereInput {
  const tanggal: Prisma.DateTimeFilter = {};
  if (s.dari) tanggal.gte = parseDateOnly(s.dari);
  if (s.sampai) tanggal.lte = parseDateOnlyEnd(s.sampai);
  const cari = s.cari?.trim();
  return {
    ...(s.jenis ? { type: s.jenis } : {}),
    ...(s.rekeningId ? { OR: [{ cashAccountId: s.rekeningId }, { transferAccountId: s.rekeningId }] } : {}),
    ...(s.status ? { status: s.status } : {}),
    ...(s.dari || s.sampai ? { date: tanggal } : {}),
    ...(cari
      ? {
          AND: [
            {
              OR: [
                { docNumber: cariTeks(cari) },
                { counterpart: cariTeks(cari) },
                { description: cariTeks(cari) },
                { lines: { some: { memo: cariTeks(cari) } } },
              ],
            },
          ],
        }
      : {}),
  };
}

export async function daftarVoucher(s: SaringVoucher, klien: Klien = prisma): Promise<HalamanVoucher> {
  const ukuran = Math.min(Math.max(s.ukuran ?? 25, 10), 100);
  const halaman = Math.max(1, s.halaman ?? 1);
  const where = whereVoucher(s);
  const [rows, total, perJenis] = await Promise.all([
    klien.cashVoucher.findMany({ where, orderBy: [{ date: "desc" }, { createdAt: "desc" }], skip: (halaman - 1) * ukuran, take: ukuran }),
    klien.cashVoucher.count({ where }),
    klien.cashVoucher.groupBy({ by: ["type"], where: { ...where, status: "POSTED" }, _sum: { totalAmount: true }, _count: { _all: true } }),
  ]);
  const akunIds = [...new Set(rows.flatMap((r) => [r.cashAccountId, r.transferAccountId].filter((x): x is string => Boolean(x))))];
  const userIds = [...new Set(rows.map((r) => r.createdById))];
  const [akun, users] = await Promise.all([
    akunIds.length ? klien.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } }) : [],
    userIds.length ? klien.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
  ]);
  const a = new Map(akun.map((x) => [x.id, `${x.name} (${x.code})`]));
  const u = new Map(users.map((x) => [x.id, x.name || x.email]));
  const sum = (t: string) => sen(perJenis.find((p) => p.type === t)?._sum.totalAmount) / 100;
  return {
    total,
    halaman,
    ukuran,
    ringkasan: { keluar: sum("OUT"), masuk: sum("IN"), transfer: sum("TRANSFER"), jumlahBerlaku: perJenis.reduce((n, p) => n + p._count._all, 0) },
    baris: rows.map((r) => ({
      id: r.id,
      nomor: r.docNumber,
      jenis: r.type as JenisVoucher,
      tanggal: formatDateOnlyJakarta(r.date),
      rekening: a.get(r.cashAccountId) ?? r.cashAccountId,
      rekeningTujuan: r.transferAccountId ? (a.get(r.transferAccountId) ?? r.transferAccountId) : null,
      pihak: r.counterpart,
      keterangan: r.description,
      total: Number(r.totalAmount),
      potong: Number(r.withholdingAmount),
      neto: Number(r.netAmount),
      status: r.status === "CANCELLED" ? "CANCELLED" : "POSTED",
      pencatat: u.get(r.createdById) ?? null,
    })),
  };
}

export type RincianVoucher = BarisVoucher & {
  rekeningId: string;
  rekeningTujuanId: string | null;
  jenisPotong: string | null;
  fotoUrl: string | null;
  pemasok: { id: string; kode: string; nama: string } | null;
  dibatalkan: { pada: string; oleh: string | null; alasan: string | null } | null;
  dibuat: string;
  baris: Array<{ id: string; kategori: string | null; akunKode: string; akunNama: string; jumlah: number; memo: string | null; kanal: string | null }>;
  jurnalId: string | null;
  jurnalBalikId: string | null;
  mutasiTercocok: number;
  /** SKB pemasok yang membebaskan potongan voucher ini (dari jejak pencatatannya); null = tidak. */
  dibebaskanSkb: { nomor: string; berlakuSampai: string; jenis: JenisPotongPemasok } | null;
};

function bacaDibebaskanSkb(metadata: unknown): RincianVoucher["dibebaskanSkb"] {
  const m = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>).dibebaskanSkb : null;
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const o = m as Record<string, unknown>;
  const jenis = bacaJenisPotongPemasok(o.jenis);
  return jenis && typeof o.nomor === "string" && typeof o.berlakuSampai === "string" ? { nomor: o.nomor, berlakuSampai: o.berlakuSampai, jenis } : null;
}

export async function rincianVoucher(id: string, klien: Klien = prisma): Promise<RincianVoucher | null> {
  const v = await klien.cashVoucher.findUnique({ where: { id }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  if (!v) return null;
  const akunIds = [...new Set([v.cashAccountId, v.transferAccountId, ...v.lines.map((l) => l.chartAccountId)].filter((x): x is string => Boolean(x)))];
  const katIds = [...new Set(v.lines.map((l) => l.categoryId).filter((x): x is string => Boolean(x)))];
  const userIds = [...new Set([v.createdById, v.cancelledById].filter((x): x is string => Boolean(x)))];
  const [akun, kat, users, pemasok, jurnal, jejak] = await Promise.all([
    klien.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } }),
    katIds.length ? klien.cashCategory.findMany({ where: { id: { in: katIds } }, select: { id: true, name: true } }) : [],
    klien.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }),
    v.supplierId ? klien.supplier.findUnique({ where: { id: v.supplierId }, select: { id: true, code: true, name: true } }) : null,
    klien.journal.findMany({ where: { sourceType: { in: [SUMBER_VOUCHER_KAS, SUMBER_VOUCHER_KAS_BALIK] }, sourceId: v.id }, select: { id: true, sourceType: true, lines: { select: { id: true } } } }),
    v.supplierId && Number(v.withholdingAmount) === 0
      ? klien.auditLog.findFirst({ where: { action: JEJAK_KAS.VOUCHER_DICATAT, entityType: "CashVoucher", entityId: v.id }, orderBy: { createdAt: "asc" }, select: { metadata: true } })
      : null,
  ]);
  const a = new Map(akun.map((x) => [x.id, x]));
  const k = new Map(kat.map((x) => [x.id, x.name]));
  const u = new Map(users.map((x) => [x.id, x.name || x.email]));
  const asli = jurnal.find((j) => j.sourceType === SUMBER_VOUCHER_KAS) ?? null;
  const balik = jurnal.find((j) => j.sourceType === SUMBER_VOUCHER_KAS_BALIK) ?? null;
  const mutasiTercocok = asli
    ? await klien.bankStatementLine.count({ where: { matchedJournalLineId: { in: asli.lines.map((l) => l.id) } } })
    : 0;
  const label = (id: string | null) => (id ? (a.get(id) ? `${a.get(id)!.name} (${a.get(id)!.code})` : id) : null);
  return {
    id: v.id,
    nomor: v.docNumber,
    jenis: v.type as JenisVoucher,
    tanggal: formatDateOnlyJakarta(v.date),
    rekening: label(v.cashAccountId) as string,
    rekeningTujuan: label(v.transferAccountId),
    rekeningId: v.cashAccountId,
    rekeningTujuanId: v.transferAccountId,
    pihak: v.counterpart,
    keterangan: v.description,
    total: Number(v.totalAmount),
    potong: Number(v.withholdingAmount),
    neto: Number(v.netAmount),
    jenisPotong: v.withholdingType,
    status: v.status === "CANCELLED" ? "CANCELLED" : "POSTED",
    pencatat: u.get(v.createdById) ?? null,
    fotoUrl: v.photoUrl,
    pemasok: pemasok ? { id: pemasok.id, kode: pemasok.code, nama: pemasok.name } : null,
    dibatalkan: v.cancelledAt ? { pada: v.cancelledAt.toISOString(), oleh: v.cancelledById ? (u.get(v.cancelledById) ?? null) : null, alasan: v.cancelReason } : null,
    dibuat: v.createdAt.toISOString(),
    baris: v.lines.map((l) => ({
      id: l.id,
      kategori: l.categoryId ? (k.get(l.categoryId) ?? null) : null,
      akunKode: a.get(l.chartAccountId)?.code ?? "?",
      akunNama: a.get(l.chartAccountId)?.name ?? "?",
      jumlah: Number(l.amount),
      memo: l.memo,
      kanal: l.channel,
    })),
    jurnalId: asli?.id ?? null,
    jurnalBalikId: balik?.id ?? null,
    mutasiTercocok,
    dibebaskanSkb: bacaDibebaskanSkb(jejak?.metadata),
  };
}

export type AkunPilihan = { id: string; kode: string; nama: string; tipe: string };

/** Akun daun aktif yang boleh menjadi baris voucher (bukan kas/bank — itu transfer). */
export async function akunBarisVoucher(rekeningKas: ReadonlySet<string>, klien: Klien = prisma): Promise<AkunPilihan[]> {
  const akun = await klien.chartAccount.findMany({
    where: { isActive: true, children: { none: {} } },
    select: { id: true, code: true, name: true, type: true },
    orderBy: { code: "asc" },
  });
  return akun.filter((x) => !rekeningKas.has(x.id)).map((x) => ({ id: x.id, kode: x.code, nama: x.name, tipe: x.type }));
}
