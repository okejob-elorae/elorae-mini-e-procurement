import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { catatVoucherDalamTransaksi, type KodeTolakVoucher } from "./voucher-writer";
import { catatJejakKas, JEJAK_KAS } from "./jejak";
import {
  bacaPengaturanKasKecil,
  hitungIsiUlangSen,
  KUNCI_KAS_KECIL,
  periksaPengaturanKasKecil,
  type DanaKasKecil,
  type KodeGalatKasKecil,
  type PengaturanKasKecil,
} from "./kas-kecil";

/**
 * Kas kecil (dana tetap) — KHUSUS SERVER. Lihat `./kas-kecil.ts` untuk aturannya.
 */

type Klien = Prisma.TransactionClient | typeof prisma;
const sen = (v: Prisma.Decimal | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

export async function bacaPengaturanKasKecilDb(klien: Klien = prisma): Promise<PengaturanKasKecil> {
  const row = await klien.systemSetting.findUnique({ where: { key: KUNCI_KAS_KECIL }, select: { value: true } });
  return bacaPengaturanKasKecil(row?.value ?? null);
}

/** Saldo buku satu akun (debit − kredit, jurnal berlaku), dalam sen. */
export async function saldoAkunSen(akunId: string, klien: Klien = prisma, sampai?: Date): Promise<number> {
  const r = await klien.journalLine.aggregate({
    where: { chartAccountId: akunId, journal: { status: "POSTED", ...(sampai ? { date: { lte: sampai } } : {}) } },
    _sum: { debit: true, credit: true },
  });
  return sen(r._sum.debit) - sen(r._sum.credit);
}

export type KeadaanKasKecil = DanaKasKecil & {
  akunKode: string;
  akunNama: string;
  rekeningSumber: string | null;
  saldo: number;
  isiUlang: number;
  isiUlangTerakhir: { nomor: string; tanggal: string; jumlah: number } | null;
  /** Pengeluaran (BKK berlaku dari rekening ini) sejak isi ulang terakhir. */
  terpakaiSejakIsi: number;
  jumlahBkkSejakIsi: number;
};

export async function keadaanKasKecil(klien: Klien = prisma): Promise<KeadaanKasKecil[]> {
  const p = await bacaPengaturanKasKecilDb(klien);
  if (p.dana.length === 0) return [];
  const akunIds = [...new Set(p.dana.flatMap((d) => [d.akunId, d.rekeningSumberId].filter((x): x is string => Boolean(x))))];
  const akun = await klien.chartAccount.findMany({ where: { id: { in: akunIds } }, select: { id: true, code: true, name: true } });
  const a = new Map(akun.map((x) => [x.id, x]));
  const hasil: KeadaanKasKecil[] = [];
  for (const d of p.dana) {
    const saldoSen = await saldoAkunSen(d.akunId, klien);
    const isi = await klien.cashVoucher.findFirst({
      where: { type: "TRANSFER", transferAccountId: d.akunId, status: "POSTED" },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      select: { docNumber: true, date: true, totalAmount: true, createdAt: true },
    });
    const bkk = await klien.cashVoucher.aggregate({
      where: { type: "OUT", cashAccountId: d.akunId, status: "POSTED", ...(isi ? { createdAt: { gt: isi.createdAt } } : {}) },
      _sum: { netAmount: true },
      _count: { _all: true },
    });
    hasil.push({
      ...d,
      akunKode: a.get(d.akunId)?.code ?? "?",
      akunNama: a.get(d.akunId)?.name ?? "(akun tidak ditemukan)",
      rekeningSumber: d.rekeningSumberId ? (a.get(d.rekeningSumberId) ? `${a.get(d.rekeningSumberId)!.name} (${a.get(d.rekeningSumberId)!.code})` : null) : null,
      saldo: saldoSen / 100,
      isiUlang: hitungIsiUlangSen(d.danaTetap, saldoSen / 100) / 100,
      isiUlangTerakhir: isi ? { nomor: isi.docNumber, tanggal: formatDateOnlyJakarta(isi.date), jumlah: Number(isi.totalAmount) } : null,
      terpakaiSejakIsi: sen(bkk._sum.netAmount) / 100,
      jumlahBkkSejakIsi: bkk._count._all,
    });
  }
  return hasil;
}

export async function simpanPengaturanKasKecil(
  input: unknown,
  olehUserId: string,
): Promise<{ ok: true } | { ok: false; kode: KodeGalatKasKecil; baris?: number }> {
  return runSerializable(async (tx) => {
    const rekening = new Set((await rekeningKasBank(tx)).map((r) => r.id));
    const r = periksaPengaturanKasKecil(input, rekening);
    if (!r.ok) return r;
    const sebelum = await bacaPengaturanKasKecilDb(tx);
    await tx.systemSetting.upsert({
      where: { key: KUNCI_KAS_KECIL },
      create: { key: KUNCI_KAS_KECIL, value: JSON.stringify(r.pengaturan) },
      update: { value: JSON.stringify(r.pengaturan) },
    });
    await catatJejakKas(tx, {
      userId: olehUserId,
      action: JEJAK_KAS.KAS_KECIL_DIUBAH,
      entityType: "SystemSetting",
      entityId: KUNCI_KAS_KECIL,
      changes: { before: sebelum, after: r.pengaturan },
    });
    return { ok: true as const };
  });
}

export type HasilIsiUlang =
  | { ok: true; voucherId: string; nomor: string; jumlah: number; ulang: boolean }
  | { ok: false; kode: "BUKAN_KAS_KECIL" | "SUMBER_WAJIB" | "TIDAK_PERLU" | KodeTolakVoucher; peran?: string; baris?: number };

/**
 * Isi ulang kas kecil: SATU voucher TRANSFER dari rekening sumber sebesar dana
 * tetap − saldo buku SAAT INI (dibaca di dalam transaksi). Idempoten per kunci.
 */
export async function isiUlangKasKecil(input: { akunId: string; rekeningSumberId?: string | null; olehUserId: string; idempotencyKey?: string | null; keterangan?: string | null }): Promise<HasilIsiUlang> {
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() ? input.idempotencyKey.trim().slice(0, 100) : null;
  return runSerializable(async (tx): Promise<HasilIsiUlang> => {
    if (kunci) {
      const ada = await tx.cashVoucher.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, docNumber: true, totalAmount: true } });
      if (ada) return { ok: true, voucherId: ada.id, nomor: ada.docNumber, jumlah: Number(ada.totalAmount), ulang: true };
    }
    const p = await bacaPengaturanKasKecilDb(tx);
    const dana = p.dana.find((d) => d.akunId === input.akunId);
    if (!dana) return { ok: false, kode: "BUKAN_KAS_KECIL" };
    const sumber = input.rekeningSumberId || dana.rekeningSumberId;
    if (!sumber) return { ok: false, kode: "SUMBER_WAJIB" };
    const jumlahSen = hitungIsiUlangSen(dana.danaTetap, (await saldoAkunSen(dana.akunId, tx)) / 100);
    if (jumlahSen <= 0) return { ok: false, kode: "TIDAK_PERLU" };
    const hariIni = hariIniWib();
    const v = await catatVoucherDalamTransaksi(tx, {
      jenis: "TRANSFER",
      tanggal: hariIni,
      rekeningId: sumber,
      rekeningTujuanId: dana.akunId,
      jumlahTransfer: jumlahSen / 100,
      pihak: dana.pemegang,
      keterangan: input.keterangan?.trim() || "Isi ulang kas kecil",
      olehUserId: input.olehUserId,
      hariIni,
      idempotencyKey: kunci,
    });
    if (!v.ok) return v;
    return { ok: true, voucherId: v.id, nomor: v.nomor, jumlah: jumlahSen / 100, ulang: false };
  });
}
