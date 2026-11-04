import { JournalError, lockPeriodForPosting, postJournal, Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { GL_CUTOVER_SETTING_KEY } from "@/lib/finance/sales/sweep";
import { parseDateOnly } from "@/lib/date-only";
import {
  STATUS_PERIODE,
  SUMBER_TUTUP_TAHUN,
  alasanCukup,
  bulanPenahanTutup,
  bulanPertamaBuku,
  bulanSesudah,
  bulanSudahBerakhir,
  bulanSah,
  bulanWib,
  deretBulan,
  kunciBulan,
  rentangBulan,
  ringkasDaftarPeriksa,
  tahunSah,
  tanggalTutupTahun,
  type DaftarPeriksa,
  type KodeGalatPeriode,
  type TahunBulan,
} from "./periode";
import { bacaDaftarPeriksa } from "./queries";
import { ENTITAS_PERIODE, ENTITAS_TAHUN, JEJAK_PERIODE } from "./jejak";
import {
  balikBaris,
  sumberIdMilikTahun,
  sumberIdPembalik,
  sumberIdPenutup,
  susunJurnalTutupTahun,
  TIPE_LABA_RUGI,
} from "./tutup-tahun-aturan";

/*
 * Penulis tutup buku (bagian A1). Setiap perubahan status berjalan di
 * `runSerializable` dan menulis jejak `AuditLog` DI DALAM transaksi yang sama.
 *
 * Kunci: baris `AccountingPeriod` dikunci LEBIH DULU (`lockPeriodForPosting`,
 * sama dengan yang dipakai `postJournal`), baru diperiksa. Jadi penutupan dan
 * posting jurnal di bulan yang sama tidak pernah tumpang tindih: posting yang
 * mendahului selesai dulu (dan jurnalnya berada di bulan itu sebelum ditutup),
 * posting yang menyusul membaca CLOSED lalu digeser/ditolak.
 */

export type HasilPeriode =
  | { ok: true; journalId?: string | null; labaBersih?: number }
  | { ok: false; kode: KodeGalatPeriode; rincian?: Record<string, unknown> };

class Tolak extends Error {
  constructor(
    public kode: KodeGalatPeriode,
    public rincian?: Record<string, unknown>,
  ) {
    super(kode);
  }
}

async function jalankan(fn: () => Promise<HasilPeriode>): Promise<HasilPeriode> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.rincian ? { rincian: e.rincian } : {}) };
    throw e;
  }
}

async function tanggalMulaiDalam(tx: Prisma.TransactionClient): Promise<Date | null> {
  const row = await tx.systemSetting.findUnique({ where: { key: GL_CUTOVER_SETTING_KEY }, select: { value: true } });
  const v = row?.value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? (parseDateOnly(v) ?? null) : null;
}

async function statusTahun(tx: Prisma.TransactionClient, tahun: number): Promise<string | null> {
  const row = await tx.accountingYear.findUnique({ where: { year: tahun }, select: { status: true } });
  return row?.status ?? null;
}

// ─── Bulan ───────────────────────────────────────────────────────────────────

