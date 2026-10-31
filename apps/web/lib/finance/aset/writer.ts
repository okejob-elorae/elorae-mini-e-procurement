import { JournalError, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { generateDocNumber } from "@/lib/docNumber";
import { formatDateOnlyJakarta, parseDateOnly } from "@/lib/date-only";
import { hariIniWib } from "@/lib/tanggal-isian";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bulanWib, deretBulan, kunciBulan, rentangBulan } from "@/lib/finance/periode/periode";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import type { AccountType } from "@/lib/constants/enums";
import {
  barisPelepasan,
  bacaRupiahSen,
  bulanTerakhirSebelumLepas,
  periksaIsianAset,
  STATUS_ASET,
  SUMBER_ASET,
  idSumberPenyusutan,
  type AsetBersih,
  type IsianAset,
  type KodeGalatIsianAset,
} from "./aturan";
import { ENTITAS_ASET, JEJAK_ASET } from "./jejak";
import { PILIH_ASET_SUSUT, postingPenyusutanDalamTx } from "./penyusutan";

/*
 * Penulis aset tetap (bagian D3) — KHUSUS SERVER. Aset dan jurnalnya
 * (perolehan, pelepasan, pembatalan) adalah dokumen KEUANGAN: ditulis di satu
 * `runSerializable` bersama jejak `AuditLog`-nya. Jurnal yang sudah POSTED
 * tidak pernah diubah atau dihapus — pembatalan memposting pembalik.
 *
 * Jurnal:
 * - perolehan (`FIXED_ASSET`, sourceId = aset): DR akun aset / CR akun lawan;
 * - pelepasan (`ASSET_DISPOSAL`, sourceId = aset, `#n` untuk pelepasan ulang):
 *   DR akumulasi + DR kas/bank (hasil jual) / CR aset, laba (CR) atau rugi (DR)
 *   ke `ASSET_DISPOSAL_GAIN_LOSS`; penyusutan bulan-bulan sebelum bulan
 *   pelepasan yang belum diposting ikut diposting lebih dulu di transaksi yang
 *   sama, supaya nilai bukunya benar;
 * - pembatalan pelepasan (`ASSET_DISPOSAL_REVERSAL`) dan pembatalan aset
 *   (`FIXED_ASSET_REVERSAL`): baris cermin, `reversalOfId`.
 *
 * Akun per aset (aset / akumulasi / beban penyusutan) menimpa peran
 * `FIXED_ASSET` / `ACCUM_DEPRECIATION` / `DEPRECIATION_EXPENSE`.
 */

export type KodeTolakAset =
  | KodeGalatIsianAset
  | "UNMAPPED_ROLE"
  | "NON_POSTABLE_ACCOUNT"
  | "PERIOD_CLOSED"
  | "AKUN_TIDAK_SAH"
  | "PEMASOK_TIDAK_ADA"
  | "TIDAK_DITEMUKAN"
  | "SUDAH_DISUSUTKAN"
  | "ADA_JURNAL_PEROLEHAN"
  | "BUKAN_AKTIF"
  | "BUKAN_DILEPAS"
  | "TANGGAL_LEPAS_TIDAK_SAH"
  | "HASIL_JUAL_TIDAK_SAH"
  | "AKUN_PENERIMAAN_WAJIB"
  | "ALASAN_WAJIB";

export type HasilAset =
  | { ok: true; id: string; kode?: string; journalId?: string | null; ulang?: boolean }
  | { ok: false; kode: KodeTolakAset; peran?: string };

class Tolak extends Error {
  constructor(
    public kode: KodeTolakAset,
    public peran?: string,
  ) {
    super(kode);
  }
}

function petakan(e: unknown): HasilAset | null {
  if (e instanceof Tolak) return { ok: false, kode: e.kode, ...(e.peran ? { peran: e.peran } : {}) };
  if (e instanceof UnmappedRoleError) return { ok: false, kode: "UNMAPPED_ROLE", peran: e.role };
  if (e instanceof JournalError) {
    if (e.code === "PERIOD_CLOSED") return { ok: false, kode: "PERIOD_CLOSED" };
    if (e.code === "NON_POSTABLE_ACCOUNT") return { ok: false, kode: "NON_POSTABLE_ACCOUNT" };
  }
  return null;
}

