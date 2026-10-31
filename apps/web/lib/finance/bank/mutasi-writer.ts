import { createHash } from "node:crypto";
import { prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { rekeningKasBank } from "@/lib/finance/pajak/setoran-queries";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { catatVoucherDalamTransaksi, type KodeTolakVoucher } from "@/lib/finance/kas/voucher-writer";
import { catatJejakKas, JEJAK_KAS } from "@/lib/finance/kas/jejak";
import { kunciBerindeks, type BarisMutasi, type FormatMutasi } from "./baca-mutasi";
import { cocokkanOtomatis, jumlahSenBarisBank, TOLERANSI_HARI_COCOK } from "./cocok";
import { jurnalTerbatalkan, PILIH_JURNAL_CEK } from "./jurnal-batal";

/**
 * Penulis rekonsiliasi bank — KHUSUS SERVER. Semua perubahan keadaan baris
 * mutasi di `runSerializable` dengan jejak di transaksi yang sama.
 *
 * Status baris: UNMATCHED (belum cocok) → MATCHED (satu baris jurnal akun bank
 * itu, `matchedJournalLineId` unik) atau IGNORED (diabaikan, dengan alasan).
 * "Buat voucher dari mutasi" mencatat voucher kas/bank (BKK untuk uang keluar,
 * BKMK untuk uang masuk) dan langsung mencocokkannya; membatalkan voucher itu
 * melepas barisnya lagi (`lepasMutasiDariJurnal`). Baris jurnal voucher atau
 * pembayaran yang dibatalkan (asli maupun pembaliknya) tidak pernah menjadi
 * pasangan mutasi (`jurnalTerbatalkan`) — diperiksa di dalam transaksi yang
 * sama dengan penulisannya, jadi pembatalan yang balapan tidak lolos.
 */

export const STATUS_MUTASI = { BELUM: "UNMATCHED", COCOK: "MATCHED", ABAIKAN: "IGNORED" } as const;

export type KodeTolakMutasi =
  | "REKENING_TIDAK_SAH"
  | "TIDAK_DITEMUKAN"
  | "BUKAN_BELUM_COCOK"
  | "BUKAN_COCOK"
  | "BUKAN_DIABAIKAN"
  | "JURNAL_TIDAK_SAH"
  | "JURNAL_SUDAH_DICOCOKKAN"
  | "JURNAL_DIBATALKAN"
  | "JUMLAH_BERBEDA"
  | "DARI_VOUCHER"
  | "ALASAN_WAJIB"
  | "ADA_YANG_COCOK"
  | "TANPA_AKUN"
  | KodeTolakVoucher;

type Tolak<K extends string = KodeTolakMutasi> = { ok: false; kode: K; peran?: string; baris?: number };

const sen = (v: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(v ?? 0) * 100);

/** Sidik jari baris untuk menolak impor ganda (unik per akun). */
export function sidikMutasi(baris: readonly BarisMutasi[]): string[] {
  return kunciBerindeks(baris).map((k) => createHash("sha256").update(k).digest("hex").slice(0, 40));
}

async function pastikanRekening(akunId: string, klien: Prisma.TransactionClient | typeof prisma): Promise<boolean> {
  const r = await rekeningKasBank(klien);
  return r.some((x) => x.id === akunId);
}

export type HasilImpor =
  | { ok: true; importId: string | null; baru: number; sudahAda: number; dicocokkan: number }
  | Tolak<"REKENING_TIDAK_SAH" | "TANPA_BARIS">;

export async function imporMutasi(input: {
  akunId: string;
  namaBerkas: string;
  format: FormatMutasi;
  baris: BarisMutasi[];
  periodeDari: string | null;
  periodeSampai: string | null;
  saldoAwalSen: number | null;
  saldoAkhirSen: number | null;
  olehUserId: string;
}): Promise<HasilImpor> {
  if (input.baris.length === 0) return { ok: false, kode: "TANPA_BARIS" };
  const sidik = sidikMutasi(input.baris);
  const hasil = await runSerializable(async (tx): Promise<HasilImpor> => {
    if (!(await pastikanRekening(input.akunId, tx))) return { ok: false, kode: "REKENING_TIDAK_SAH" };
    const ada = new Set<string>();
    for (let i = 0; i < sidik.length; i += 1000) {
      const r = await tx.bankStatementLine.findMany({
        where: { chartAccountId: input.akunId, fingerprint: { in: sidik.slice(i, i + 1000) } },
        select: { fingerprint: true },
      });
      for (const x of r) if (x.fingerprint) ada.add(x.fingerprint);
    }
    const baru = input.baris.map((b, i) => ({ b, f: sidik[i] })).filter((x) => !ada.has(x.f));
    if (baru.length === 0) return { ok: true, importId: null, baru: 0, sudahAda: input.baris.length, dicocokkan: 0 };
    const waktu = Date.now();
    const imp = await tx.bankStatementImport.create({
      data: {
        chartAccountId: input.akunId,
        bankFormat: input.format,
        fileName: input.namaBerkas.slice(0, 191) || "mutasi",
        periodFrom: input.periodeDari ? parseDateOnly(input.periodeDari) : null,
        periodTo: input.periodeSampai ? parseDateOnly(input.periodeSampai) : null,
        openingBalance: input.saldoAwalSen == null ? null : input.saldoAwalSen / 100,
        closingBalance: input.saldoAkhirSen == null ? null : input.saldoAkhirSen / 100,
        lineCount: baru.length,
        importedById: input.olehUserId,
      },
      select: { id: true },
    });
    // `createdAt` berurutan menjaga urutan baris di berkas (dibaca laporan saldo per hari).
    await tx.bankStatementLine.createMany({
      data: baru.map(({ b, f }, i) => ({
        importId: imp.id,
        chartAccountId: input.akunId,
        date: parseDateOnly(b.tanggal) as Date,
        description: b.keterangan,
        amount: b.jumlahSen / 100,
        balance: b.saldoSen == null ? null : b.saldoSen / 100,
        externalRef: b.referensi,
        fingerprint: f,
        status: STATUS_MUTASI.BELUM,
        createdAt: new Date(waktu + i),
      })),
    });
    await catatJejakKas(tx, {
      userId: input.olehUserId,
      action: JEJAK_KAS.MUTASI_DIIMPOR,
      entityType: "BankStatementImport",
      entityId: imp.id,
      metadata: { akunId: input.akunId, berkas: input.namaBerkas, format: input.format, baru: baru.length, sudahAda: input.baris.length - baru.length },
    });
    return { ok: true, importId: imp.id, baru: baru.length, sudahAda: input.baris.length - baru.length, dicocokkan: 0 };
  });
  if (!hasil.ok || !hasil.importId) return hasil;
  const cocok = await cocokkanOtomatisAkun({ akunId: input.akunId, olehUserId: input.olehUserId });
  return { ...hasil, dicocokkan: cocok.ok ? cocok.dicocokkan : 0 };
}

/**
 * Cocokkan otomatis semua baris BELUM COCOK satu akun (atau `mutasiIds`) ke
 * baris jurnal akun itu yang belum dicocokkan, jumlah sama, ±3 hari.
 */
export async function cocokkanOtomatisAkun(input: {
  akunId: string;
  olehUserId: string;
  mutasiIds?: string[];
}): Promise<{ ok: true; dicocokkan: number } | Tolak<"REKENING_TIDAK_SAH">> {
  return runSerializable(async (tx) => {
    if (!(await pastikanRekening(input.akunId, tx))) return { ok: false as const, kode: "REKENING_TIDAK_SAH" as const };
    const mutasi = await tx.bankStatementLine.findMany({
      where: { chartAccountId: input.akunId, status: STATUS_MUTASI.BELUM, ...(input.mutasiIds ? { id: { in: input.mutasiIds } } : {}) },
      select: { id: true, date: true, amount: true },
    });
    if (mutasi.length === 0) return { ok: true as const, dicocokkan: 0 };
    const t = mutasi.map((m) => m.date.getTime());
    const dari = new Date(Math.min(...t) - (TOLERANSI_HARI_COCOK + 1) * 86_400_000);
    const sampai = new Date(Math.max(...t) + (TOLERANSI_HARI_COCOK + 1) * 86_400_000);
    const semuaBaris = await tx.journalLine.findMany({
      where: { chartAccountId: input.akunId, journal: { status: "POSTED", date: { gte: dari, lte: sampai } } },
      select: { id: true, debit: true, credit: true, journal: { select: { date: true, ...PILIH_JURNAL_CEK } } },
    });
    const batal = await jurnalTerbatalkan(tx, [...new Map(semuaBaris.map((b) => [b.journal.id, b.journal])).values()]);
    const barisJurnal = semuaBaris.filter((b) => !batal.has(b.journal.id));
    const terpakai = new Set<string>();
    for (let i = 0; i < barisJurnal.length; i += 1000) {
      const r = await tx.bankStatementLine.findMany({
        where: { matchedJournalLineId: { in: barisJurnal.slice(i, i + 1000).map((b) => b.id) } },
        select: { matchedJournalLineId: true },
      });
      for (const x of r) if (x.matchedJournalLineId) terpakai.add(x.matchedJournalLineId);
    }
    const pasangan = cocokkanOtomatis(
      mutasi.map((m) => ({ id: m.id, tanggal: formatDateOnlyJakarta(m.date), jumlahSen: sen(m.amount) })),
      barisJurnal
        .filter((b) => !terpakai.has(b.id))
        .map((b) => ({ id: b.id, tanggal: formatDateOnlyJakarta(b.journal.date), jumlahSen: jumlahSenBarisBank(b.debit.toString(), b.credit.toString()) })),
    );
    const kini = new Date();
    for (const p of pasangan) {
      await tx.bankStatementLine.updateMany({
        where: { id: p.mutasiId, status: STATUS_MUTASI.BELUM },
        data: { status: STATUS_MUTASI.COCOK, matchedJournalLineId: p.jurnalBarisId, matchedAt: kini, matchedById: input.olehUserId },
      });
    }
    if (pasangan.length > 0) {
      await catatJejakKas(tx, {
        userId: input.olehUserId,
        action: JEJAK_KAS.MUTASI_DICOCOKKAN_OTOMATIS,
        entityType: "ChartAccount",
        entityId: input.akunId,
        metadata: { jumlah: pasangan.length, pasangan: pasangan.slice(0, 200) },
      });
    }
    return { ok: true as const, dicocokkan: pasangan.length };
  });
}

export async function cocokkanManual(input: { mutasiId: string; barisJurnalId: string; olehUserId: string }): Promise<{ ok: true } | Tolak> {
  return runSerializable(async (tx): Promise<{ ok: true } | Tolak> => {
    const m = await tx.bankStatementLine.findUnique({ where: { id: input.mutasiId }, select: { id: true, status: true, chartAccountId: true, amount: true } });
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.status !== STATUS_MUTASI.BELUM) return { ok: false, kode: "BUKAN_BELUM_COCOK" };
    const j = await tx.journalLine.findUnique({
      where: { id: input.barisJurnalId },
      select: { id: true, chartAccountId: true, debit: true, credit: true, journal: { select: { status: true, ...PILIH_JURNAL_CEK } } },
    });
    if (!j || j.chartAccountId !== m.chartAccountId || j.journal.status !== "POSTED") return { ok: false, kode: "JURNAL_TIDAK_SAH" };
    if ((await jurnalTerbatalkan(tx, [j.journal])).size > 0) return { ok: false, kode: "JURNAL_DIBATALKAN" };
    const dipakai = await tx.bankStatementLine.findFirst({ where: { matchedJournalLineId: j.id }, select: { id: true } });
    if (dipakai) return { ok: false, kode: "JURNAL_SUDAH_DICOCOKKAN" };
    if (jumlahSenBarisBank(j.debit.toString(), j.credit.toString()) !== sen(m.amount)) return { ok: false, kode: "JUMLAH_BERBEDA" };
    await tx.bankStatementLine.update({
      where: { id: m.id },
      data: { status: STATUS_MUTASI.COCOK, matchedJournalLineId: j.id, matchedAt: new Date(), matchedById: input.olehUserId },
    });
    await catatJejakKas(tx, {
      userId: input.olehUserId,
      action: JEJAK_KAS.MUTASI_DICOCOKKAN,
      entityType: "BankStatementLine",
      entityId: m.id,
      changes: { before: { status: STATUS_MUTASI.BELUM }, after: { status: STATUS_MUTASI.COCOK, barisJurnalId: j.id } },
    });
    return { ok: true };
  });
}