export async function tutupBulan(isi: {
  tb: TahunBulan;
  olehUserId: string;
  catatan?: string | null;
  setujuPeringatan: boolean;
  sekarang?: Date;
  /** Daftar periksa yang sudah dibaca (tes); bawaan dibaca di sini. */
  daftarPeriksa?: DaftarPeriksa;
}): Promise<HasilPeriode> {
  return jalankan(async () => {
    if (!bulanSah(isi.tb)) throw new Tolak("ISIAN_TIDAK_SAH");
    const sekarang = isi.sekarang ?? new Date();
    if (!bulanSudahBerakhir(isi.tb, sekarang)) throw new Tolak("BULAN_BELUM_BERAKHIR");

    // Daftar periksa dibaca di luar transaksi: kuerinya berat (setiap pencari
    // sapuan). Dokumen yang menyusul sesudahnya tetap aman — jurnalnya digeser
    // ke bulan terbuka oleh `postJournal`.
    const periksa = isi.daftarPeriksa ?? (await bacaDaftarPeriksa(isi.tb));
    if (!periksa.bolehTutup) throw new Tolak("DAFTAR_PERIKSA_GAGAL", { butir: ringkasDaftarPeriksa(periksa) });
    if (periksa.perluPersetujuan && !isi.setujuPeringatan) {
      throw new Tolak("PERINGATAN_BELUM_DISETUJUI", { butir: ringkasDaftarPeriksa(periksa) });
    }

    const { awal, akhir } = rentangBulan(isi.tb);
    const catatan = isi.catatan?.trim() || null;

    await runSerializable(async (tx) => {
      if ((await lockPeriodForPosting(tx, awal)) === STATUS_PERIODE.TERTUTUP) throw new Tolak("SUDAH_DITUTUP");
      if ((await statusTahun(tx, isi.tb.tahun)) === STATUS_PERIODE.TERTUTUP) throw new Tolak("TAHUN_DITUTUP");

      const [mulai, awalJurnal] = await Promise.all([
        tanggalMulaiDalam(tx),
        tx.journal.findFirst({ where: SARING_JURNAL_BERLAKU, orderBy: { date: "asc" }, select: { date: true } }),
      ]);
      const pertama = bulanPertamaBuku(mulai ? bulanWib(mulai) : null, awalJurnal ? bulanWib(awalJurnal.date) : null);
      if (pertama) {
        const tertutup = await tx.accountingPeriod.findMany({
          where: { status: STATUS_PERIODE.TERTUTUP, year: { gte: pertama.tahun, lte: isi.tb.tahun } },
          select: { year: true, month: true },
        });
        const penahan = bulanPenahanTutup(isi.tb, pertama, new Set(tertutup.map((p) => kunciBulan({ tahun: p.year, bulan: p.month }))));
        if (penahan) throw new Tolak("BULAN_SEBELUMNYA_TERBUKA", { bulan: kunciBulan(penahan) });
      }

      // Diperiksa ulang di dalam transaksi: draf yang muncul sesudah daftar periksa dibaca.
      const draf = await tx.journal.count({ where: { status: "DRAFT", date: { gte: awal, lte: akhir } } });
      if (draf > 0) throw new Tolak("DAFTAR_PERIKSA_GAGAL", { butir: { jurnalDraf: draf } });

      const row = await tx.accountingPeriod.update({
        where: { year_month: { year: isi.tb.tahun, month: isi.tb.bulan } },
        data: { status: STATUS_PERIODE.TERTUTUP, closedAt: new Date(), closedById: isi.olehUserId, closeNote: catatan },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_PERIODE.BULAN_DITUTUP,
          entityType: ENTITAS_PERIODE,
          entityId: row.id,
          changes: { before: { status: STATUS_PERIODE.TERBUKA }, after: { status: STATUS_PERIODE.TERTUTUP } },
          metadata: {
            bulan: kunciBulan(isi.tb),
            peringatanDisetujui: periksa.perluPersetujuan ? isi.setujuPeringatan : false,
            daftarPeriksa: periksa.butir.map((b) => ({ kunci: b.kunci, keadaan: b.keadaan, jumlah: b.jumlah })),
          },
          reason: catatan,
        },
      });
    });
    return { ok: true };
  });
}