const MIN_ALASAN = 5;

/** Akun harus ada, aktif, tanpa turunan, dan bertipe salah satu `tipe`. */
async function periksaAkun(tx: Prisma.TransactionClient, id: string | null, tipe: AccountType[]): Promise<void> {
  if (!id) return;
  const a = await tx.chartAccount.findUnique({ where: { id }, select: { type: true, isActive: true, _count: { select: { children: true } } } });
  if (!a || !a.isActive || a._count.children > 0 || !tipe.includes(a.type as AccountType)) throw new Tolak("AKUN_TIDAK_SAH");
}

async function periksaAkunAset(tx: Prisma.TransactionClient, a: AsetBersih): Promise<void> {
  await periksaAkun(tx, a.akunAsetId, ["ASET"]);
  await periksaAkun(tx, a.akunAkumulasiId, ["ASET"]);
  await periksaAkun(tx, a.akunBebanId, ["BEBAN"]);
  await periksaAkun(tx, a.akunLawanId, ["ASET", "LIABILITAS"]);
  if (a.pemasokId && !(await tx.supplier.findUnique({ where: { id: a.pemasokId }, select: { id: true } }))) throw new Tolak("PEMASOK_TIDAK_ADA");
}

function dataNilai(a: AsetBersih) {
  return {
    name: a.nama,
    category: a.kategori,
    acquisitionDate: parseDateOnly(a.tanggalPerolehan) as Date,
    cost: a.biaya,
    residualValue: a.nilaiSisa,
    usefulLifeMonths: a.umurBulan,
    method: a.metode,
    decliningRatePercent: a.tarifSaldoMenurun,
    depreciationStartDate: rentangBulan(a.mulaiDisusutkan).awal,
    accumulatedAtStart: a.akumulasiAwal,
    assetAccountId: a.akunAsetId,
    accumDepreciationAccountId: a.akunAkumulasiId,
    depreciationExpenseAccountId: a.akunBebanId,
    supplierId: a.pemasokId,
    location: a.lokasi,
    notes: a.catatan,
  };
}

