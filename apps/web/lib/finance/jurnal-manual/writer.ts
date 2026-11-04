import { JournalError, lockPeriodForPosting, postJournal, prisma, Prisma, type AdminNotification } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { bacaTanggal } from "@/lib/tanggal-isian";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { periksaBarisJurnal, type BarisJurnalBersih, type IsianBarisJurnal } from "@/lib/finance/berulang/aturan";
import { STATUS_JURNAL } from "@/lib/finance/journals/status-jurnal";
import { formatRupiah } from "@/lib/format/rupiah";
import { alasanJurnalCukup, barisPembalik, jenisBolehDibalik, type KodeGalatJurnalManual } from "./aturan";
import { ENTITAS_JURNAL, JEJAK_JURNAL_MANUAL } from "./jejak";

/*
 * Penulis jurnal manual ber-persetujuan (maker-checker) dan pembalikannya —
 * KHUSUS SERVER. Aturan lengkapnya di `./aturan.ts`.
 *
 * Setiap perubahan status berjalan di `runSerializable` dengan pemeriksaan
 * status DI DALAM transaksi (Prisma `updateMany` bukan compare-and-swap; di
 * bawah SERIALIZABLE, dua penyetuju yang balapan membuat salah satunya gagal
 * serialisasi lalu diulang dan membaca status barunya). Jejak `AuditLog`
 * ditulis di transaksi yang sama.
 *
 * Keterangan jurnal dibatasi 191 karakter: `Journal.description` adalah
 * VARCHAR(191) di MariaDB (produksi).
 */

export type HasilJurnalManual =
  | { ok: true; journalId: string; ulang?: boolean }
  | { ok: false; kode: KodeGalatJurnalManual; baris?: number };

export const PANJANG_KETERANGAN_MAKS = 191;

/** Kategori notifikasi kantor "jurnal manual menunggu persetujuan". */
export const KATEGORI_PERSETUJUAN_JURNAL = "JOURNAL_APPROVAL";

class Tolak extends Error {
  constructor(
    public kode: KodeGalatJurnalManual,
    public baris?: number,
  ) {
    super(kode);
  }
}

function petakanGalat(e: unknown): HasilJurnalManual | null {
  if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.baris ? { baris: e.baris } : {}) };
  if (e instanceof JournalError) {
    const peta: Record<JournalError["code"], KodeGalatJurnalManual> = {
      UNBALANCED: "TIDAK_SEIMBANG",
      TOO_FEW_LINES: "BARIS_KURANG",
      BAD_LINE: "BARIS_TIDAK_SAH",
      NON_POSTABLE_ACCOUNT: "NON_POSTABLE_ACCOUNT",
      PERIOD_CLOSED: "PERIOD_CLOSED",
    };
    return { ok: false, kode: peta[e.code] };
  }
  return null;
}

function potong(teks: string): string {
  return teks.length > PANJANG_KETERANGAN_MAKS ? `${teks.slice(0, PANJANG_KETERANGAN_MAKS - 1)}…` : teks;
}

/** Semua akun ada, aktif, dan tidak punya turunan — sama dengan pemeriksaan `postJournal`. */
export async function akunBisaDiposting(tx: Prisma.TransactionClient, ids: string[]): Promise<boolean> {
  const unik = [...new Set(ids)];
  if (unik.length === 0) return false;
  const akun = await tx.chartAccount.findMany({
    where: { id: { in: unik } },
    select: { id: true, isActive: true, _count: { select: { children: true } } },
  });
  return akun.length === unik.length && akun.every((a) => a.isActive && a._count.children === 0);
}

function barisPosting(baris: BarisJurnalBersih[]) {
  return baris.map((b) => ({
    chartAccountId: b.akunId,
    debit: b.debit,
    credit: b.kredit,
    ...(b.memo ? { memo: b.memo } : {}),
    ...(b.kanal ? { channel: b.kanal } : {}),
  }));
}

function periksaKepala(isi: { tanggal: string; keterangan: string }): { tanggal: Date; keterangan: string } {
  if (!bacaTanggal(isi.tanggal)) throw new Tolak("TANGGAL_TIDAK_SAH");
  const keterangan = (isi.keterangan ?? "").trim();
  if (!keterangan) throw new Tolak("KETERANGAN_WAJIB");
  if (keterangan.length > PANJANG_KETERANGAN_MAKS) throw new Tolak("TEKS_TERLALU_PANJANG");
  return { tanggal: parseDateOnly(isi.tanggal) as Date, keterangan };
}

