import { JournalError, lockPeriodForPosting, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { bulanWib, kunciBulan, labelBulan, type TahunBulan } from "@/lib/finance/periode/periode";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { catatGagalSapuan } from "@/lib/finance/sapuan/tertunda";
import { akunBisaDiposting, KATEGORI_PERSETUJUAN_JURNAL } from "@/lib/finance/jurnal-manual/writer";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import type { AdminNotification } from "@elorae/db";
import {
  idSumberBerulang,
  periksaTemplat,
  periodeJatuhTempo,
  SUMBER_BERULANG,
  tanggalBalikBulan,
  tanggalPostingBulan,
  type IsianTemplat,
  type KodeGalatTemplat,
  type TemplatBersih,
} from "./aturan";
import { ENTITAS_BERULANG, JEJAK_BERULANG, JEJAK_ISI_TEMPLAT } from "./jejak";

/*
 * Penulis jurnal berulang & akrual (bagian D4) — KHUSUS SERVER.
 *
 * Persetujuan (keputusan sementara pemilik no. 39, diperluas ke templat):
 * templat adalah jurnal manual yang berulang, jadi ISI-nya butuh persetujuan
 * orang lain sebelum pernah diposting. Templat baru / yang diubah = nonaktif
 * (`active = false`) sampai disetujui orang SELAIN pengubah terakhirnya.
 * Menghentikan sementara boleh siapa saja yang mengelola; melanjutkan templat
 * yang isinya tidak berubah sejak disetujui tidak butuh persetujuan baru. Tidak
 * ada kolom persetujuan di skema — keadaannya diturunkan dari jejak
 * (`JEJAK_BERULANG`).
 *
 * Posting (cron harian + tombol "Posting sekarang"): satu jurnal per bulan
 * jatuh tempo (`RECURRING`, sourceId `<templat>/<YYYY-MM>`, idempoten),
 * bertanggal hari posting bulan itu, dengan pembaliknya tanggal 1 bulan
 * berikutnya bila akrual (`RECURRING_REVERSAL`, `reversalOfId`) — keduanya di
 * satu transaksi. Bulan yang sudah DITUTUP dilewati dengan catatan jejak
 * `RECURRING_JOURNAL_SKIPPED` (sekali per bulan), tidak pernah digeser.
 * Pembuat jurnal = pembuat templat; penyetuju = penyetuju templat.
 */

export type KodeTolakTemplat =
  | KodeGalatTemplat
  | "NON_POSTABLE_ACCOUNT"
  | "TIDAK_DITEMUKAN"
  | "PEMBUAT_SAMA"
  | "SUDAH_AKTIF"
  | "BUKAN_AKTIF"
  | "SUDAH_DIPOSTING";

export type HasilTemplat = { ok: true; id: string; ulang?: boolean } | { ok: false; kode: KodeTolakTemplat; baris?: number };

class Tolak extends Error {
  constructor(
    public kode: KodeTolakTemplat,
    public baris?: number,
  ) {
    super(kode);
  }
}

function petakan(e: unknown): HasilTemplat | null {
  if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.baris ? { baris: e.baris } : {}) };
  if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
  return null;
}