/** Pencatatan dengan kunci idempoten ini (dicocokkan di JS — JSON-path tidak andal di MariaDB). */
async function asetDenganKunci(client: Prisma.TransactionClient | typeof prisma, olehUserId: string, kunci: string): Promise<{ id: string } | null> {
  const baris = await client.auditLog.findMany({
    where: { action: JEJAK_ASET.DICATAT, userId: olehUserId, createdAt: { gte: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } },
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
    if (m && typeof m === "object" && (m as Record<string, unknown>).kunci === kunci) return { id: b.entityId };
  }
  return null;
}

// ─── Mencatat ───────────────────────────────────────────────────────────────

export async function catatAset(
  isian: IsianAset & { olehUserId: string; idempotencyKey?: string | null; hariIni?: string },
): Promise<HasilAset> {
  const p = periksaIsianAset(isian, isian.hariIni ?? hariIniWib());
  if (!p.ok) return { ok: false, kode: p.kode };
  const a = p.aset;
  const kunci = typeof isian.idempotencyKey === "string" && isian.idempotencyKey.trim() ? isian.idempotencyKey.trim().slice(0, 100) : null;
  if (kunci) {
    const lama = await asetDenganKunci(prisma, isian.olehUserId, kunci);
    if (lama) return { ok: true, id: lama.id, ulang: true };
  }
  try {
    return await runSerializable(async (tx): Promise<HasilAset> => {
      if (kunci) {
        const lama = await asetDenganKunci(tx, isian.olehUserId, kunci);
        if (lama) return { ok: true, id: lama.id, ulang: true };
      }
      await periksaAkunAset(tx, a);
      const kode = await generateDocNumber("ASSET", tx);
      const aset = await tx.fixedAsset.create({
        data: { code: kode, ...dataNilai(a), status: STATUS_ASET.AKTIF, createdById: isian.olehUserId },
        select: { id: true },
      });
      let journalId: string | null = null;
      if (a.cara === "JURNAL" && a.akunLawanId) {
        const akunAset = a.akunAsetId ?? (await resolveAccount("FIXED_ASSET", tx));
        if (akunAset === a.akunLawanId) throw new Tolak("AKUN_TIDAK_SAH");
        const r = await postJournal(tx, {
          source: { type: SUMBER_ASET.PEROLEHAN, id: aset.id },
          date: parseDateOnly(a.tanggalPerolehan) as Date,
          description: `Perolehan aset ${kode} ${a.nama}`.slice(0, 191),
          postedById: isian.olehUserId,
          closedPeriod: "refuse",
          lines: [
            { chartAccountId: akunAset, debit: a.biaya, credit: 0, memo: "FIXED_ASSET" },
            { chartAccountId: a.akunLawanId, debit: 0, credit: a.biaya },
          ],
        });
        journalId = r.journalId;
      }
      await tx.auditLog.create({
        data: {
          userId: isian.olehUserId,
          action: JEJAK_ASET.DICATAT,
          entityType: ENTITAS_ASET,
          entityId: aset.id,
          changes: {
            after: {
              kode,
              nama: a.nama,
              kategori: a.kategori,
              tanggalPerolehan: a.tanggalPerolehan,
              biaya: a.biaya,
              umurBulan: a.umurBulan,
              metode: a.metode,
              mulaiDisusutkan: kunciBulan(a.mulaiDisusutkan),
              akumulasiAwal: a.akumulasiAwal,
            },
          },
          metadata: { cara: a.cara, akunLawanId: a.akunLawanId, journalId, ...(kunci ? { kunci } : {}) },
        },
      });
      return { ok: true, id: aset.id, kode, journalId };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    if (kunci && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const lama = await asetDenganKunci(prisma, isian.olehUserId, kunci);
      if (lama) return { ok: true, id: lama.id, ulang: true };
    }
    throw e;
  }
}

// ─── Mengubah ───────────────────────────────────────────────────────────────

const KOLOM_NILAI = [
  "category",
  "acquisitionDate",
  "cost",
  "residualValue",
  "usefulLifeMonths",
  "method",
  "decliningRatePercent",
  "depreciationStartDate",
  "accumulatedAtStart",
  "assetAccountId",
  "accumDepreciationAccountId",
  "depreciationExpenseAccountId",
] as const;

function samaNilai(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() === new Date(b as Date).getTime();
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === "object" || typeof b === "object" || typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return a === b;
}

/**
 * Mengubah aset. Nama, lokasi, pemasok, dan catatan selalu bisa diubah. Nilai
 * penyusutan (kategori, tanggal, biaya, umur, metode, akun…) hanya selama
 * belum ada penyusutan yang diposting dan perolehannya tidak dijurnal di sini
 * — sesudah itu batalkan/lepaskan aset dan catat ulang, supaya jurnal yang
 * sudah berdiri tidak pernah berbeda dari asetnya. Cara perolehan tidak
 * berubah.
 */
export async function ubahAset(isian: IsianAset & { id: string; olehUserId: string; hariIni?: string }): Promise<HasilAset> {
  try {
    return await runSerializable(async (tx): Promise<HasilAset> => {
      const lama = await tx.fixedAsset.findUnique({ where: { id: isian.id } });
      if (!lama) throw new Tolak("TIDAK_DITEMUKAN");
      if (lama.status !== STATUS_ASET.AKTIF) throw new Tolak("BUKAN_AKTIF");
      const jurnalPerolehan = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: SUMBER_ASET.PEROLEHAN, sourceId: lama.id } },
        select: { id: true },
      });
      // Cara perolehan tidak berubah sesudah dicatat, jadi isian ini diperiksa tanpa jurnal perolehan baru.
      const p = periksaIsianAset({ ...isian, cara: "SUDAH_DICATAT", akunLawanId: null }, isian.hariIni ?? hariIniWib());
      if (!p.ok) throw new Tolak(p.kode);
      const a = p.aset;
      await periksaAkunAset(tx, a);
      const baru = dataNilai(a);
      const berubahNilai = KOLOM_NILAI.filter((k) => !samaNilai((lama as Record<string, unknown>)[k], (baru as Record<string, unknown>)[k]));
      if (berubahNilai.length > 0) {
        if (jurnalPerolehan) throw new Tolak("ADA_JURNAL_PEROLEHAN");
        const disusut = await tx.fixedAssetDepreciation.count({ where: { assetId: lama.id, journalId: { not: null } } });
        if (disusut > 0) throw new Tolak("SUDAH_DISUSUTKAN");
        // Baris nol (bulan tanpa nilai) dihitung ulang dengan nilai baru.
        await tx.fixedAssetDepreciation.deleteMany({ where: { assetId: lama.id, journalId: null } });
      }
      await tx.fixedAsset.update({ where: { id: lama.id }, data: berubahNilai.length > 0 ? baru : { name: baru.name, location: baru.location, notes: baru.notes, supplierId: baru.supplierId } });
      const sebelum: Record<string, unknown> = {};
      const sesudah: Record<string, unknown> = {};
      for (const k of [...KOLOM_NILAI, "name", "location", "notes", "supplierId"] as const) {
        const x = (lama as Record<string, unknown>)[k];
        const y = (baru as Record<string, unknown>)[k];
        if (!samaNilai(x, y)) {
          sebelum[k] = x instanceof Date ? formatDateOnlyJakarta(x) : x == null ? null : typeof x === "object" ? Number(x) : x;
          sesudah[k] = y instanceof Date ? formatDateOnlyJakarta(y) : y;
        }
      }
      if (Object.keys(sesudah).length > 0) {
        await tx.auditLog.create({
          data: { userId: isian.olehUserId, action: JEJAK_ASET.DIUBAH, entityType: ENTITAS_ASET, entityId: lama.id, changes: { before: sebelum, after: sesudah } as Prisma.InputJsonValue },
        });
      }
      return { ok: true, id: lama.id };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}

// ─── Membatalkan aset ───────────────────────────────────────────────────────

/**
 * Membatalkan aset yang salah catat (belum pernah disusutkan): status
 * CANCELLED, dan bila perolehannya dijurnal di sini, jurnal pembalik
 * `FIXED_ASSET_REVERSAL` bertanggal hari ini. Alasan wajib.
 */
export async function batalkanAset(isi: { id: string; alasan: string; olehUserId: string; tanggal?: string }): Promise<HasilAset> {
  const alasan = isi.alasan?.trim() ?? "";
  if (alasan.length < MIN_ALASAN) return { ok: false, kode: "ALASAN_WAJIB" };
  const tanggal = isi.tanggal ?? hariIniWib();
  try {
    return await runSerializable(async (tx): Promise<HasilAset> => {
      const a = await tx.fixedAsset.findUnique({ where: { id: isi.id }, select: { id: true, code: true, name: true, status: true } });
      if (!a) throw new Tolak("TIDAK_DITEMUKAN");
      if (a.status !== STATUS_ASET.AKTIF) throw new Tolak("BUKAN_AKTIF");
      if ((await tx.fixedAssetDepreciation.count({ where: { assetId: a.id, journalId: { not: null } } })) > 0) throw new Tolak("SUDAH_DISUSUTKAN");
      const asli = await tx.journal.findUnique({
        where: { sourceType_sourceId: { sourceType: SUMBER_ASET.PEROLEHAN, sourceId: a.id } },
        select: { id: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
      });
      let balikId: string | null = null;
      if (asli) {
        const r = await postJournal(tx, {
          source: { type: SUMBER_ASET.PEROLEHAN_BATAL, id: a.id },
          date: parseDateOnly(tanggal) as Date,
          description: `Pembatalan aset ${a.code} ${a.name}`.slice(0, 191),
          postedById: isi.olehUserId,
          closedPeriod: "refuse",
          reversalOfId: asli.id,
          lines: asli.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.credit), credit: Number(l.debit), ...(l.memo ? { memo: l.memo } : {}) })),
        });
        balikId = r.journalId;
      }
      await tx.fixedAssetDepreciation.deleteMany({ where: { assetId: a.id, journalId: null } });
      await tx.fixedAsset.update({ where: { id: a.id }, data: { status: STATUS_ASET.BATAL } });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_ASET.DIBATALKAN,
          entityType: ENTITAS_ASET,
          entityId: a.id,
          changes: { before: { status: STATUS_ASET.AKTIF }, after: { status: STATUS_ASET.BATAL } },
          metadata: { jurnalPembalik: balikId },
          reason: alasan,
        },
      });
      return { ok: true, id: a.id, journalId: balikId };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}