export async function bukaBulan(isi: { tb: TahunBulan; olehUserId: string; alasan: string }): Promise<HasilPeriode> {
  return jalankan(async () => {
    if (!bulanSah(isi.tb)) throw new Tolak("ISIAN_TIDAK_SAH");
    if (!alasanCukup(isi.alasan)) throw new Tolak("ALASAN_WAJIB");
    const alasan = isi.alasan.trim();
    const { awal } = rentangBulan(isi.tb);

    await runSerializable(async (tx) => {
      if ((await lockPeriodForPosting(tx, awal)) !== STATUS_PERIODE.TERTUTUP) throw new Tolak("SUDAH_TERBUKA");
      if ((await statusTahun(tx, isi.tb.tahun)) === STATUS_PERIODE.TERTUTUP) throw new Tolak("TAHUN_DITUTUP");
      const berikut = bulanSesudah(isi.tb);
      const rowBerikut = await tx.accountingPeriod.findUnique({
        where: { year_month: { year: berikut.tahun, month: berikut.bulan } },
        select: { status: true },
      });
      if (rowBerikut?.status === STATUS_PERIODE.TERTUTUP) throw new Tolak("BULAN_SESUDAHNYA_DITUTUP", { bulan: kunciBulan(berikut) });

      const row = await tx.accountingPeriod.update({
        where: { year_month: { year: isi.tb.tahun, month: isi.tb.bulan } },
        data: { status: STATUS_PERIODE.TERBUKA, reopenedAt: new Date(), reopenedById: isi.olehUserId, reopenReason: alasan },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_PERIODE.BULAN_DIBUKA,
          entityType: ENTITAS_PERIODE,
          entityId: row.id,
          changes: { before: { status: STATUS_PERIODE.TERTUTUP }, after: { status: STATUS_PERIODE.TERBUKA } },
          metadata: { bulan: kunciBulan(isi.tb) },
          reason: alasan,
        },
      });
    });
    return { ok: true };
  });
}

// ─── Tahun ───────────────────────────────────────────────────────────────────

/** Mengunci baris tahun (dibuat bila belum ada) — pola yang sama dengan `lockPeriodForPosting`. */
async function kunciTahun(tx: Prisma.TransactionClient, tahun: number): Promise<{ id: string; status: string; closingJournalId: string | null }> {
  await tx.accountingYear.createMany({ data: [{ year: tahun }], skipDuplicates: true });
  return tx.accountingYear.update({
    where: { year: tahun },
    data: { updatedAt: new Date() },
    select: { id: true, status: true, closingJournalId: true },
  });
}

/** Saldo akun laba rugi satu tahun WIB, tanpa jurnal penutup/pembaliknya. */
async function saldoLabaRugiTahun(tx: Prisma.TransactionClient, tahun: number) {
  const awal = rentangBulan({ tahun, bulan: 1 }).awal;
  const akhir = rentangBulan({ tahun, bulan: 12 }).akhir;
  const grup = await tx.journalLine.groupBy({
    by: ["chartAccountId"],
    _sum: { debit: true, credit: true },
    where: {
      journal: {
        ...SARING_JURNAL_BERLAKU,
        date: { gte: awal, lte: akhir },
        OR: [{ sourceType: null }, { sourceType: { not: SUMBER_TUTUP_TAHUN } }],
      },
    },
  });
  if (grup.length === 0) return [];
  const akun = await tx.chartAccount.findMany({
    where: { id: { in: grup.map((g) => g.chartAccountId) }, type: { in: [...TIPE_LABA_RUGI] } },
    select: { id: true, type: true },
  });
  const tipe = new Map(akun.map((a) => [a.id, a.type as string]));
  return grup
    .filter((g) => tipe.has(g.chartAccountId))
    .map((g) => ({
      accountId: g.chartAccountId,
      type: tipe.get(g.chartAccountId)!,
      debit: Number(g._sum.debit ?? 0),
      credit: Number(g._sum.credit ?? 0),
    }));
}

/**
 * Menutup tahun: kedua belas bulannya sudah ditutup, tahun sebelumnya (bila
 * berisi jurnal) sudah ditutup, lalu jurnal penutup memindah saldo laba rugi
 * tahun itu ke `RETAINED_EARNINGS` per 31 Desember.
 */