function bacaMeta(m: unknown): Record<string, unknown> | null {
  let v = m;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** Keadaan persetujuan dari jejak: pengubah isi terakhir, dan apakah sudah disetujui sesudahnya (+ siapa). */
export async function persetujuanTemplat(
  client: Prisma.TransactionClient | typeof prisma,
  templatIds: string[],
): Promise<Map<string, { pengubahTerakhir: string | null; disetujuiOleh: string | null; disetujuiPada: Date | null }>> {
  const hasil = new Map<string, { pengubahTerakhir: string | null; disetujuiOleh: string | null; disetujuiPada: Date | null }>();
  if (!templatIds.length) return hasil;
  const jejak = await client.auditLog.findMany({
    where: { entityType: ENTITAS_BERULANG, entityId: { in: templatIds }, action: { in: [...JEJAK_ISI_TEMPLAT, JEJAK_BERULANG.DISETUJUI] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { entityId: true, action: true, userId: true, createdAt: true },
  });
  for (const id of templatIds) hasil.set(id, { pengubahTerakhir: null, disetujuiOleh: null, disetujuiPada: null });
  for (const j of jejak) {
    const h = hasil.get(j.entityId)!;
    if (JEJAK_ISI_TEMPLAT.includes(j.action)) {
      h.pengubahTerakhir = j.userId;
      h.disetujuiOleh = null;
      h.disetujuiPada = null;
    } else {
      h.disetujuiOleh = j.userId;
      h.disetujuiPada = j.createdAt;
    }
  }
  return hasil;
}

/** Notifikasi kantor "templat menunggu persetujuan" (kategori yang sama dengan jurnal manual). Tidak pernah melempar. */
async function kabariTemplatMenunggu(templatId: string, nama: string, baru: boolean): Promise<void> {
  let baris: AdminNotification | null = null;
  try {
    baris = await prisma.adminNotification.create({
      data: {
        category: KATEGORI_PERSETUJUAN_JURNAL,
        severity: "INFO",
        title: baru ? "Templat jurnal berulang menunggu persetujuan" : "Templat jurnal berulang diubah — menunggu persetujuan",
        message: `Templat "${nama}" baru diposting setiap bulan sesudah disetujui orang lain selain yang terakhir mengubahnya.`,
        metadata: { templatId },
      },
    });
  } catch (e) {
    console.error("[jurnal-berulang] gagal menulis notifikasi persetujuan", templatId, e);
  }
  if (baris) void fanOutAdminNotification(baris);
}

/** Notifikasi persetujuan templat yang sudah disetujui ditandai selesai. Tidak pernah melempar. */
async function selesaikanNotifikasiTemplat(templatId: string): Promise<void> {
  try {
    const belum = await prisma.adminNotification.findMany({ where: { category: KATEGORI_PERSETUJUAN_JURNAL, readAt: null }, select: { id: true, metadata: true } });
    const ids = belum.filter((n) => bacaMeta(n.metadata)?.templatId === templatId).map((n) => n.id);
    if (ids.length) await prisma.adminNotification.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
  } catch (e) {
    console.error("[jurnal-berulang] gagal menandai notifikasi persetujuan selesai", templatId, e);
  }
}

function ringkasIsi(t: { name: string; dayOfMonth: number; startDate: Date; endDate: Date | null; autoReverse: boolean }, total: number, baris: number) {
  return {
    nama: t.name,
    hari: t.dayOfMonth,
    mulai: formatDateOnlyJakarta(t.startDate),
    selesai: t.endDate ? formatDateOnlyJakarta(t.endDate) : null,
    balikOtomatis: t.autoReverse,
    total,
    baris,
  };
}

function dataTemplat(t: TemplatBersih) {
  return {
    name: t.nama,
    description: t.keterangan,
    frequency: "MONTHLY",
    dayOfMonth: t.hari,
    startDate: parseDateOnly(t.mulai) as Date,
    endDate: t.selesai ? (parseDateOnly(t.selesai) as Date) : null,
    autoReverse: t.balikOtomatis,
  };
}

function dataBaris(t: TemplatBersih) {
  return t.baris.map((b, i) => ({ chartAccountId: b.akunId, debit: b.debit, credit: b.kredit, memo: b.memo, channel: b.kanal, sortOrder: i }));
}

async function templatDenganKunci(client: Prisma.TransactionClient | typeof prisma, olehUserId: string, kunci: string): Promise<string | null> {
  const baris = await client.auditLog.findMany({
    where: { action: JEJAK_BERULANG.DIBUAT, userId: olehUserId, createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
    select: { entityId: true, metadata: true },
  });
  return baris.find((b) => bacaMeta(b.metadata)?.kunci === kunci)?.entityId ?? null;
}

export async function buatTemplat(isi: IsianTemplat & { olehUserId: string; idempotencyKey?: string | null }): Promise<HasilTemplat> {
  const p = periksaTemplat(isi);
  if (!p.ok) return p;
  const t = p.templat;
  const kunci = typeof isi.idempotencyKey === "string" && isi.idempotencyKey.trim() ? isi.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await templatDenganKunci(prisma, isi.olehUserId, kunci);
    if (lama) return { ok: true, id: lama, ulang: true };
  }
  let hasil: HasilTemplat;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilTemplat> => {
      if (kunci) {
        const lama = await templatDenganKunci(tx, isi.olehUserId, kunci);
        if (lama) return { ok: true, id: lama, ulang: true };
      }
      if (!(await akunBisaDiposting(tx, t.baris.map((b) => b.akunId)))) throw new Tolak("NON_POSTABLE_ACCOUNT");
      const data = dataTemplat(t);
      const r = await tx.recurringJournal.create({
        data: { ...data, active: false, createdById: isi.olehUserId, lines: { create: dataBaris(t) } },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_BERULANG.DIBUAT,
          entityType: ENTITAS_BERULANG,
          entityId: r.id,
          changes: { after: ringkasIsi({ ...data, name: t.nama }, t.total, t.baris.length) },
          metadata: kunci ? { kunci } : undefined,
        },
      });
      return { ok: true, id: r.id };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok && !hasil.ulang) await kabariTemplatMenunggu(hasil.id, t.nama, true);
  return hasil;
}

/** Mengubah isi templat. Templat kembali nonaktif sampai disetujui orang lain. Jurnal yang sudah diposting tidak berubah. */
export async function ubahTemplat(isi: IsianTemplat & { id: string; olehUserId: string }): Promise<HasilTemplat> {
  const p = periksaTemplat(isi);
  if (!p.ok) return p;
  const t = p.templat;
  let hasil: HasilTemplat;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilTemplat> => {
      const lama = await tx.recurringJournal.findUnique({
        where: { id: isi.id },
        select: { id: true, name: true, dayOfMonth: true, startDate: true, endDate: true, autoReverse: true, active: true, lines: { select: { debit: true } } },
      });
      if (!lama) throw new Tolak("TIDAK_DITEMUKAN");
      if (!(await akunBisaDiposting(tx, t.baris.map((b) => b.akunId)))) throw new Tolak("NON_POSTABLE_ACCOUNT");
      const data = dataTemplat(t);
      await tx.recurringJournalLine.deleteMany({ where: { recurringJournalId: lama.id } });
      await tx.recurringJournal.update({ where: { id: lama.id }, data: { ...data, active: false, lines: { create: dataBaris(t) } } });
      const totalLama = lama.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0) / 100;
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_BERULANG.DIUBAH,
          entityType: ENTITAS_BERULANG,
          entityId: lama.id,
          changes: {
            before: { ...ringkasIsi(lama, totalLama, lama.lines.length), aktif: lama.active },
            after: { ...ringkasIsi({ ...data, name: t.nama }, t.total, t.baris.length), aktif: false },
          },
        },
      });
      return { ok: true, id: lama.id };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok) await kabariTemplatMenunggu(hasil.id, t.nama, false);
  return hasil;
}

