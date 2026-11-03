import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { catatJejak, JEJAK } from "@/lib/receivables/jejak";
import { bacaNilaiSiklusPertama } from "./siklus-pertama-aturan";

/**
 * Bulan siklus pertama konsinyasi (`SystemSetting["konsinyasi.bulanSiklusPertama"]`, P59). Selama
 * belum diatur, angka siklus mana pun tidak bisa dikunci (`SIKLUS_PERTAMA_BELUM_DIATUR`) — kalau
 * tidak, tagihan siklus bisa menagih bulan yang utangnya sudah diimpor dari kertas.
 */

export const KUNCI_SIKLUS_PERTAMA = "konsinyasi.bulanSiklusPertama";

type KlienSetelan = { systemSetting: Pick<Prisma.TransactionClient["systemSetting"], "findUnique"> };

/**
 * Bulan siklus pertama. Hook tes (`VITEST`): `UJI_BULAN_SIKLUS_PERTAMA` kosong → gerbang terbuka
 * (`0000-01`); `setelan` → baca baris sungguhan; `KOSONG` → belum diatur; nilai lain = bulannya.
 * Pola yang sama dengan `bacaTanggalMulaiTagihan`.
 */
export async function muatBulanSiklusPertama(klien: KlienSetelan): Promise<{ diatur: false } | { diatur: true; bulan: string }> {
  if (process.env.VITEST) {
    const uji = process.env.UJI_BULAN_SIKLUS_PERTAMA;
    if (!uji) return { diatur: true, bulan: "0000-01" };
    if (uji === "KOSONG") return { diatur: false };
    if (uji !== "setelan") {
      const b = bacaNilaiSiklusPertama(uji);
      return b ? { diatur: true, bulan: b } : { diatur: false };
    }
  }
  const baris = await klien.systemSetting.findUnique({ where: { key: KUNCI_SIKLUS_PERTAMA }, select: { value: true } });
  const bulan = bacaNilaiSiklusPertama(baris?.value);
  return bulan ? { diatur: true, bulan } : { diatur: false };
}

export type AlasanGagalSiklusPertama = "BULAN_TIDAK_VALID" | "ADA_SIKLUS_TERKUNCI_SEBELUMNYA" | "ADA_TAGIHAN_KONSI_LAMA_SESUDAHNYA";

/**
 * Atur bulan siklus pertama (`consignment:lock`, diperiksa aksinya). Ditolak kalau sudah ada siklus
 * TERKUNCI sebelum bulan itu, atau tagihan konsi impor/manual yang masih hidup bertanggal sejak
 * bulan itu — kedua-duanya akan tertagih dua kali. Jejaknya di transaksi yang sama.
 */
export async function aturBulanSiklusPertama(input: {
  bulan: string;
  olehUserId: string;
}): Promise<{ ok: true } | { ok: false; alasan: AlasanGagalSiklusPertama; nomor?: string }> {
  const bulan = bacaNilaiSiklusPertama(input.bulan);
  if (!bulan) return { ok: false, alasan: "BULAN_TIDAK_VALID" };
  const [y, m] = bulan.split("-").map(Number);
  return runSerializable(async (tx) => {
    const terkunci = await tx.consignmentCycle.findFirst({
      where: { lockedAt: { not: null }, OR: [{ periodYear: { lt: y } }, { periodYear: y, periodMonth: { lt: m } }] },
      select: { noKonsi: true },
    });
    if (terkunci) return { ok: false as const, alasan: "ADA_SIKLUS_TERKUNCI_SEBELUMNYA" as const, nomor: terkunci.noKonsi };
    const lama = await tx.receivable.findFirst({
      where: { isConsignment: true, source: { in: ["MANUAL", "IMPORT"] }, status: { not: "VOIDED" }, invoiceDate: { gte: new Date(`${bulan}-01T00:00:00+07:00`) } },
      select: { invoiceNo: true },
    });
    if (lama) return { ok: false as const, alasan: "ADA_TAGIHAN_KONSI_LAMA_SESUDAHNYA" as const, nomor: lama.invoiceNo };
    const ada = await tx.systemSetting.findUnique({ where: { key: KUNCI_SIKLUS_PERTAMA }, select: { value: true } });
    const nilai = JSON.stringify({ bulan });
    await tx.systemSetting.upsert({ where: { key: KUNCI_SIKLUS_PERTAMA }, create: { key: KUNCI_SIKLUS_PERTAMA, value: nilai }, update: { value: nilai } });
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: JEJAK.KONSI_SIKLUS_PERTAMA,
      entityType: "SystemSetting",
      entityId: KUNCI_SIKLUS_PERTAMA,
      changes: { before: { bulan: bacaNilaiSiklusPertama(ada?.value) }, after: { bulan } },
    });
    return { ok: true as const };
  });
}