function periksaBaris(baris: IsianBarisJurnal[]): { baris: BarisJurnalBersih[]; total: number } {
  const b = periksaBarisJurnal(baris ?? []);
  if (!b.ok) throw new Tolak(b.kode, b.baris);
  return { baris: b.baris, total: b.total };
}

// ─── Notifikasi persetujuan ─────────────────────────────────────────────────

/** Notifikasi kantor ke pemegang `journals:manage`. Tidak pernah melempar; dipanggil SESUDAH commit. */
async function kabariPersetujuan(journalId: string, judul: string, pesan: string): Promise<void> {
  let baris: AdminNotification | null = null;
  try {
    baris = await prisma.adminNotification.create({
      data: { category: KATEGORI_PERSETUJUAN_JURNAL, severity: "INFO", title: judul, message: pesan, metadata: { journalId } },
    });
  } catch (e) {
    console.error("[jurnal-manual] gagal menulis notifikasi persetujuan", journalId, e);
  }
  if (baris) void fanOutAdminNotification(baris);
}

function idJurnalDari(metadata: unknown): string | null {
  let m = metadata;
  if (typeof m === "string") {
    try {
      m = JSON.parse(m);
    } catch {
      return null;
    }
  }
  if (m == null || typeof m !== "object" || Array.isArray(m)) return null;
  const v = (m as Record<string, unknown>).journalId;
  return typeof v === "string" ? v : null;
}

/** Notifikasi persetujuan jurnal yang sudah diputuskan ditandai selesai. Tidak pernah melempar. */
async function selesaikanNotifikasiPersetujuan(journalId: string): Promise<void> {
  try {
    const belum = await prisma.adminNotification.findMany({
      where: { category: KATEGORI_PERSETUJUAN_JURNAL, readAt: null },
      select: { id: true, metadata: true },
    });
    const ids = belum.filter((n) => idJurnalDari(n.metadata) === journalId).map((n) => n.id);
    if (ids.length) await prisma.adminNotification.updateMany({ where: { id: { in: ids }, readAt: null }, data: { readAt: new Date() } });
  } catch (e) {
    console.error("[jurnal-manual] gagal menandai notifikasi persetujuan selesai", journalId, e);
  }
}

// ─── Pengajuan ──────────────────────────────────────────────────────────────

/** Pengajuan yang sudah tercatat dengan kunci idempoten ini (dicocokkan di JS — JSON-path tidak andal di MariaDB). */
async function pengajuanDenganKunci(client: Prisma.TransactionClient | typeof prisma, olehUserId: string, kunci: string): Promise<string | null> {
  const baris = await client.auditLog.findMany({
    where: {
      action: JEJAK_JURNAL_MANUAL.DIAJUKAN,
      userId: olehUserId,
      createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
    },
    select: { entityId: true, metadata: true },
  });
  for (const b of baris) {
    let m: unknown = b.metadata;
    if (typeof m === "string") {
      try {
        m = JSON.parse(m);
      } catch {
        continue;
      }
    }
    if (m && typeof m === "object" && (m as Record<string, unknown>).kunci === kunci) return b.entityId;
  }
  return null;
}

/**
 * Mengajukan jurnal manual sebagai DRAF yang menunggu persetujuan orang lain.
 * Bulan yang sudah ditutup ditolak (`PERIOD_CLOSED`). `idempotencyKey` (sekali
 * per isian formulir) membuat kiriman ulang mengembalikan draf yang sama.
 */