export async function lepasCocok(input: { mutasiId: string; olehUserId: string }): Promise<{ ok: true } | Tolak> {
  return runSerializable(async (tx): Promise<{ ok: true } | Tolak> => {
    const m = await tx.bankStatementLine.findUnique({ where: { id: input.mutasiId }, select: { id: true, status: true, matchedJournalLineId: true, createdJournalId: true } });
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.status !== STATUS_MUTASI.COCOK) return { ok: false, kode: "BUKAN_COCOK" };
    if (m.createdJournalId) return { ok: false, kode: "DARI_VOUCHER" };
    await tx.bankStatementLine.update({
      where: { id: m.id },
      data: { status: STATUS_MUTASI.BELUM, matchedJournalLineId: null, matchedAt: null, matchedById: null },
    });
    await catatJejakKas(tx, {
      userId: input.olehUserId,
      action: JEJAK_KAS.MUTASI_DILEPAS,
      entityType: "BankStatementLine",
      entityId: m.id,
      changes: { before: { status: STATUS_MUTASI.COCOK, barisJurnalId: m.matchedJournalLineId }, after: { status: STATUS_MUTASI.BELUM } },
    });
    return { ok: true };
  });
}

export async function abaikanMutasi(input: { mutasiId: string; olehUserId: string; alasan: string }): Promise<{ ok: true } | Tolak> {
  const alasan = input.alasan?.trim() ?? "";
  if (alasan.length < 3) return { ok: false, kode: "ALASAN_WAJIB" };
  return runSerializable(async (tx): Promise<{ ok: true } | Tolak> => {
    const r = await tx.bankStatementLine.updateMany({ where: { id: input.mutasiId, status: STATUS_MUTASI.BELUM }, data: { status: STATUS_MUTASI.ABAIKAN, note: alasan.slice(0, 1000) } });
    if (r.count === 0) return { ok: false, kode: (await tx.bankStatementLine.count({ where: { id: input.mutasiId } })) ? "BUKAN_BELUM_COCOK" : "TIDAK_DITEMUKAN" };
    await catatJejakKas(tx, { userId: input.olehUserId, action: JEJAK_KAS.MUTASI_DIABAIKAN, entityType: "BankStatementLine", entityId: input.mutasiId, reason: alasan });
    return { ok: true };
  });
}

