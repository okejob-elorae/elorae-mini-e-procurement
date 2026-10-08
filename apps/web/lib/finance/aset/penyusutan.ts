import { JournalError, lockPeriodForPosting, postJournal, prisma, Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { resolveAccount, UnmappedRoleError } from "@/lib/finance/journals/mapping";
import { bulanWib, deretBulan, kunciBulan, labelBulan, rentangBulan, type TahunBulan } from "@/lib/finance/periode/periode";
import { readGlCutover } from "@/lib/finance/sales/sweep";
import { dokumenJurnal, tandaiJurnalTertundaSelesai } from "@/lib/finance/jurnal-tertunda";
import { catatGagalSapuan } from "@/lib/finance/sapuan/tertunda";
import { akhirMasaManfaat, dalamMasaManfaat, jumlahPenyusutanBulan } from "./jadwal";
import { idSumberPenyusutan, spekDariAset, STATUS_ASET, SUMBER_ASET } from "./aturan";
import { ENTITAS_ASET, JEJAK_ASET } from "./jejak";

/*
 * Posting penyusutan bulanan aset tetap (bagian D3) — KHUSUS SERVER.
 *
 * Penyusutan adalah dokumen KEUANGAN: baris `FixedAssetDepreciation` dan
 * jurnalnya (DR beban penyusutan / CR akumulasi penyusutan) ditulis di SATU
 * transaksi, jadi bulan yang "sudah disusutkan" selalu punya jurnalnya (atau
 * jumlahnya nol). Idempoten per (aset, bulan): baris unik + jurnal ber-sourceId
 * `<aset>/<YYYY-MM>` (`DEPRECIATION`).
 *
 * Tanggal jurnal: hari terakhir bulan itu (00:00 WIB). Bulan yang sudah
 * DITUTUP tidak pernah diposting (`closedPeriod: "refuse"`) dan dilewati tanpa
 * baris — jumlahnya disusulkan bulan terbuka berikutnya (`jumlahPenyusutanBulan`
 * menghitung dari target kumulatif). Bulan pelepasan dan sesudahnya tidak
 * disusutkan.
 *
 * Akun: akun beban / akumulasi yang diisi di aset menimpa peran
 * `DEPRECIATION_EXPENSE` / `ACCUM_DEPRECIATION`.
 */

export const PILIH_ASET_SUSUT = {
  id: true,
  code: true,
  name: true,
  status: true,
  cost: true,
  residualValue: true,
  usefulLifeMonths: true,
  method: true,
  decliningRatePercent: true,
  depreciationStartDate: true,
  accumulatedAtStart: true,
  accumDepreciationAccountId: true,
  depreciationExpenseAccountId: true,
  disposedAt: true,
} as const;

export type AsetSusut = Prisma.FixedAssetGetPayload<{ select: typeof PILIH_ASET_SUSUT }>;

export function spekAset(a: AsetSusut) {
  return spekDariAset({
    cost: Number(a.cost),
    residualValue: Number(a.residualValue),
    usefulLifeMonths: a.usefulLifeMonths,
    method: a.method,
    decliningRatePercent: a.decliningRatePercent == null ? null : Number(a.decliningRatePercent),
    mulai: bulanWib(a.depreciationStartDate),
  });
}

/** Tanggal jurnal penyusutan bulan `tb`: hari terakhirnya, 00:00 WIB. */
export function tanggalPenyusutan(tb: TahunBulan): Date {
  const akhir = rentangBulan(tb).akhir;
  return new Date(akhir.getTime() + 1 - 24 * 60 * 60 * 1000);
}

/** Bulan `tb` termasuk yang bisa disusutkan aset ini: dalam masa manfaat, belum dilepas, tidak batal. */
export function bulanDisusutkan(a: AsetSusut, tb: TahunBulan): boolean {
  if (a.status === STATUS_ASET.BATAL) return false;
  if (!dalamMasaManfaat(spekAset(a), tb)) return false;
  if (a.disposedAt) {
    const lepas = bulanWib(a.disposedAt);
    if (tb.tahun * 12 + tb.bulan >= lepas.tahun * 12 + lepas.bulan) return false;
  }
  return true;
}

export type HasilPenyusutanBulan =
  | { status: "DIPOSTING"; journalId: string; jumlah: number }
  | { status: "SUDAH_ADA"; journalId: string | null }
  | { status: "NOL" }
  | { status: "DI_LUAR_MASA" }
  | { status: "PERIODE_DITUTUP" };

/**
 * Penyusutan satu aset satu bulan di dalam transaksi pemanggil. Melempar
 * `UnmappedRoleError` / `JournalError` — pemanggil yang memutuskan nasibnya
 * (batch: catat gagal; pelepasan: batalkan seluruhnya).
 */
export async function postingPenyusutanDalamTx(
  tx: Prisma.TransactionClient,
  a: AsetSusut,
  tb: TahunBulan,
  olehUserId: string,
): Promise<HasilPenyusutanBulan> {
  if (!bulanDisusutkan(a, tb)) return { status: "DI_LUAR_MASA" };
  const periode = kunciBulan(tb);
  const ada = await tx.fixedAssetDepreciation.findUnique({
    where: { assetId_period: { assetId: a.id, period: periode } },
    select: { journalId: true },
  });
  if (ada) return { status: "SUDAH_ADA", journalId: ada.journalId };

  const tanggal = tanggalPenyusutan(tb);
  if ((await lockPeriodForPosting(tx, tanggal)) === "CLOSED") return { status: "PERIODE_DITUTUP" };

  const sudah = await tx.fixedAssetDepreciation.aggregate({ where: { assetId: a.id }, _sum: { amount: true } });
  const jumlah = jumlahPenyusutanBulan(spekAset(a), tb, {
    akumulasiAwal: Number(a.accumulatedAtStart),
    sudahDiposting: Number(sudah._sum.amount ?? 0),
  });
  if (jumlah <= 0) {
    await tx.fixedAssetDepreciation.create({ data: { assetId: a.id, period: periode, amount: 0 } });
    return { status: "NOL" };
  }

  const akunBeban = a.depreciationExpenseAccountId ?? (await resolveAccount("DEPRECIATION_EXPENSE", tx));
  const akunAkum = a.accumDepreciationAccountId ?? (await resolveAccount("ACCUM_DEPRECIATION", tx));
  const r = await postJournal(tx, {
    source: { type: SUMBER_ASET.PENYUSUTAN, id: idSumberPenyusutan(a.id, periode) },
    date: tanggal,
    description: `Penyusutan ${a.code} ${a.name} — ${labelBulan(tb)}`.slice(0, 191),
    postedById: olehUserId,
    closedPeriod: "refuse",
    lines: [
      { chartAccountId: akunBeban, debit: jumlah, credit: 0, memo: "DEPRECIATION_EXPENSE" },
      { chartAccountId: akunAkum, debit: 0, credit: jumlah, memo: "ACCUM_DEPRECIATION" },
    ],
  });
  let nilai = jumlah;
  if (!r.created) {
    // Jurnalnya sudah berdiri tanpa barisnya (data lama/terputus): baris mengikuti jurnal.
    const j = await tx.journalLine.aggregate({ where: { journalId: r.journalId }, _sum: { debit: true } });
    nilai = Number(j._sum.debit ?? 0);
  }
  await tx.fixedAssetDepreciation.create({ data: { assetId: a.id, period: periode, amount: nilai, journalId: r.journalId } });
  return { status: "DIPOSTING", journalId: r.journalId, jumlah: nilai };
}

export type GagalPenyusutan = { asetId: string; kode: string; periode: string; kodeGalat: "UNMAPPED_ROLE" | "NON_POSTABLE_ACCOUNT" | "ERROR"; peran?: string };

export type HasilPenyusutanSatu = HasilPenyusutanBulan | { status: "GAGAL"; kodeGalat: GagalPenyusutan["kodeGalat"]; peran?: string; pesan?: string };

/** Penyusutan satu aset satu bulan, transaksinya sendiri. Tidak melempar untuk kegagalan biasa. */
export async function postingPenyusutanSatu(asetId: string, tb: TahunBulan, olehUserId: string): Promise<HasilPenyusutanSatu> {
  try {
    return await runSerializable(async (tx) => {
      const a = await tx.fixedAsset.findUnique({ where: { id: asetId }, select: PILIH_ASET_SUSUT });
      if (!a) return { status: "DI_LUAR_MASA" as const };
      return postingPenyusutanDalamTx(tx, a, tb, olehUserId);
    });
  } catch (e) {
    if (e instanceof UnmappedRoleError) return { status: "GAGAL", kodeGalat: "UNMAPPED_ROLE", peran: e.role };
    if (e instanceof JournalError) {
      if (e.code === "PERIOD_CLOSED") return { status: "PERIODE_DITUTUP" };
      if (e.code === "NON_POSTABLE_ACCOUNT") return { status: "GAGAL", kodeGalat: "NON_POSTABLE_ACCOUNT" };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: "SUDAH_ADA", journalId: null };
    console.error(`[penyusutan] ${asetId} ${kunciBulan(tb)} gagal`, e);
    return { status: "GAGAL", kodeGalat: "ERROR", pesan: e instanceof Error ? e.message : String(e) };
  }
}

/** Tanda `JOURNAL_PENDING` untuk penyusutan yang gagal (dedup per aset-bulan-sebab). Tidak pernah melempar. */
export async function catatPenyusutanTertunda(g: GagalPenyusutan & { nama?: string }): Promise<void> {
  const docId = idSumberPenyusutan(g.asetId, g.periode);
  await catatGagalSapuan({
    metadata: { docId, kind: JENIS_TERTUNDA_PENYUSUTAN, reason: g.kodeGalat, role: g.peran ?? null, docNo: `${g.kode} · ${g.periode}` },
    judul: `Penyusutan ${g.kode} ${g.periode} belum diposting`,
    pesan:
      `Penyusutan aset ${g.kode}${g.nama ? ` ${g.nama}` : ""} bulan ${g.periode} gagal diposting (${g.kodeGalat}${g.peran ? `: ${g.peran}` : ""}). ` +
      "Petakan akunnya di Keuangan → Pemetaan Akun (atau isi akun di aset itu), lalu tekan Posting penyusutan di Keuangan → Aset tetap.",
  });
}

/** `kind` metadata `JOURNAL_PENDING` penyusutan (`lib/finance/jurnal-tertunda.ts`). */
export const JENIS_TERTUNDA_PENYUSUTAN = "penyusutan";

export type RingkasanPenyusutan = {
  sampai: string;
  diposting: number;
  totalNilai: number;
  nol: number;
  periodeDitutup: number;
  gagal: GagalPenyusutan[];
};

/**
 * Posting penyusutan semua aset (atau `asetIds`) untuk setiap bulan yang belum
 * disusutkan sampai `sampai`, berurutan dari yang paling awal. Bulan awalnya:
 * sesudah baris penyusutan terakhir aset itu, tidak sebelum bulan mulai
 * disusutkan, dan tidak sebelum bulan tanggal mulai buku besar (bila ada).
 * Satu aset yang gagal (akun belum dipetakan) berhenti di bulan itu; aset lain
 * jalan terus. Kegagalan menulis `JOURNAL_PENDING`; keberhasilan
 * menyelesaikannya.
 */
export async function postingPenyusutan(isi: {
  sampai: TahunBulan;
  olehUserId: string;
  asetIds?: readonly string[];
  /** Tes: lantai tanggal mulai buku besar tanpa membaca pengaturan. */
  tanggalMulai?: Date | null;
}): Promise<RingkasanPenyusutan> {
  const lantaiTanggal = isi.tanggalMulai !== undefined ? isi.tanggalMulai : await readGlCutover();
  const lantai = lantaiTanggal ? bulanWib(lantaiTanggal) : null;
  const ringkas: RingkasanPenyusutan = { sampai: kunciBulan(isi.sampai), diposting: 0, totalNilai: 0, nol: 0, periodeDitutup: 0, gagal: [] };

  const aset = await prisma.fixedAsset.findMany({
    where: {
      status: { in: [STATUS_ASET.AKTIF, STATUS_ASET.DILEPAS] },
      depreciationStartDate: { lte: rentangBulan(isi.sampai).akhir },
      usefulLifeMonths: { gt: 0 },
      ...(isi.asetIds ? { id: { in: [...isi.asetIds] } } : {}),
    },
    select: { ...PILIH_ASET_SUSUT, depreciations: { orderBy: { period: "desc" }, take: 1, select: { period: true } } },
    orderBy: { code: "asc" },
  });

  let totalSen = 0;
  const selesai: string[] = [];
  for (const a of aset) {
    const spek = spekAset(a);
    const akhir = akhirMasaManfaat(spek);
    if (!akhir) continue;
    const kandidat = [spek.mulai];
    if (lantai) kandidat.push(lantai);
    const terakhir = a.depreciations[0]?.period;
    if (terakhir) {
      const [th, bl] = terakhir.split("-").map(Number);
      kandidat.push(bl === 12 ? { tahun: th + 1, bulan: 1 } : { tahun: th, bulan: bl + 1 });
    }
    const dari = kandidat.reduce((m, x) => (x.tahun * 12 + x.bulan > m.tahun * 12 + m.bulan ? x : m));
    const sampai = akhir.tahun * 12 + akhir.bulan < isi.sampai.tahun * 12 + isi.sampai.bulan ? akhir : isi.sampai;
    for (const tb of deretBulan(dari, sampai)) {
      if (!bulanDisusutkan(a, tb)) continue;
      const h = await postingPenyusutanSatu(a.id, tb, isi.olehUserId);
      const periode = kunciBulan(tb);
      if (h.status === "DIPOSTING") {
        ringkas.diposting += 1;
        totalSen += Math.round(h.jumlah * 100);
        selesai.push(idSumberPenyusutan(a.id, periode));
      } else if (h.status === "NOL") {
        ringkas.nol += 1;
        selesai.push(idSumberPenyusutan(a.id, periode));
      } else if (h.status === "PERIODE_DITUTUP") {
        ringkas.periodeDitutup += 1;
      } else if (h.status === "GAGAL") {
        const g: GagalPenyusutan = { asetId: a.id, kode: a.code, periode, kodeGalat: h.kodeGalat, ...(h.peran ? { peran: h.peran } : {}) };
        ringkas.gagal.push(g);
        await catatPenyusutanTertunda({ ...g, nama: a.name });
        break;
      }
    }
  }
  ringkas.totalNilai = totalSen / 100;
  if (selesai.length) await tandaiJurnalTertundaSelesai(selesai.map((id) => dokumenJurnal(SUMBER_ASET.PENYUSUTAN, id)));

  if (ringkas.diposting > 0 || ringkas.gagal.length > 0) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_ASET.PENYUSUTAN_DIJALANKAN,
          entityType: ENTITAS_ASET,
          entityId: `penyusutan-${ringkas.sampai}`,
          metadata: {
            sampai: ringkas.sampai,
            diposting: ringkas.diposting,
            totalNilai: ringkas.totalNilai,
            nol: ringkas.nol,
            periodeDitutup: ringkas.periodeDitutup,
            gagal: ringkas.gagal.length,
            ...(isi.asetIds ? { asetIds: [...isi.asetIds].slice(0, 50) } : {}),
          },
        },
      });
    } catch (e) {
      console.error("[penyusutan] gagal menulis jejak", e);
    }
  }
  return ringkas;
}


/** Pengguna pencatat jurnal untuk cron: admin pertama (sama dengan sapuan jurnal). */
async function penggunaSistem(): Promise<string | null> {
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select: { id: true } });
  return admin?.id ?? null;
}

/**
 * Cron awal bulan: posting penyusutan semua aset sampai BULAN LALU (WIB).
 * Bulan yang terlewat sebelumnya ikut disusulkan (`postingPenyusutan`).
 */
export async function postingPenyusutanTerjadwal(sekarang: Date = new Date()): Promise<RingkasanPenyusutan | null> {
  const oleh = await penggunaSistem();
  if (!oleh) return null;
  const kini = bulanWib(sekarang);
  const lalu = kini.bulan === 1 ? { tahun: kini.tahun - 1, bulan: 12 } : { tahun: kini.tahun, bulan: kini.bulan - 1 };
  return postingPenyusutan({ sampai: lalu, olehUserId: oleh });
}