export async function ajukanJurnalManual(isi: {
  tanggal: string;
  keterangan: string;
  baris: IsianBarisJurnal[];
  olehUserId: string;
  idempotencyKey?: string | null;
}): Promise<HasilJurnalManual> {
  let kepala: { tanggal: Date; keterangan: string };
  let rinci: { baris: BarisJurnalBersih[]; total: number };
  try {
    kepala = periksaKepala(isi);
    rinci = periksaBaris(isi.baris);
  } catch (e) {
    return petakanGalat(e) ?? { ok: false, kode: "GAGAL" };
  }
  const kunci = typeof isi.idempotencyKey === "string" && isi.idempotencyKey.trim() ? isi.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await pengajuanDenganKunci(prisma, isi.olehUserId, kunci);
    if (lama) return { ok: true, journalId: lama, ulang: true };
  }

  let hasil: HasilJurnalManual;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilJurnalManual> => {
      if (kunci) {
        const lama = await pengajuanDenganKunci(tx, isi.olehUserId, kunci);
        if (lama) return { ok: true, journalId: lama, ulang: true };
      }
      const r = await postJournal(tx, {
        date: kepala.tanggal,
        description: kepala.keterangan,
        postedById: isi.olehUserId,
        isManual: true,
        status: STATUS_JURNAL.DRAFT,
        lines: barisPosting(rinci.baris),
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_JURNAL_MANUAL.DIAJUKAN,
          entityType: ENTITAS_JURNAL,
          entityId: r.journalId,
          changes: { after: { status: STATUS_JURNAL.DRAFT, tanggal: isi.tanggal, keterangan: kepala.keterangan, total: rinci.total, baris: rinci.baris.length } },
          metadata: { ...(kunci ? { kunci } : {}), total: rinci.total },
        },
      });
      return { ok: true, journalId: r.journalId };
    });
  } catch (e) {
    const g = petakanGalat(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok && !hasil.ulang) {
    await kabariPersetujuan(
      hasil.journalId,
      "Jurnal manual menunggu persetujuan",
      `${kepala.keterangan} — ${formatRupiah(rinci.total)}, tanggal ${isi.tanggal}. Jurnal ini baru masuk buku besar sesudah disetujui orang lain selain pembuatnya.`,
    );
  }
  return hasil;
}

// ─── Perubahan draf ─────────────────────────────────────────────────────────

/** Hanya pembuatnya yang mengubah drafnya; draf pembalik tidak bisa diubah. */
export async function ubahDrafJurnal(isi: {
  id: string;
  tanggal: string;
  keterangan: string;
  baris: IsianBarisJurnal[];
  olehUserId: string;
}): Promise<HasilJurnalManual> {
  try {
    const kepala = periksaKepala(isi);
    const rinci = periksaBaris(isi.baris);
    return await runSerializable(async (tx): Promise<HasilJurnalManual> => {
      const j = await tx.journal.findUnique({
        where: { id: isi.id },
        select: {
          id: true,
          status: true,
          isManual: true,
          postedById: true,
          reversalOfId: true,
          date: true,
          description: true,
          lines: { select: { debit: true } },
        },
      });
      if (!j) throw new Tolak("TIDAK_DITEMUKAN");
      if (!j.isManual) throw new Tolak("BUKAN_JURNAL_MANUAL");
      if (j.status !== STATUS_JURNAL.DRAFT) throw new Tolak("BUKAN_DRAF");
      if (j.postedById !== isi.olehUserId) throw new Tolak("HANYA_PEMBUAT");
      if (j.reversalOfId) throw new Tolak("PEMBALIK_TIDAK_BISA_DIUBAH");
      if (!(await akunBisaDiposting(tx, rinci.baris.map((b) => b.akunId)))) throw new Tolak("NON_POSTABLE_ACCOUNT");
      if ((await lockPeriodForPosting(tx, kepala.tanggal)) === "CLOSED") throw new Tolak("PERIOD_CLOSED");

      const totalLama = j.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0) / 100;
      await tx.journalLine.deleteMany({ where: { journalId: j.id } });
      await tx.journal.update({
        where: { id: j.id },
        data: {
          date: kepala.tanggal,
          description: kepala.keterangan,
          lines: {
            create: rinci.baris.map((b) => ({
              chartAccountId: b.akunId,
              debit: b.debit,
              credit: b.kredit,
              memo: b.memo,
              ...(b.kanal ? { channel: b.kanal } : {}),
            })),
          },
        },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_JURNAL_MANUAL.DRAF_DIUBAH,
          entityType: ENTITAS_JURNAL,
          entityId: j.id,
          changes: {
            before: { tanggal: formatDateOnlyJakarta(j.date), keterangan: j.description, total: totalLama },
            after: { tanggal: isi.tanggal, keterangan: kepala.keterangan, total: rinci.total },
          },
        },
      });
      return { ok: true, journalId: j.id };
    });
  } catch (e) {
    const g = petakanGalat(e);
    if (g) return g;
    throw e;
  }
}

// ─── Persetujuan ────────────────────────────────────────────────────────────

/**
 * Menyetujui draf: penyetuju BUKAN pembuatnya, akun masih bisa diposting,
 * bulannya masih terbuka (dikunci untuk transaksi ini), dan — untuk draf
 * pembalik — jurnal aslinya masih berlaku.
 */