export async function tutupTahun(isi: { tahun: number; olehUserId: string; sekarang?: Date }): Promise<HasilPeriode> {
  return jalankan(async () => {
    if (!tahunSah(isi.tahun)) throw new Tolak("ISIAN_TIDAK_SAH");
    if (!bulanSudahBerakhir({ tahun: isi.tahun, bulan: 12 }, isi.sekarang ?? new Date())) throw new Tolak("TAHUN_BELUM_BERAKHIR");

    let akunLabaDitahan: string;
    try {
      akunLabaDitahan = await resolveAccount("RETAINED_EARNINGS");
    } catch (e) {
      if (e instanceof UnmappedRoleError) throw new Tolak("PERAN_BELUM_DIPETAKAN", { peran: "RETAINED_EARNINGS" });
      throw e;
    }

    let hasil: { journalId: string | null; labaBersih: number } = { journalId: null, labaBersih: 0 };
    try {
      hasil = await runSerializable(async (tx) => {
        const row = await kunciTahun(tx, isi.tahun);
        if (row.status === STATUS_PERIODE.TERTUTUP) throw new Tolak("TAHUN_SUDAH_DITUTUP");

        const tertutup = await tx.accountingPeriod.findMany({
          where: { year: isi.tahun, status: STATUS_PERIODE.TERTUTUP },
          select: { month: true },
        });
        const sudah = new Set(tertutup.map((p) => p.month));
        const terbuka = deretBulan({ tahun: isi.tahun, bulan: 1 }, { tahun: isi.tahun, bulan: 12 }).filter((b) => !sudah.has(b.bulan));
        if (terbuka.length > 0) throw new Tolak("ADA_BULAN_TERBUKA", { bulan: terbuka.map(kunciBulan) });

        const lalu = isi.tahun - 1;
        if ((await statusTahun(tx, lalu)) !== STATUS_PERIODE.TERTUTUP) {
          const r = { awal: rentangBulan({ tahun: lalu, bulan: 1 }).awal, akhir: rentangBulan({ tahun: lalu, bulan: 12 }).akhir };
          const adaJurnalLalu = await tx.journal.findFirst({
            where: {
              ...SARING_JURNAL_BERLAKU,
              date: { gte: r.awal, lte: r.akhir },
              OR: [{ sourceType: null }, { sourceType: { not: SUMBER_TUTUP_TAHUN } }],
            },
            select: { id: true },
          });
          if (adaJurnalLalu) throw new Tolak("TAHUN_SEBELUMNYA_TERBUKA", { tahun: lalu });
        }

        const { baris, labaBersih } = susunJurnalTutupTahun(await saldoLabaRugiTahun(tx, isi.tahun), akunLabaDitahan);

        let journalId: string | null = null;
        if (baris.length >= 2) {
          const penutupLama = await tx.journal.findMany({
            where: { sourceType: SUMBER_TUTUP_TAHUN, reversalOfId: null },
            select: { sourceId: true },
          });
          const generasi = penutupLama.filter((j) => sumberIdMilikTahun(j.sourceId, isi.tahun) && !j.sourceId!.endsWith("#balik")).length + 1;
          const res = await postJournal(tx, {
            source: { type: SUMBER_TUTUP_TAHUN, id: sumberIdPenutup(isi.tahun, generasi) },
            date: tanggalTutupTahun(isi.tahun),
            description: `Jurnal penutup tahun ${isi.tahun}: laba rugi ke laba ditahan`,
            postedById: isi.olehUserId,
            closedPeriod: "allow",
            lines: baris,
          });
          journalId = res.journalId;
        }

        await tx.accountingYear.update({
          where: { year: isi.tahun },
          data: { status: STATUS_PERIODE.TERTUTUP, closedAt: new Date(), closedById: isi.olehUserId, closingJournalId: journalId },
        });
        await tx.auditLog.create({
          data: {
            userId: isi.olehUserId,
            action: JEJAK_PERIODE.TAHUN_DITUTUP,
            entityType: ENTITAS_TAHUN,
            entityId: row.id,
            changes: { before: { status: STATUS_PERIODE.TERBUKA }, after: { status: STATUS_PERIODE.TERTUTUP } },
            metadata: { tahun: isi.tahun, journalId, labaBersih },
          },
        });
        return { journalId, labaBersih };
      });
    } catch (e) {
      if (e instanceof JournalError && e.code === "NON_POSTABLE_ACCOUNT") throw new Tolak("AKUN_TIDAK_BISA_DIPOSTING");
      throw e;
    }
    return { ok: true, journalId: hasil.journalId, labaBersih: hasil.labaBersih };
  });
}

