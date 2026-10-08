import { SUMBER_LAPANGAN } from "./aturan";

/*
 * Kait pasca-commit untuk aksi server — KHUSUS SERVER, TIDAK PERNAH MELEMPAR.
 * Dipanggil SESUDAH penulis dokumennya berhasil; jurnal yang gagal menjadi
 * `JOURNAL_PENDING`, tidak pernah menggagalkan aksinya.
 *
 * Yang menyentuh apa:
 * - nota terbit → jurnal nota;
 * - BKM diverifikasi/ditolak/dibatalkan/giro cair, potongan ditautkan ulang →
 *   jurnal BKM itu + jurnal retur setiap nota retur yang dipotongnya (yang sudah
 *   dipakai toko ikut menentukan jurnal retur);
 * - hitungan gudang dicatat/dijodohkan/dilepas/dipindah toko, beban selisih
 *   diputuskan/dialihkan → jurnal retur hitungan itu;
 * - tukar barang selesai → jurnal tukar.
 *
 * Mesin jurnalnya dimuat saat dipanggil (impor dinamis), bukan saat modul aksi
 * dimuat: aksi piutang/retur/pengiriman tetap bisa diuji dengan tiruan
 * `@elorae/db` yang tidak memuat seluruh klien, dan kegagalan memuat pun
 * tertangkap di sini seperti kegagalan lainnya.
 */

/**
 * Di bawah vitest kait ini MATI kecuali tesnya menyalakannya sendiri
 * (`JURNAL_LAPANGAN_KAIT_UJI=1`, atau `JURNAL_OPERASIONAL_KAIT_UJI=1` untuk tes
 * operasional yang ikut melewati retur toko): tes aksi lain (piutang, retur,
 * pengiriman) memanggil aksi aslinya terhadap basis data bersama, dan kait
 * yang menyala di sana memposting jurnal atau `JOURNAL_PENDING` untuk dokumen
 * yang lalu dihapus tesnya — sisa yang tidak dibersihkan siapa pun.
 */
function kaitMati(): boolean {
  if (!process.env.VITEST) return false;
  return process.env.JURNAL_LAPANGAN_KAIT_UJI !== "1" && process.env.JURNAL_OPERASIONAL_KAIT_UJI !== "1";
}

function aman(nama: string, fn: () => Promise<unknown>): Promise<void> {
  if (kaitMati()) return Promise.resolve();
  return fn().then(
    () => undefined,
    (e) => console.error(`[jurnal-lapangan] kait ${nama} gagal`, e),
  );
}

async function posting(sumber: (typeof SUMBER_LAPANGAN)[keyof typeof SUMBER_LAPANGAN], id: string, userId: string) {
  const { postingJurnalLapanganAman } = await import("./tertunda");
  return postingJurnalLapanganAman(sumber, id, userId);
}

export function kaitNotaTerbit(deliveryId: string, userId: string): Promise<void> {
  return aman("nota", () => posting(SUMBER_LAPANGAN.NOTA, deliveryId, userId));
}

export function kaitTukarSelesai(exchangeId: string, userId: string): Promise<void> {
  return aman("tukar", () => posting(SUMBER_LAPANGAN.TUKAR, exchangeId, userId));
}

/** Hitungan gudang (NRI) dari nota retur, beban, atau id hitungan langsung. */
export async function nriTersentuh(ref: { nriIds?: string[]; nrtIds?: string[]; chargeIds?: string[] }): Promise<string[]> {
  const { prisma } = await import("@elorae/db");
  const nri = new Set((ref.nriIds ?? []).filter(Boolean));
  const nrt = new Set((ref.nrtIds ?? []).filter(Boolean));
  const beban = (ref.chargeIds ?? []).filter(Boolean);
  if (beban.length > 0) {
    const rows = await prisma.returnCharge.findMany({ where: { id: { in: beban } }, select: { storeReturnId: true, warehouseReturnId: true } });
    for (const r of rows) {
      if (r.warehouseReturnId) nri.add(r.warehouseReturnId);
      if (r.storeReturnId) nrt.add(r.storeReturnId);
    }
  }
  if (nrt.size > 0) {
    const rows = await prisma.warehouseReturn.findMany({ where: { storeReturnId: { in: [...nrt] } }, select: { id: true } });
    for (const r of rows) nri.add(r.id);
  }
  return [...nri];
}

export function kaitReturBerubah(ref: { nriIds?: string[]; nrtIds?: string[]; chargeIds?: string[] }, userId: string): Promise<void> {
  return aman("retur", async () => {
    const nri = await nriTersentuh(ref);
    for (const id of nri) await posting(SUMBER_LAPANGAN.RETUR, id, userId);
    // Pasangannya: hitungan dari toko KONSINYASI dijurnal `lib/finance/operasional` (sasaran
    // lapangan untuk toko konsinyasi kosong, dan sebaliknya) — keduanya diselaraskan bersama,
    // jadi hitungan yang dipindah toko berpindah jurnal tanpa ada yang terlewat.
    const { kaitReturKonsi } = await import("@/lib/finance/operasional/kait");
    await kaitReturKonsi(nri, userId);
  });
}

/**
 * BKM berubah keadaan. `nrtIds` tambahan: nota retur yang tautannya baru saja
 * DILEPAS dari BKM ini (penautan ulang potongan) — tidak lagi terbaca dari BKM-nya.
 */
export function kaitKlaimBerubah(claimIds: string[], userId: string, opsi: { nrtIds?: string[] } = {}): Promise<void> {
  return aman("bkm", async () => {
    const { prisma } = await import("@elorae/db");
    const ids = [...new Set(claimIds.filter(Boolean))];
    for (const id of ids) await posting(SUMBER_LAPANGAN.BKM, id, userId);
    const potongan = ids.length
      ? await prisma.paymentClaimDeduction.findMany({ where: { paymentClaimId: { in: ids }, storeReturnId: { not: null } }, select: { storeReturnId: true } })
      : [];
    const nrtIds = [...potongan.map((p) => p.storeReturnId!), ...(opsi.nrtIds ?? [])];
    for (const nri of await nriTersentuh({ nrtIds })) await posting(SUMBER_LAPANGAN.RETUR, nri, userId);
  });
}

/**
 * Tautan potongan SEBELUM ditautkan ulang (BKM-nya dan nota retur lamanya).
 * Tidak pernah melempar: tanpa bacaan ini hanya nota lama yang tidak ikut
 * diselaraskan (sapuan/“Selaraskan” di layar rekonsiliasi menyusulkannya).
 */
export async function bacaTautanPotongan(deductionId: string): Promise<{ paymentClaimId: string; storeReturnId: string | null } | null> {
  try {
    const { prisma } = await import("@elorae/db");
    return await prisma.paymentClaimDeduction.findUnique({
      where: { id: deductionId },
      select: { paymentClaimId: true, storeReturnId: true },
    });
  } catch {
    return null;
  }
}
