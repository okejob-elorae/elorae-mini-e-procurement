import { prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { GL_CUTOVER_SETTING_KEY } from "@/lib/finance/sales/sweep";
import { SARING_JURNAL_BERLAKU } from "@/lib/finance/journals/status-jurnal";
import { cariSemuaTanpaJurnal } from "@/lib/finance/sapuan/runner";
import { parseDateOnly } from "@/lib/date-only";
import { AWALAN_SUMBER_SALDO_AWAL, STATUS_PERIODE, SUMBER_TUTUP_TAHUN, type KodeGalatPeriode } from "./periode";
import { periksaTanggalMulaiBaru, tanggalMulaiSah, type DampakTanggalMulai } from "./tanggal-mulai-aturan";
import { ENTITAS_PENGATURAN, JEJAK_PERIODE } from "./jejak";

/*
 * Tanggal mulai buku besar (`finance.glCutoverDate`) — bacaan dan penulis.
 * Hanya di server. Aturan dan peringatannya ada di `./tanggal-mulai-aturan.ts`.
 */

export type InfoTanggalMulai = {
  tanggal: string | null;
  /** Isi pengaturan yang tidak terbaca sebagai tanggal (salah ketik lewat SQL) — ditampilkan apa adanya. */
  mentahTidakSah: string | null;
  diubahPada: string | null;
  diubahOleh: string | null;
  adaPeriodeTertutup: boolean;
};

export async function bacaInfoTanggalMulai(): Promise<InfoTanggalMulai> {
  const [row, tertutup, jejak] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { key: GL_CUTOVER_SETTING_KEY }, select: { value: true, updatedAt: true } }),
    prisma.accountingPeriod.count({ where: { status: STATUS_PERIODE.TERTUTUP } }),
    prisma.auditLog.findFirst({
      where: { action: JEJAK_PERIODE.TANGGAL_MULAI_DIUBAH },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, user: { select: { name: true, email: true } } },
    }),
  ]);
  const mentah = row?.value?.trim() ?? "";
  const tanggal = tanggalMulaiSah(mentah);
  return {
    tanggal,
    mentahTidakSah: mentah && !tanggal ? mentah : null,
    diubahPada: (jejak?.createdAt ?? row?.updatedAt)?.toISOString() ?? null,
    diubahOleh: jejak ? (jejak.user.name ?? jejak.user.email ?? null) : null,
    adaPeriodeTertutup: tertutup > 0,
  };
}

/** Batas dokumen per jenis yang dihitung pratinjau dampak. */
const BATAS_DAMPAK = 100;

/**
 * Dampak memasang tanggal mulai `baru` ("YYYY-MM-DD", sudah sah): jurnal
 * otomatis yang tanggalnya sebelum itu (tetap di buku), dan dokumen sejak itu
 * yang belum berjurnal (akan disapu).
 */
export async function hitungDampakTanggalMulai(baru: string, sekarang: Date = new Date()): Promise<DampakTanggalMulai> {
  const mulai = parseDateOnly(baru);
  if (!mulai) return { jurnalOtomatisSebelum: 0, dokumenAkanDisapu: [], terpotong: false };
  const [sebelum, dokumen] = await Promise.all([
    prisma.journal.count({
      where: {
        ...SARING_JURNAL_BERLAKU,
        isManual: false,
        date: { lt: mulai },
        sourceType: { not: null },
        NOT: [{ sourceType: SUMBER_TUTUP_TAHUN }, { sourceType: { startsWith: AWALAN_SUMBER_SALDO_AWAL } }],
      },
    }),
    mulai.getTime() <= sekarang.getTime()
      ? cariSemuaTanpaJurnal({ sejak: mulai, sampai: sekarang, batasPerSumber: BATAS_DAMPAK })
      : Promise.resolve([]),
  ]);
  return {
    jurnalOtomatisSebelum: sebelum,
    dokumenAkanDisapu: dokumen.filter((d) => d.dokumen.length > 0).map((d) => ({ label: d.label, jumlah: d.dokumen.length })),
    terpotong: dokumen.some((d) => d.terpotong),
  };
}

export type HasilTanggalMulai = { ok: true; tanggal: string } | { ok: false; kode: KodeGalatPeriode };

class Tolak extends Error {
  constructor(public kode: KodeGalatPeriode) {
    super(kode);
  }
}

/**
 * Menyimpan tanggal mulai baru. Ditolak bila sudah ada bulan yang ditutup
 * (diperiksa ulang di dalam transaksi). Jejak membawa tanggal lama dan baru.
 */
export async function tetapkanTanggalMulai(isi: { tanggal: string; olehUserId: string }): Promise<HasilTanggalMulai> {
  try {
    const tanggal = await runSerializable(async (tx) => {
      const row = await tx.systemSetting.findUnique({ where: { key: GL_CUTOVER_SETTING_KEY }, select: { value: true } });
      const lama = tanggalMulaiSah(row?.value) ?? null;
      const tertutup = (await tx.accountingPeriod.count({ where: { status: STATUS_PERIODE.TERTUTUP } })) > 0;
      const periksa = periksaTanggalMulaiBaru(isi.tanggal, { tanggalLama: lama, adaPeriodeTertutup: tertutup });
      if (!periksa.ok) throw new Tolak(periksa.kode);
      const simpan = await tx.systemSetting.upsert({
        where: { key: GL_CUTOVER_SETTING_KEY },
        create: { key: GL_CUTOVER_SETTING_KEY, value: periksa.tanggal },
        update: { value: periksa.tanggal },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          userId: isi.olehUserId,
          action: JEJAK_PERIODE.TANGGAL_MULAI_DIUBAH,
          entityType: ENTITAS_PENGATURAN,
          entityId: simpan.id,
          changes: { before: { [GL_CUTOVER_SETTING_KEY]: row?.value ?? null }, after: { [GL_CUTOVER_SETTING_KEY]: periksa.tanggal } },
          metadata: { kunci: GL_CUTOVER_SETTING_KEY },
        },
      });
      return periksa.tanggal;
    });
    return { ok: true, tanggal };
  } catch (e) {
    if (e instanceof Tolak) return { ok: false, kode: e.kode };
    throw e;
  }
}