export async function bukaAbaikan(input: { mutasiId: string; olehUserId: string }): Promise<{ ok: true } | Tolak> {
  return runSerializable(async (tx): Promise<{ ok: true } | Tolak> => {
    const r = await tx.bankStatementLine.updateMany({ where: { id: input.mutasiId, status: STATUS_MUTASI.ABAIKAN }, data: { status: STATUS_MUTASI.BELUM, note: null } });
    if (r.count === 0) return { ok: false, kode: (await tx.bankStatementLine.count({ where: { id: input.mutasiId } })) ? "BUKAN_DIABAIKAN" : "TIDAK_DITEMUKAN" };
    await catatJejakKas(tx, { userId: input.olehUserId, action: JEJAK_KAS.MUTASI_DIBUKA, entityType: "BankStatementLine", entityId: input.mutasiId });
    return { ok: true };
  });
}

/** Pilihan cepat akun lawan saat membuat voucher dari mutasi. */
export const PERAN_CEPAT_MUTASI = { BIAYA_ADMIN: "BANK_CHARGES", BUNGA: "OTHER_INCOME" } as const;

export async function buatVoucherDariMutasi(input: {
  mutasiId: string;
  olehUserId: string;
  /** Salah satu: akun langsung, kategori, atau peran cepat. */
  akunId?: string | null;
  kategoriId?: string | null;
  peranCepat?: keyof typeof PERAN_CEPAT_MUTASI | null;
  keterangan?: string | null;
}): Promise<{ ok: true; voucherId: string; nomor: string } | Tolak> {
  return runSerializable(async (tx): Promise<{ ok: true; voucherId: string; nomor: string } | Tolak> => {
    const m = await tx.bankStatementLine.findUnique({
      where: { id: input.mutasiId },
      select: { id: true, status: true, chartAccountId: true, amount: true, date: true, description: true },
    });
    if (!m) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    if (m.status !== STATUS_MUTASI.BELUM) return { ok: false, kode: "BUKAN_BELUM_COCOK" };
    let akunId = input.akunId ?? null;
    if (!akunId && !input.kategoriId && input.peranCepat) {
      try {
        akunId = await resolveAccount(PERAN_CEPAT_MUTASI[input.peranCepat], tx);
      } catch (e) {
        if (e instanceof UnmappedRoleError) return { ok: false, kode: "UNMAPPED_ROLE", peran: e.role };
        throw e;
      }
    }
    if (!akunId && !input.kategoriId) return { ok: false, kode: "TANPA_AKUN" };
    const jumlahSen = sen(m.amount);
    const tanggal = formatDateOnlyJakarta(m.date);
    const v = await catatVoucherDalamTransaksi(tx, {
      jenis: jumlahSen < 0 ? "OUT" : "IN",
      tanggal,
      rekeningId: m.chartAccountId,
      keterangan: (input.keterangan?.trim() || m.description).slice(0, 1000),
      baris: [{ akunId, kategoriId: input.kategoriId ?? null, jumlah: Math.abs(jumlahSen) / 100 }],
      olehUserId: input.olehUserId,
      hariIni: tanggal > hariIniWib() ? tanggal : hariIniWib(),
    });
    if (!v.ok) return v;
    const barisId = v.barisRekeningIds[0];
    await tx.bankStatementLine.update({
      where: { id: m.id },
      data: { status: STATUS_MUTASI.COCOK, matchedJournalLineId: barisId, matchedAt: new Date(), matchedById: input.olehUserId, createdJournalId: v.journalId, note: `Dicatat sebagai ${v.nomor}` },
    });
    await catatJejakKas(tx, {
      userId: input.olehUserId,
      action: JEJAK_KAS.MUTASI_DICOCOKKAN,
      entityType: "BankStatementLine",
      entityId: m.id,
      changes: { before: { status: STATUS_MUTASI.BELUM }, after: { status: STATUS_MUTASI.COCOK, voucher: v.nomor } },
    });
    return { ok: true, voucherId: v.id, nomor: v.nomor };
  });
}

export async function hapusImporMutasi(input: { importId: string; olehUserId: string }): Promise<{ ok: true } | Tolak> {
  return runSerializable(async (tx): Promise<{ ok: true } | Tolak> => {
    const imp = await tx.bankStatementImport.findUnique({ where: { id: input.importId }, select: { id: true, fileName: true, chartAccountId: true, lineCount: true } });
    if (!imp) return { ok: false, kode: "TIDAK_DITEMUKAN" };
    const cocok = await tx.bankStatementLine.count({ where: { importId: imp.id, status: STATUS_MUTASI.COCOK } });
    if (cocok > 0) return { ok: false, kode: "ADA_YANG_COCOK" };
    await tx.bankStatementImport.delete({ where: { id: imp.id } });
    await catatJejakKas(tx, {
      userId: input.olehUserId,
      action: JEJAK_KAS.MUTASI_IMPOR_DIHAPUS,
      entityType: "BankStatementImport",
      entityId: imp.id,
      metadata: { berkas: imp.fileName, akunId: imp.chartAccountId, baris: imp.lineCount },
    });
    return { ok: true };
  });
}