// ─── Pelepasan ──────────────────────────────────────────────────────────────

/** sourceId pelepasan ke-n: `<aset>` lalu `<aset>#2`, `<aset>#3` (pelepasan ulang sesudah dibatalkan). */
async function sumberPelepasanBerikut(tx: Prisma.TransactionClient, asetId: string): Promise<string> {
  const n = await tx.journal.count({ where: { sourceType: SUMBER_ASET.PELEPASAN, OR: [{ sourceId: asetId }, { sourceId: { startsWith: `${asetId}#` } }] } });
  return n === 0 ? asetId : `${asetId}#${n + 1}`;
}

/**
 * Melepas (menjual / menghapus) aset per `tanggal`. Penyusutan bulan-bulan
 * sebelum bulan pelepasan yang belum diposting diposting lebih dulu di
 * transaksi yang sama; lalu jurnal pelepasan dari akumulasi yang tercatat.
 */
export async function lepasAset(isi: {
  id: string;
  tanggal: string;
  hasilJual: unknown;
  akunPenerimaanId?: string | null;
  catatan?: string | null;
  olehUserId: string;
  hariIni?: string;
  /** Tes: lantai tanggal mulai buku besar tanpa membaca pengaturan. */
  tanggalMulai?: Date | null;
}): Promise<HasilAset> {
  const hariIni = isi.hariIni ?? hariIniWib();
  const tanggal = parseDateOnly(isi.tanggal);
  if (!tanggal || isi.tanggal > hariIni) return { ok: false, kode: "TANGGAL_LEPAS_TIDAK_SAH" };
  const jualSen = isi.hasilJual === "" || isi.hasilJual == null ? 0 : bacaRupiahSen(isi.hasilJual);
  if (jualSen == null) return { ok: false, kode: "HASIL_JUAL_TIDAK_SAH" };
  const akunPenerimaan = typeof isi.akunPenerimaanId === "string" && isi.akunPenerimaanId.trim() ? isi.akunPenerimaanId.trim() : null;
  if (jualSen > 0 && !akunPenerimaan) return { ok: false, kode: "AKUN_PENERIMAAN_WAJIB" };
  const catatan = isi.catatan?.trim() ? isi.catatan.trim().slice(0, 2000) : null;
  // Bulan sebelum tanggal mulai buku besar sudah dibukukan di luar sistem (akumulasi awal) — tidak disusulkan.
  const mulaiBuku = isi.tanggalMulai !== undefined ? isi.tanggalMulai : await readGlCutover();
  const lantai = mulaiBuku ? bulanWib(mulaiBuku) : null;

  try {
    return await runSerializable(async (tx): Promise<HasilAset> => {
      const a = await tx.fixedAsset.findUnique({ where: { id: isi.id }, select: { ...PILIH_ASET_SUSUT, acquisitionDate: true, assetAccountId: true } });
      if (!a) throw new Tolak("TIDAK_DITEMUKAN");
      if (a.status !== STATUS_ASET.AKTIF) throw new Tolak("BUKAN_AKTIF");
      if (isi.tanggal < formatDateOnlyJakarta(a.acquisitionDate)) throw new Tolak("TANGGAL_LEPAS_TIDAK_SAH");
      if (akunPenerimaan) await periksaAkun(tx, akunPenerimaan, ["ASET"]);

      // Susulkan penyusutan sampai bulan sebelum bulan pelepasan (bulan tertutup dilewati — disusulkan tidak bisa).
      const sebelum = bulanTerakhirSebelumLepas(bulanWib(tanggal));
      const awal = bulanWib(a.depreciationStartDate);
      if (sebelum.tahun * 12 + sebelum.bulan >= awal.tahun * 12 + awal.bulan) {
        const terakhir = await tx.fixedAssetDepreciation.findFirst({ where: { assetId: a.id }, orderBy: { period: "desc" }, select: { period: true } });
        let dari = lantai && lantai.tahun * 12 + lantai.bulan > awal.tahun * 12 + awal.bulan ? lantai : awal;
        if (terakhir) {
          const [th, bl] = terakhir.period.split("-").map(Number);
          const sesudah = bl === 12 ? { tahun: th + 1, bulan: 1 } : { tahun: th, bulan: bl + 1 };
          if (sesudah.tahun * 12 + sesudah.bulan > dari.tahun * 12 + dari.bulan) dari = sesudah;
        }
        for (const tb of deretBulan(dari, sebelum)) await postingPenyusutanDalamTx(tx, a, tb, isi.olehUserId);
      }

      const sum = await tx.fixedAssetDepreciation.aggregate({ where: { assetId: a.id }, _sum: { amount: true } });
      const akumulasi = Number(a.accumulatedAtStart) + Number(sum._sum.amount ?? 0);
      const biaya = Number(a.cost);
      const baris = barisPelepasan({ biaya, akumulasi, hasilJual: jualSen / 100 });
      const akun = {
        ASET: a.assetAccountId ?? (await resolveAccount("FIXED_ASSET", tx)),
        AKUMULASI: baris.some((b) => b.peran === "AKUMULASI") ? (a.accumDepreciationAccountId ?? (await resolveAccount("ACCUM_DEPRECIATION", tx))) : "",
        LABA_RUGI: baris.some((b) => b.peran === "LABA_RUGI") ? await resolveAccount("ASSET_DISPOSAL_GAIN_LOSS", tx) : "",
        PENERIMAAN: akunPenerimaan ?? "",
      };
      const memo: Record<string, string> = { ASET: "FIXED_ASSET", AKUMULASI: "ACCUM_DEPRECIATION", LABA_RUGI: "ASSET_DISPOSAL_GAIN_LOSS", PENERIMAAN: "PENERIMAAN" };
      const sumberId = await sumberPelepasanBerikut(tx, a.id);
      const r = await postJournal(tx, {
        source: { type: SUMBER_ASET.PELEPASAN, id: sumberId },
        date: tanggal,
        description: `${jualSen > 0 ? "Penjualan" : "Penghapusan"} aset ${a.code} ${a.name}`.slice(0, 191),
        postedById: isi.olehUserId,
        closedPeriod: "refuse",
        lines: baris.map((b) => ({ chartAccountId: akun[b.peran], debit: b.debit, credit: b.credit, memo: memo[b.peran] })),
      });
      await tx.fixedAsset.update({
        where: { id: a.id },
        data: { status: STATUS_ASET.DILEPAS, disposedAt: tanggal, disposalProceeds: jualSen / 100, disposalNote: catatan, disposedById: isi.olehUserId },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_ASET.DILEPAS,
          entityType: ENTITAS_ASET,
          entityId: a.id,
          changes: { before: { status: STATUS_ASET.AKTIF }, after: { status: STATUS_ASET.DILEPAS, tanggal: isi.tanggal, hasilJual: jualSen / 100 } },
          metadata: { journalId: r.journalId, akumulasi, nilaiBuku: Math.round((biaya - akumulasi) * 100) / 100, akunPenerimaanId: akunPenerimaan },
          ...(catatan ? { reason: catatan } : {}),
        },
      });
      return { ok: true, id: a.id, journalId: r.journalId };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  } finally {
    // Penyusutan yang disusulkan di sini mungkin pernah gagal di sapuan.
    void tandaiPenyusutanSelesai(isi.id);
  }
}

async function tandaiPenyusutanSelesai(asetId: string): Promise<void> {
  try {
    const baris = await prisma.fixedAssetDepreciation.findMany({ where: { assetId: asetId }, select: { period: true } });
    if (baris.length) await tandaiJurnalTertundaSelesai(baris.map((b) => dokumenJurnal(SUMBER_ASET.PENYUSUTAN, idSumberPenyusutan(asetId, b.period))));
  } catch {
    // tandaiJurnalTertundaSelesai sendiri tidak melempar; ini hanya penjaga kueri baris.
  }
}

/**
 * Membatalkan pelepasan yang salah catat: jurnal pembalik
 * `ASSET_DISPOSAL_REVERSAL` (sourceId sama, `reversalOfId`) bertanggal
 * `tanggal` (bawaan hari ini), aset AKTIF kembali. Penyusutan bulan-bulan
 * sesudahnya disusulkan oleh posting penyusutan berikutnya.
 */
export async function batalkanPelepasan(isi: { id: string; alasan: string; olehUserId: string; tanggal?: string }): Promise<HasilAset> {
  const alasan = isi.alasan?.trim() ?? "";
  if (alasan.length < MIN_ALASAN) return { ok: false, kode: "ALASAN_WAJIB" };
  const tanggal = parseDateOnly(isi.tanggal ?? hariIniWib()) as Date;
  try {
    return await runSerializable(async (tx): Promise<HasilAset> => {
      const a = await tx.fixedAsset.findUnique({ where: { id: isi.id }, select: { id: true, code: true, name: true, status: true, disposedAt: true, disposalProceeds: true } });
      if (!a) throw new Tolak("TIDAK_DITEMUKAN");
      if (a.status !== STATUS_ASET.DILEPAS) throw new Tolak("BUKAN_DILEPAS");
      const pelepasan = await tx.journal.findMany({
        where: { sourceType: SUMBER_ASET.PELEPASAN, OR: [{ sourceId: a.id }, { sourceId: { startsWith: `${a.id}#` } }] },
        select: { id: true, sourceId: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
      });
      const sudahDibalik = new Set(
        (await tx.journal.findMany({ where: { reversalOfId: { in: pelepasan.map((p) => p.id) } }, select: { reversalOfId: true } })).map((x) => x.reversalOfId),
      );
      const aktif = pelepasan.find((p) => !sudahDibalik.has(p.id));
      let balikId: string | null = null;
      if (aktif) {
        const r = await postJournal(tx, {
          source: { type: SUMBER_ASET.PELEPASAN_BATAL, id: aktif.sourceId ?? a.id },
          date: tanggal,
          description: `Pembatalan pelepasan aset ${a.code} ${a.name}`.slice(0, 191),
          postedById: isi.olehUserId,
          closedPeriod: "refuse",
          reversalOfId: aktif.id,
          lines: aktif.lines.map((l) => ({ chartAccountId: l.chartAccountId, debit: Number(l.credit), credit: Number(l.debit), ...(l.memo ? { memo: l.memo } : {}) })),
        });
        balikId = r.journalId;
      }
      await tx.fixedAsset.update({
        where: { id: a.id },
        data: { status: STATUS_ASET.AKTIF, disposedAt: null, disposalProceeds: null, disposalNote: null, disposedById: null },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_ASET.PELEPASAN_DIBATALKAN,
          entityType: ENTITAS_ASET,
          entityId: a.id,
          changes: {
            before: { status: STATUS_ASET.DILEPAS, tanggal: a.disposedAt ? formatDateOnlyJakarta(a.disposedAt) : null, hasilJual: a.disposalProceeds == null ? null : Number(a.disposalProceeds) },
            after: { status: STATUS_ASET.AKTIF },
          },
          metadata: { jurnalPembalik: balikId },
          reason: alasan,
        },
      });
      return { ok: true, id: a.id, journalId: balikId };
    });
  } catch (e) {
    const g = petakan(e);
    if (g) return g;
    throw e;
  }
}