export async function setujuiJurnal(isi: { id: string; olehUserId: string; sekarang?: Date }): Promise<HasilJurnalManual> {
  let hasil: HasilJurnalManual;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilJurnalManual> => {
      const j = await tx.journal.findUnique({
        where: { id: isi.id },
        select: {
          id: true,
          status: true,
          isManual: true,
          postedById: true,
          date: true,
          reversalOfId: true,
          lines: { select: { chartAccountId: true, debit: true, credit: true } },
        },
      });
      if (!j) throw new Tolak("TIDAK_DITEMUKAN");
      if (!j.isManual) throw new Tolak("BUKAN_JURNAL_MANUAL");
      if (j.status !== STATUS_JURNAL.DRAFT) throw new Tolak("BUKAN_DRAF");
      if (j.postedById === isi.olehUserId) throw new Tolak("PEMBUAT_SAMA");
      if (j.reversalOfId) {
        const asli = await tx.journal.findUnique({ where: { id: j.reversalOfId }, select: { status: true } });
        if (!asli || asli.status !== STATUS_JURNAL.POSTED) throw new Tolak("ASLI_TIDAK_BERLAKU");
      }
      const dr = j.lines.reduce((s, l) => s + Math.round(Number(l.debit) * 100), 0);
      const cr = j.lines.reduce((s, l) => s + Math.round(Number(l.credit) * 100), 0);
      if (j.lines.length < 2) throw new Tolak("BARIS_KURANG");
      if (dr !== cr) throw new Tolak("TIDAK_SEIMBANG");
      if (!(await akunBisaDiposting(tx, j.lines.map((l) => l.chartAccountId)))) throw new Tolak("NON_POSTABLE_ACCOUNT");
      if ((await lockPeriodForPosting(tx, j.date)) === "CLOSED") throw new Tolak("PERIOD_CLOSED");

      const u = await tx.journal.updateMany({
        where: { id: j.id, status: STATUS_JURNAL.DRAFT },
        data: { status: STATUS_JURNAL.POSTED, approvedById: isi.olehUserId, approvedAt: isi.sekarang ?? new Date() },
      });
      if (u.count !== 1) throw new Tolak("BUKAN_DRAF");
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_JURNAL_MANUAL.DISETUJUI,
          entityType: ENTITAS_JURNAL,
          entityId: j.id,
          changes: { before: { status: STATUS_JURNAL.DRAFT }, after: { status: STATUS_JURNAL.POSTED } },
          metadata: { pembuatId: j.postedById, total: dr / 100, ...(j.reversalOfId ? { pembalikDari: j.reversalOfId } : {}) },
        },
      });
      return { ok: true, journalId: j.id };
    });
  } catch (e) {
    const g = petakanGalat(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok) await selesaikanNotifikasiPersetujuan(hasil.journalId);
  return hasil;
}

/**
 * Menolak (orang lain) atau menarik (pembuatnya) draf. Alasan wajib. Draf
 * pembalik yang ditolak melepas `reversalOfId`-nya supaya jurnal aslinya bisa
 * diajukan pembalikannya lagi; tautannya tetap tercatat di jejak.
 */
export async function tolakJurnal(isi: { id: string; alasan: string; olehUserId: string; sekarang?: Date }): Promise<HasilJurnalManual> {
  if (!alasanJurnalCukup(isi.alasan)) return { ok: false, kode: "ALASAN_WAJIB" };
  const alasan = isi.alasan.trim().slice(0, 2000);
  let hasil: HasilJurnalManual;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilJurnalManual> => {
      const j = await tx.journal.findUnique({
        where: { id: isi.id },
        select: { id: true, status: true, isManual: true, postedById: true, reversalOfId: true },
      });
      if (!j) throw new Tolak("TIDAK_DITEMUKAN");
      if (!j.isManual) throw new Tolak("BUKAN_JURNAL_MANUAL");
      if (j.status !== STATUS_JURNAL.DRAFT) throw new Tolak("BUKAN_DRAF");
      const tarik = j.postedById === isi.olehUserId;
      const u = await tx.journal.updateMany({
        where: { id: j.id, status: STATUS_JURNAL.DRAFT },
        data: {
          status: STATUS_JURNAL.REJECTED,
          rejectedById: isi.olehUserId,
          rejectedAt: isi.sekarang ?? new Date(),
          rejectReason: alasan,
          ...(j.reversalOfId ? { reversalOfId: null } : {}),
        },
      });
      if (u.count !== 1) throw new Tolak("BUKAN_DRAF");
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: tarik ? JEJAK_JURNAL_MANUAL.DITARIK : JEJAK_JURNAL_MANUAL.DITOLAK,
          entityType: ENTITAS_JURNAL,
          entityId: j.id,
          changes: { before: { status: STATUS_JURNAL.DRAFT }, after: { status: STATUS_JURNAL.REJECTED } },
          metadata: { pembuatId: j.postedById, ...(j.reversalOfId ? { pembalikDari: j.reversalOfId } : {}) },
          reason: alasan,
        },
      });
      return { ok: true, journalId: j.id };
    });
  } catch (e) {
    const g = petakanGalat(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok) await selesaikanNotifikasiPersetujuan(hasil.journalId);
  return hasil;
}

