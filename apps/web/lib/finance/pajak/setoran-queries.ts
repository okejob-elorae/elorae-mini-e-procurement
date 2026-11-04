import { prisma, type Prisma, type PrismaClient } from "@elorae/db";
import type { JenisSetoran } from "./setoran";

/** Bacaan setoran pajak — KHUSUS SERVER. Komponen klien hanya `import type`. */

type Klien = PrismaClient | Prisma.TransactionClient;

export type RekeningKasBank = { id: string; kode: string; nama: string };

/**
 * Akun yang boleh membayar setoran: akun ASET aktif tanpa turunan yang
 * dipetakan ke peran BANK/CASH atau diklasifikasikan KAS di Klasifikasi Arus
 * Kas. Daftar kosong → setoran memakai akun peran BANK.
 */
export async function rekeningKasBank(client: Klien = prisma): Promise<RekeningKasBank[]> {
  const peta = await client.journalAccountMapping.findMany({ where: { role: { in: ["BANK", "CASH"] } }, select: { chartAccountId: true } });
  const akun = await client.chartAccount.findMany({
    where: {
      type: "ASET",
      isActive: true,
      children: { none: {} },
      OR: [{ id: { in: peta.map((p) => p.chartAccountId) } }, { cashFlowSection: "KAS" }],
    },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return akun.map((a) => ({ id: a.id, kode: a.code, nama: a.name }));
}

export type BarisSetoran = {
  id: string;
  jenis: string;
  masa: string;
  jumlah: number;
  tanggalBayar: string;
  ntpn: string | null;
  kodeBilling: string | null;
  rekening: string | null;
  status: "POSTED" | "CANCELLED";
  catatan: string | null;
  alasanBatal: string | null;
  dibatalkanAt: string | null;
  jurnalId: string | null;
  pencatat: string | null;
};

const POLA_TAHUN = /^\d{4}$/;

/** Setoran satu tahun (masa YYYY-xx), terbaru dulu; `jenis` opsional. */
export async function daftarSetoran(opsi: { tahun: string; jenis?: JenisSetoran | null }, client: Klien = prisma): Promise<BarisSetoran[]> {
  if (!POLA_TAHUN.test(opsi.tahun)) return [];
  const baris = await client.taxPayment.findMany({
    where: { period: { startsWith: `${opsi.tahun}-` }, ...(opsi.jenis ? { type: opsi.jenis } : {}) },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const akunIds = [...new Set(baris.map((b) => b.cashAccountId).filter((x): x is string => !!x))];
  const userIds = [...new Set(baris.map((b) => b.createdById))];
  const [akun, user, jurnal] = await Promise.all([
    akunIds.length ? client.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } }) : [],
    userIds.length ? client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } }) : [],
    baris.length
      ? client.journal.findMany({ where: { sourceType: "TAX_PAYMENT", sourceId: { in: baris.map((b) => b.id) } }, select: { id: true, sourceId: true } })
      : [],
  ]);
  const namaAkun = new Map(akun.map((a) => [a.id, `${a.code} ${a.name}`]));
  const namaUser = new Map(user.map((u) => [u.id, u.name || u.email]));
  const jurnalDari = new Map(jurnal.map((j) => [j.sourceId, j.id]));
  return baris.map((b) => ({
    id: b.id,
    jenis: b.type,
    masa: b.period,
    jumlah: Number(b.amount),
    tanggalBayar: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(b.paidAt),
    ntpn: b.ntpn,
    kodeBilling: b.billingCode,
    rekening: b.cashAccountId ? (namaAkun.get(b.cashAccountId) ?? null) : null,
    status: b.status === "CANCELLED" ? "CANCELLED" : "POSTED",
    catatan: b.note,
    alasanBatal: b.cancelReason,
    dibatalkanAt: b.cancelledAt ? b.cancelledAt.toISOString() : null,
    jurnalId: jurnalDari.get(b.id) ?? null,
    pencatat: namaUser.get(b.createdById) ?? null,
  }));
}

/** Σ setoran berlaku per (jenis, masa) untuk sekumpulan masa — dipakai kalender pajak. */
export async function jumlahDisetor(masa: readonly string[], client: Klien = prisma): Promise<Map<string, number>> {
  if (masa.length === 0) return new Map();
  const g = await client.taxPayment.groupBy({
    by: ["type", "period"],
    where: { status: "POSTED", period: { in: [...masa] } },
    _sum: { amount: true },
  });
  return new Map(g.map((x) => [`${x.type}|${x.period}`, Number(x._sum.amount ?? 0)]));
}