/**
 * Mengaktifkan templat: menyetujui isinya (penyetuju ≠ pengubah isi terakhir)
 * atau melanjutkan templat yang dihentikan tanpa perubahan isi sejak disetujui.
 */
export async function aktifkanTemplat(isi: { id: string; olehUserId: string }): Promise<HasilTemplat & { disetujui?: boolean }> {
  try {
    const hasil = await runSerializable(async (tx) => {
      const t = await tx.recurringJournal.findUnique({ where: { id: isi.id }, select: { id: true, active: true, lines: { select: { chartAccountId: true } } } });
      if (!t) throw new Tolak("TIDAK_DITEMUKAN");
      if (t.active) throw new Tolak("SUDAH_AKTIF");
      const s = (await persetujuanTemplat(tx, [t.id])).get(t.id)!;
      const lanjut = s.disetujuiOleh != null;
      if (!lanjut && s.pengubahTerakhir === isi.olehUserId) throw new Tolak("PEMBUAT_SAMA");
      if (!(await akunBisaDiposting(tx, t.lines.map((l) => l.chartAccountId)))) throw new Tolak("NON_POSTABLE_ACCOUNT");
      const u = await tx.recurringJournal.updateMany({ where: { id: t.id, active: false }, data: { active: true } });
      if (u.count !== 1) throw new Tolak("SUDAH_AKTIF");
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: lanjut ? JEJAK_BERULANG.DILANJUTKAN : JEJAK_BERULANG.DISETUJUI,
          entityType: ENTITAS_BERULANG,
          entityId: t.id,
          changes: { before: { aktif: false }, after: { aktif: true } },
          metadata: { pengubahTerakhir: s.pengubahTerakhir },
        },
      });
      return { ok: true as const, id: t.id, disetujui: !lanjut };
    });
    await selesaikanNotifikasiTemplat(hasil.id);
    return hasil;
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}