/**
 * Membuka kembali tahun: jurnal penutupnya DIBALIK (tidak pernah dihapus),
 * bulan-bulannya tetap tertutup — buka bulan Desember sesudahnya bila perlu
 * mengoreksi.
 */
export async function bukaTahun(isi: { tahun: number; olehUserId: string; alasan: string }): Promise<HasilPeriode> {
  return jalankan(async () => {
    if (!tahunSah(isi.tahun)) throw new Tolak("ISIAN_TIDAK_SAH");
    if (!alasanCukup(isi.alasan)) throw new Tolak("ALASAN_WAJIB");
    const alasan = isi.alasan.trim();

    const journalId = await runSerializable(async (tx) => {
      const row = await kunciTahun(tx, isi.tahun);
      if (row.status !== STATUS_PERIODE.TERTUTUP) throw new Tolak("TAHUN_BELUM_DITUTUP");
      if ((await statusTahun(tx, isi.tahun + 1)) === STATUS_PERIODE.TERTUTUP) {
        throw new Tolak("TAHUN_SESUDAHNYA_DITUTUP", { tahun: isi.tahun + 1 });
      }

      let pembalikId: string | null = null;
      if (row.closingJournalId) {
        const penutup = await tx.journal.findUnique({
          where: { id: row.closingJournalId },
          select: { id: true, sourceId: true, date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
        });
        const sudahDibalik = penutup ? await tx.journal.findUnique({ where: { reversalOfId: penutup.id }, select: { id: true } }) : null;
        if (penutup && !sudahDibalik) {
          const res = await postJournal(tx, {
            source: { type: SUMBER_TUTUP_TAHUN, id: sumberIdPembalik(penutup.sourceId ?? `${isi.tahun}`) },
            reversalOfId: penutup.id,
            date: penutup.date,
            description: `Pembalik jurnal penutup tahun ${isi.tahun} (tahun dibuka kembali)`,
            postedById: isi.olehUserId,
            closedPeriod: "allow",
            lines: balikBaris(
              penutup.lines.map((l) => ({
                chartAccountId: l.chartAccountId,
                debit: Number(l.debit),
                credit: Number(l.credit),
                ...(l.memo ? { memo: l.memo } : {}),
              })),
            ),
          });
          pembalikId = res.journalId;
        }
      }

      await tx.accountingYear.update({
        where: { year: isi.tahun },
        data: { status: STATUS_PERIODE.TERBUKA, reopenedAt: new Date(), reopenedById: isi.olehUserId, reopenReason: alasan, closingJournalId: null },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_PERIODE.TAHUN_DIBUKA,
          entityType: ENTITAS_TAHUN,
          entityId: row.id,
          changes: { before: { status: STATUS_PERIODE.TERTUTUP }, after: { status: STATUS_PERIODE.TERBUKA } },
          metadata: { tahun: isi.tahun, jurnalPenutup: row.closingJournalId, jurnalPembalik: pembalikId },
          reason: alasan,
        },
      });
      return pembalikId;
    });
    return { ok: true, journalId };
  });
}

/** Jumlah bulan tertutup (dipakai penulis tanggal mulai). */
export async function adaPeriodeTertutup(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<boolean> {
  return (await client.accountingPeriod.count({ where: { status: STATUS_PERIODE.TERTUTUP } })) > 0;
}
