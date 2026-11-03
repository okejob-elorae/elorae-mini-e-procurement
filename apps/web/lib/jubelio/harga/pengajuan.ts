import { runSerializable } from "@/lib/db/tx-retry";

/**
 * Pengajuan produk baru ke Jubelio (keputusan pemilik 2026-11-02).
 *
 * Membuat produk di Jubelio adalah PENGAJUAN, bukan kiriman: formulir barang dan impor barang
 * (barang jadi yang dicentang "Marketplace", saja atau keduanya — jawaban pemilik P3, 2026-11-02),
 * centang "Marketplace" yang ditambahkan ke barang "Toko offline saja", tombol "Ajukan ke Jubelio"
 * di halaman barang, dan migrasi massal hanya menandai barangnya
 * (`Item.jubelioCreateRequestedAt/ById`). Barangnya lalu menunggu di Jubelio → Konfirmasi harga
 * sebagai "Belum di Jubelio — menunggu konfirmasi harga", dan baru dibuat di Jubelio saat harganya
 * dikonfirmasi (`konfirmasiHargaJubelio` di writer.ts). Barang "Toko offline saja" tidak pernah
 * diajukan (P3a).
 */

/** Disebar ke data `item.create` di transaksi pembuatnya, supaya pengajuan lahir bersama barangnya. */
export function dataPengajuanJubelio(
  olehUserId: string | null,
  sekarang: Date = new Date(),
): { jubelioCreateRequestedAt: Date; jubelioCreateRequestedById: string | null } {
  return { jubelioCreateRequestedAt: sekarang, jubelioCreateRequestedById: olehUserId };
}

export type HasilPengajuanJubelio =
  | "DIAJUKAN"
  | "SUDAH_DIAJUKAN"
  | "SEDANG_DIKIRIM"
  | "SUDAH_DI_JUBELIO"
  | "BUKAN_BARANG_JADI_ERP"
  | "SALURAN_OFFLINE"
  | "TIDAK_DITEMUKAN";

/**
 * Mengajukan barang yang sudah ada. Satu transaksi serializable: barang, pemetaannya, dan kiriman
 * produk yang masih PENDING/PROCESSING dibaca di dalamnya, lalu hanya yang lolos yang ditandai.
 *
 * Kiriman yang masih berjalan ditolak (`SEDANG_DIKIRIM`): sesudah sebuah produk baru dikonfirmasi,
 * kiriman pembuatnya sedang menunggu diproses, dan tanda pengajuan baru akan membuat handler
 * melewatinya — klik ganda tepat sesudah konfirmasi tidak boleh menahan produknya.
 * `updateMany` di bawah menulis daftar id yang diputuskan di transaksi ini, bukan penjaga
 * hitung-ulang; dua pengajuan bersamaan saling mengunci baris yang sama dan yang kalah diulang
 * `runSerializable`, lalu membaca tanda yang sudah ada (`SUDAH_DIAJUKAN`).
 */
export async function ajukanKeJubelio(
  itemIds: string[],
  olehUserId: string,
): Promise<Array<{ itemId: string; hasil: HasilPengajuanJubelio }>> {
  const unik = [...new Set(itemIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unik.length === 0) return [];
  return runSerializable(async (tx) => {
    const barang = await tx.item.findMany({
      where: { id: { in: unik } },
      select: { id: true, type: true, source: true, salesChannel: true, jubelioCreateRequestedAt: true },
    });
    const terpetakan = new Set(
      (
        await tx.jubelioProductMapping.findMany({
          where: { itemId: { in: unik } },
          select: { itemId: true },
        })
      ).map((m) => m.itemId),
    );
    const sedangDikirim = new Set(
      (
        await tx.jubelioOutbox.findMany({
          where: { entityType: "product_push", entityId: { in: unik }, status: { in: ["PENDING", "PROCESSING"] } },
          select: { entityId: true },
        })
      ).map((r) => r.entityId),
    );
    const perId = new Map(barang.map((b) => [b.id, b]));

    const hasil = unik.map((itemId): { itemId: string; hasil: HasilPengajuanJubelio } => {
      const b = perId.get(itemId);
      if (!b) return { itemId, hasil: "TIDAK_DITEMUKAN" };
      if (b.type !== "FINISHED_GOOD" || b.source !== "ERP") return { itemId, hasil: "BUKAN_BARANG_JADI_ERP" };
      if (b.salesChannel === "OFFLINE") return { itemId, hasil: "SALURAN_OFFLINE" };
      if (terpetakan.has(itemId)) return { itemId, hasil: "SUDAH_DI_JUBELIO" };
      if (b.jubelioCreateRequestedAt != null) return { itemId, hasil: "SUDAH_DIAJUKAN" };
      if (sedangDikirim.has(itemId)) return { itemId, hasil: "SEDANG_DIKIRIM" };
      return { itemId, hasil: "DIAJUKAN" };
    });

    const diajukan = hasil.filter((h) => h.hasil === "DIAJUKAN").map((h) => h.itemId);
    if (diajukan.length > 0) {
      await tx.item.updateMany({ where: { id: { in: diajukan } }, data: dataPengajuanJubelio(olehUserId) });
    }
    return hasil;
  });
}
