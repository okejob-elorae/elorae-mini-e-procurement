import { prisma, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { lingkupPindah, type LingkupPindah } from "./penanggung-jawab";

/**
 * Penulis rotasi sales penanggung jawab toko.
 *
 * Kolom `Store.salesmanId` hanya menyimpan pemegang TERAKHIR. Riwayat siapa
 * memegang toko mana, kapan, dan dipindah siapa hanya hidup di `AuditLog` —
 * jadi setiap perpindahan menulis jejaknya di transaksi yang sama.
 */

export const AKSI_PINDAH_TOKO = "STORE_SALESMAN_CHANGED";

/**
 * Pindahkan semua toko dalam satu lingkup (area, pemegang sekarang, atau toko
 * terpilih) ke satu sales — atau kosongkan pemegangnya (`null`).
 *
 * Toko yang sudah dipegang tujuan dilewati, supaya jejaknya hanya berisi
 * perpindahan yang sungguh terjadi. Penyaringan itu di kode, bukan di kueri:
 * `NOT { salesmanId: x }` di SQL ikut membuang toko yang pemegangnya NULL.
 *
 * Mengosongkan pemegang ditolak SELURUHNYA (`KONSI_WAJIB_PEMEGANG`, tanpa satu
 * pun penulisan) kalau lingkupnya memuat toko KONSI yang akan ikut kosong:
 * toko konsi pasti punya salesman pemegang (pemilik P47, 2026-11-02), yang
 * sendirian melihat dan menagih tagihan konsinya (P31).
 *
 * Penjaga itu "baca `termsType`, lalu tulis" — maka seluruhnya di dalam
 * `runSerializable`. Di transaksi biasa, formulir toko (`updateStore`) yang
 * mengubah toko dalam lingkup menjadi KONSI bisa tersimpan di antara bacaan dan
 * `updateMany`, dan pengosongan ini lalu menimpa pemegangnya: toko KONSI tanpa
 * pemegang. Di bawah serializable salah satunya diulang dan membaca keadaan
 * yang lain.
 */
export async function pindahkanToko(input: {
  lingkup: LingkupPindah;
  keSalesmanId: string | null;
  olehUserId: string;
}): Promise<
  | { ok: true; jumlah: number }
  | { ok: false; alasan: "LINGKUP_KOSONG" | "SALES_TIDAK_DITEMUKAN" | "KONSI_WAJIB_PEMEGANG" }
> {
  const l = lingkupPindah(input.lingkup);
  if (!l.ok) return l;
  if (input.keSalesmanId) {
    const ada = await prisma.user.count({ where: { id: input.keSalesmanId } });
    if (!ada) return { ok: false, alasan: "SALES_TIDAK_DITEMUKAN" };
  }

  return runSerializable(async (tx) => {
    const toko = await tx.store.findMany({ where: l.where, select: { id: true, salesmanId: true, termsType: true } });
    const pindah = toko.filter((s) => s.salesmanId !== input.keSalesmanId);
    if (pindah.length === 0) return { ok: true as const, jumlah: 0 };
    if (input.keSalesmanId === null && pindah.some((s) => s.termsType === "KONSI")) {
      return { ok: false as const, alasan: "KONSI_WAJIB_PEMEGANG" as const };
    }

    await tx.store.updateMany({
      where: { id: { in: pindah.map((s) => s.id) } },
      data: { salesmanId: input.keSalesmanId },
    });
    await tx.auditLog.createMany({
      data: pindah.map((s) => ({
        userId: input.olehUserId,
        action: AKSI_PINDAH_TOKO,
        entityType: "Store",
        entityId: s.id,
        changes: { before: { salesmanId: s.salesmanId }, after: { salesmanId: input.keSalesmanId } },
        metadata: { lingkup: input.lingkup },
      })),
    });
    return { ok: true as const, jumlah: pindah.length };
  });
}

/**
 * Jejak perubahan pemegang satu toko, dari formulir toko. Dipanggil di dalam
 * transaksi penyimpanan formulir; tidak menulis apa pun bila tidak berubah.
 */
export async function gantiPemegangToko(
  tx: Prisma.TransactionClient,
  input: { storeId: string; sebelum: string | null; sesudah: string | null; olehUserId: string },
): Promise<void> {
  if (input.sebelum === input.sesudah) return;
  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: AKSI_PINDAH_TOKO,
      entityType: "Store",
      entityId: input.storeId,
      changes: { before: { salesmanId: input.sebelum }, after: { salesmanId: input.sesudah } },
      metadata: { lingkup: { storeIds: [input.storeId] } },
    },
  });
}