export async function hentikanTemplat(isi: { id: string; olehUserId: string }): Promise<HasilTemplat> {
  try {
    return await runSerializable(async (tx): Promise<HasilTemplat> => {
      const t = await tx.recurringJournal.findUnique({ where: { id: isi.id }, select: { id: true, active: true } });
      if (!t) throw new Tolak("TIDAK_DITEMUKAN");
      if (!t.active) throw new Tolak("BUKAN_AKTIF");
      await tx.recurringJournal.updateMany({ where: { id: t.id, active: true }, data: { active: false } });
      await tx.auditLog.create({
        data: { userId: isi.olehUserId, action: JEJAK_BERULANG.DIHENTIKAN, entityType: ENTITAS_BERULANG, entityId: t.id, changes: { before: { aktif: true }, after: { aktif: false } } },
      });
      return { ok: true, id: t.id };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}

/** Menghapus templat yang BELUM pernah diposting. Yang sudah pernah diposting hanya bisa dihentikan. */
export async function hapusTemplat(isi: { id: string; olehUserId: string }): Promise<HasilTemplat> {
  try {
    const hasil = await runSerializable(async (tx): Promise<HasilTemplat> => {
      const t = await tx.recurringJournal.findUnique({ where: { id: isi.id }, select: { id: true, name: true } });
      if (!t) throw new Tolak("TIDAK_DITEMUKAN");
      const pernah = await tx.journal.count({ where: { sourceType: SUMBER_BERULANG.POSTING, sourceId: { startsWith: `${t.id}/` } } });
      if (pernah > 0) throw new Tolak("SUDAH_DIPOSTING");
      await tx.recurringJournal.delete({ where: { id: t.id } });
      await tx.auditLog.create({
        data: { userId: isi.olehUserId, action: JEJAK_BERULANG.DIHAPUS, entityType: ENTITAS_BERULANG, entityId: t.id, changes: { before: { nama: t.name } } },
      });
      return { ok: true, id: t.id };
    });
    if (hasil.ok) await selesaikanNotifikasiTemplat(hasil.id);
    return hasil;
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}

// ─── Posting ────────────────────────────────────────────────────────────────

export type HasilPostingBerulang =
  | { status: "DIPOSTING"; journalId: string; pembalikId: string | null }
  | { status: "SUDAH_ADA"; journalId: string }
  | { status: "DILEWATI" }
  | { status: "NONAKTIF" }
  | { status: "GAGAL"; kodeGalat: "NON_POSTABLE_ACCOUNT" | "ERROR"; pesan?: string };

/** `kind` metadata `JOURNAL_PENDING` jurnal berulang (`lib/finance/jurnal-tertunda.ts`). */
export const JENIS_TERTUNDA_BERULANG = "jurnal_berulang";

/** Jurnal satu templat satu bulan (+ pembalik akrualnya), transaksinya sendiri. Tidak melempar untuk kegagalan biasa. */
export async function postingBerulangSatu(templatId: string, tb: TahunBulan, olehCadangan: string): Promise<HasilPostingBerulang> {
  const periode = kunciBulan(tb);
  const sumberId = idSumberBerulang(templatId, periode);
  try {
    return await runSerializable(async (tx): Promise<HasilPostingBerulang> => {
      const t = await tx.recurringJournal.findUnique({
        where: { id: templatId },
        select: {
          id: true,
          name: true,
          active: true,
          dayOfMonth: true,
          autoReverse: true,
          createdById: true,
          lastRunPeriod: true,
          lines: { orderBy: { sortOrder: "asc" }, select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true, storeId: true } },
        },
      });
      if (!t || !t.active) return { status: "NONAKTIF" };
      const ada = await tx.journal.findUnique({ where: { sourceType_sourceId: { sourceType: SUMBER_BERULANG.POSTING, sourceId: sumberId } }, select: { id: true } });
      if (ada) return { status: "SUDAH_ADA", journalId: ada.id };

      const tanggal = parseDateOnly(tanggalPostingBulan(tb, t.dayOfMonth)) as Date;
      if ((await lockPeriodForPosting(tx, tanggal)) === "CLOSED") {
        const sudahDicatat = (
          await tx.auditLog.findMany({ where: { action: JEJAK_BERULANG.DILEWATI, entityType: ENTITAS_BERULANG, entityId: t.id }, select: { metadata: true } })
        ).some((j) => bacaMeta(j.metadata)?.periode === periode);
        if (!sudahDicatat) {
          await tx.auditLog.create({
            data: {
              userId: t.createdById,
              action: JEJAK_BERULANG.DILEWATI,
              entityType: ENTITAS_BERULANG,
              entityId: t.id,
              metadata: { periode },
              reason: `Bulan ${labelBulan(tb)} sudah ditutup — jurnal bulan ini tidak diposting.`,
            },
          });
        }
        return { status: "DILEWATI" };
      }

      const s = (await persetujuanTemplat(tx, [t.id])).get(t.id)!;
      const pembuat = t.createdById || olehCadangan;
      const baris = t.lines.map((l) => ({
        chartAccountId: l.chartAccountId,
        debit: Number(l.debit),
        credit: Number(l.credit),
        ...(l.memo ? { memo: l.memo } : {}),
        ...(l.channel ? { channel: l.channel } : {}),
        ...(l.storeId ? { storeId: l.storeId } : {}),
      }));
      const r = await postJournal(tx, {
        source: { type: SUMBER_BERULANG.POSTING, id: sumberId },
        date: tanggal,
        description: `${t.name} — ${labelBulan(tb)}`.slice(0, 191),
        postedById: pembuat,
        closedPeriod: "refuse",
        lines: baris,
      });
      let pembalikId: string | null = null;
      if (t.autoReverse) {
        const b = await postJournal(tx, {
          source: { type: SUMBER_BERULANG.BALIK, id: sumberId },
          date: parseDateOnly(tanggalBalikBulan(tb)) as Date,
          description: `Pembalik akrual: ${t.name} — ${labelBulan(tb)}`.slice(0, 191),
          postedById: pembuat,
          closedPeriod: "refuse",
          reversalOfId: r.journalId,
          lines: baris.map((l) => ({ ...l, debit: l.credit, credit: l.debit })),
        });
        pembalikId = b.journalId;
      }
      if (s.disetujuiOleh) {
        await tx.journal.updateMany({
          where: { id: { in: [r.journalId, ...(pembalikId ? [pembalikId] : [])] } },
          data: { approvedById: s.disetujuiOleh, approvedAt: s.disetujuiPada ?? new Date() },
        });
      }
      if (!t.lastRunPeriod || t.lastRunPeriod < periode) await tx.recurringJournal.update({ where: { id: t.id }, data: { lastRunPeriod: periode } });
      return { status: "DIPOSTING", journalId: r.journalId, pembalikId };
    });
  } catch (e) {
    if (e instanceof JournalError) {
      if (e.code === "PERIOD_CLOSED") return { status: "DILEWATI" };
      if (e.code === "NON_POSTABLE_ACCOUNT") return { status: "GAGAL", kodeGalat: "NON_POSTABLE_ACCOUNT" };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const ada = await prisma.journal.findUnique({ where: { sourceType_sourceId: { sourceType: SUMBER_BERULANG.POSTING, sourceId: sumberId } }, select: { id: true } });
      if (ada) return { status: "SUDAH_ADA", journalId: ada.id };
    }
    console.error(`[jurnal-berulang] ${sumberId} gagal`, e);
    return { status: "GAGAL", kodeGalat: "ERROR", pesan: e instanceof Error ? e.message : String(e) };
  }
}

export async function catatBerulangTertunda(g: { templatId: string; nama: string; periode: string; kodeGalat: string; pesan?: string }): Promise<void> {
  await catatGagalSapuan({
    metadata: { docId: idSumberBerulang(g.templatId, g.periode), kind: JENIS_TERTUNDA_BERULANG, reason: g.kodeGalat, role: null, docNo: `${g.nama} · ${g.periode}` },
    judul: `Jurnal berulang "${g.nama}" ${g.periode} belum diposting`,
    pesan:
      `Jurnal berulang "${g.nama}" bulan ${g.periode} gagal diposting (${g.kodeGalat}${g.pesan ? `: ${g.pesan}` : ""}). ` +
      "Periksa akun di templatnya (akun nonaktif atau punya turunan), simpan, minta persetujuan, lalu tekan Posting sekarang di Keuangan → Jurnal berulang.",
  });
}

export type RingkasanBerulang = {
  diposting: number;
  dibalik: number;
  dilewati: Array<{ templatId: string; periode: string }>;
  gagal: Array<{ templatId: string; nama: string; periode: string; kodeGalat: string }>;
};

/**
 * Memposting setiap bulan jatuh tempo templat AKTIF (atau `templatIds`) yang
 * belum berjurnal, sampai hari ini (WIB). Bulan sebelum tanggal mulai buku
 * besar tidak diposting.
 */
export async function jalankanJurnalBerulang(isi: {
  sekarang?: Date;
  olehUserId: string;
  templatIds?: readonly string[];
  /** Tes: lantai tanggal mulai buku besar tanpa membaca pengaturan. */
  tanggalMulai?: Date | null;
}): Promise<RingkasanBerulang> {
  const hariIni = hariIniWib(isi.sekarang ?? new Date());
  const mulai = isi.tanggalMulai !== undefined ? isi.tanggalMulai : await readGlCutover();
  const lantai = mulai ? bulanWib(mulai) : null;
  const ringkas: RingkasanBerulang = { diposting: 0, dibalik: 0, dilewati: [], gagal: [] };
  const templat = await prisma.recurringJournal.findMany({
    where: { active: true, ...(isi.templatIds ? { id: { in: [...isi.templatIds] } } : {}) },
    select: { id: true, name: true, dayOfMonth: true, startDate: true, endDate: true },
  });
  const selesai: string[] = [];
  for (const t of templat) {
    const jatuh = periodeJatuhTempo(
      { hari: t.dayOfMonth, mulai: formatDateOnlyJakarta(t.startDate), selesai: t.endDate ? formatDateOnlyJakarta(t.endDate) : null },
      hariIni,
      lantai,
    );
    if (!jatuh.length) continue;
    const sumberIds = jatuh.map((tb) => idSumberBerulang(t.id, kunciBulan(tb)));
    const sudah = new Set(
      (await prisma.journal.findMany({ where: { sourceType: SUMBER_BERULANG.POSTING, sourceId: { in: sumberIds } }, select: { sourceId: true } })).map((j) => j.sourceId),
    );
    for (const tb of jatuh) {
      const sid = idSumberBerulang(t.id, kunciBulan(tb));
      if (sudah.has(sid)) continue;
      const h = await postingBerulangSatu(t.id, tb, isi.olehUserId);
      if (h.status === "DIPOSTING") {
        ringkas.diposting += 1;
        if (h.pembalikId) ringkas.dibalik += 1;
        selesai.push(sid);
      } else if (h.status === "DILEWATI") {
        ringkas.dilewati.push({ templatId: t.id, periode: kunciBulan(tb) });
      } else if (h.status === "GAGAL") {
        ringkas.gagal.push({ templatId: t.id, nama: t.name, periode: kunciBulan(tb), kodeGalat: h.kodeGalat });
        await catatBerulangTertunda({ templatId: t.id, nama: t.name, periode: kunciBulan(tb), kodeGalat: h.kodeGalat, pesan: h.pesan });
        break;
      }
    }
  }
  if (selesai.length) await tandaiJurnalTertundaSelesai(selesai.map((id) => dokumenJurnal(SUMBER_BERULANG.POSTING, id)));
  return ringkas;
}

/** Cron harian: posting semua templat aktif yang jatuh tempo, atas nama admin pertama. */
export async function jalankanJurnalBerulangTerjadwal(sekarang: Date = new Date()): Promise<RingkasanBerulang | null> {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (!admin) return null;
  return jalankanJurnalBerulang({ sekarang, olehUserId: admin.id });
}