// ─── Pembalikan ─────────────────────────────────────────────────────────────

/**
 * Mengajukan pembalik jurnal manual (atau jurnal berulang) yang sudah POSTED:
 * draf baris cermin bertanggal `tanggal` (tidak sebelum tanggal aslinya),
 * `reversalOfId` = jurnal aslinya, lewat persetujuan orang lain. Jurnal asli
 * tidak pernah diubah atau dihapus.
 */
export async function ajukanPembalik(isi: { id: string; tanggal: string; alasan: string; olehUserId: string }): Promise<HasilJurnalManual> {
  if (!alasanJurnalCukup(isi.alasan)) return { ok: false, kode: "ALASAN_WAJIB" };
  if (!bacaTanggal(isi.tanggal)) return { ok: false, kode: "TANGGAL_TIDAK_SAH" };
  const alasan = isi.alasan.trim().slice(0, 2000);
  let hasil: HasilJurnalManual & { keterangan?: string; total?: number };
  try {
    hasil = await runSerializable(async (tx) => {
      const asli = await tx.journal.findUnique({
        where: { id: isi.id },
        select: {
          id: true,
          status: true,
          isManual: true,
          sourceType: true,
          date: true,
          description: true,
          lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true, storeId: true } },
        },
      });
      if (!asli) throw new Tolak("TIDAK_DITEMUKAN");
      if (asli.status !== STATUS_JURNAL.POSTED || !jenisBolehDibalik(asli)) throw new Tolak("TIDAK_BISA_DIBALIK");
      const ada = await tx.journal.findFirst({ where: { reversalOfId: asli.id }, select: { status: true } });
      if (ada) throw new Tolak(ada.status === STATUS_JURNAL.DRAFT ? "PEMBALIK_MENUNGGU" : "SUDAH_DIBALIK");
      if (isi.tanggal < formatDateOnlyJakarta(asli.date)) throw new Tolak("TANGGAL_SEBELUM_ASLI");

      const baris = barisPembalik(
        asli.lines.map((l) => ({
          chartAccountId: l.chartAccountId,
          debit: Number(l.debit),
          credit: Number(l.credit),
          memo: l.memo,
          channel: l.channel,
          storeId: l.storeId,
        })),
      );
      const keterangan = potong(`Pembalik: ${asli.description}`);
      const r = await postJournal(tx, {
        date: parseDateOnly(isi.tanggal) as Date,
        description: keterangan,
        postedById: isi.olehUserId,
        isManual: true,
        status: STATUS_JURNAL.DRAFT,
        reversalOfId: asli.id,
        lines: baris.map((b) => ({
          chartAccountId: b.chartAccountId,
          debit: b.debit,
          credit: b.credit,
          ...(b.memo ? { memo: b.memo } : {}),
          ...(b.channel ? { channel: b.channel } : {}),
          ...(b.storeId ? { storeId: b.storeId } : {}),
        })),
      });
      const total = baris.reduce((s, b) => s + Math.round(b.debit * 100), 0) / 100;
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_JURNAL_MANUAL.PEMBALIK_DIAJUKAN,
          entityType: ENTITAS_JURNAL,
          entityId: r.journalId,
          changes: { after: { status: STATUS_JURNAL.DRAFT, tanggal: isi.tanggal, total } },
          metadata: { jurnalAsli: asli.id },
          reason: alasan,
        },
      });
      return { ok: true as const, journalId: r.journalId, keterangan, total };
    });
  } catch (e) {
    // Dua pengajuan pembalik yang balapan: yang kalah membentur `reversalOfId` unik.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, kode: "PEMBALIK_MENUNGGU" };
    const g = petakanGalat(e);
    if (g) return g;
    throw e;
  }
  if (hasil.ok) {
    await kabariPersetujuan(
      hasil.journalId,
      "Pembalik jurnal menunggu persetujuan",
      `${hasil.keterangan ?? "Pembalik jurnal"} — ${formatRupiah(hasil.total ?? 0)}, tanggal ${isi.tanggal}. Alasan: ${alasan}`,
    );
    return { ok: true, journalId: hasil.journalId };
  }
  return hasil;
}
