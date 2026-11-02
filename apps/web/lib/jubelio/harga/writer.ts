import { runSerializable } from "@/lib/db/tx-retry";
import { createProductPushRow } from "@/lib/jubelio/product-push";
import {
  alasanTidakBisaDikirim,
  hargaBerlaku,
  hargaKeTeks,
  hargaSama,
  jenisMenunggu,
  keadaanHargaJubelio,
  JEJAK_HARGA_JUBELIO,
  type AlasanTidakBisaDikirim,
  type JenisMenunggu,
} from "./aturan";

/**
 * Keputusan di halaman Jubelio → Konfirmasi harga (keputusan pemilik 2026-11-02). Tanpa
 * `"use server"` dan tanpa pemeriksaan izin: aksinya (`app/actions/jubelio-harga.ts`) yang
 * memeriksa `jubelio_prices:confirm` dan memberi id pelakunya dari sesi.
 *
 * Setiap keputusan adalah satu baris di dalam `runSerializable`: barang, pemetaannya dan
 * kategorinya dibaca DI DALAM transaksi, dibandingkan dengan harga yang dilihat orangnya saat
 * halaman dibuka (compare-and-swap), lalu perubahan barang, jejak auditnya, dan kiriman produknya
 * ditulis bersama — atau tidak sama sekali. Baris yang hanya menyimpan keadaan terakhir; keputusan
 * yang tergantikan hanya hidup di jejak audit (JEJAK_HARGA_JUBELIO).
 */

const KOLOM_BARANG = {
  id: true,
  type: true,
  source: true,
  categoryId: true,
  sellingPrice: true,
  jubelioConfirmedPrice: true,
  jubelioCreateRequestedAt: true,
  jubelioCreateRequestedById: true,
} as const;

export type HasilKonfirmasiHarga =
  | { hasil: "DIKONFIRMASI"; jenis: JenisMenunggu; outboxId: string }
  | { hasil: "TIDAK_MENUNGGU" | "HARGA_BERUBAH" | AlasanTidakBisaDikirim | "TIDAK_DITEMUKAN" | "BUKAN_BARANG_JADI" };

/**
 * Menyetujui harga ERP sebagai harga Jubelio dan mengirimnya. Untuk produk baru (BARU),
 * pengajuannya sekaligus ditutup, dan kiriman yang diantrekan di sini yang membuatnya di Jubelio.
 */
export async function konfirmasiHargaJubelio(input: {
  itemId: string;
  hargaErpDiharapkan: string | null;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilKonfirmasiHarga> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilKonfirmasiHarga> => {
    const barang = await tx.item.findUnique({ where: { id: input.itemId }, select: KOLOM_BARANG });
    if (!barang) return { hasil: "TIDAK_DITEMUKAN" };
    if (barang.type !== "FINISHED_GOOD") return { hasil: "BUKAN_BARANG_JADI" };

    const terpetakan = (await tx.jubelioProductMapping.count({ where: { itemId: barang.id } })) > 0;
    const hargaErp = hargaKeTeks(barang.sellingPrice);
    const hargaJubelio = hargaKeTeks(barang.jubelioConfirmedPrice);
    const jenis = jenisMenunggu(
      keadaanHargaJubelio({
        barangJadi: true,
        sumber: barang.source,
        terpetakan,
        hargaErp,
        hargaJubelio,
        diajukanPada: barang.jubelioCreateRequestedAt,
      }),
    );
    if (!jenis) return { hasil: "TIDAK_MENUNGGU" };
    if (!hargaSama(hargaErp, input.hargaErpDiharapkan)) return { hasil: "HARGA_BERUBAH" };

    const kategoriTerpetakan = barang.categoryId
      ? (await tx.jubelioCategoryMapping.count({ where: { itemCategoryId: barang.categoryId } })) > 0
      : false;
    const alasan = alasanTidakBisaDikirim({ hargaErp, kategoriTerpetakan });
    if (alasan) return { hasil: alasan };

    await tx.item.update({
      where: { id: barang.id },
      data: {
        jubelioConfirmedPrice: barang.sellingPrice,
        jubelioConfirmedAt: sekarang,
        jubelioConfirmedById: input.olehUserId,
        jubelioCreateRequestedAt: null,
        jubelioCreateRequestedById: null,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_HARGA_JUBELIO.DIKONFIRMASI,
        entityType: "Item",
        entityId: barang.id,
        changes: {
          jenis,
          before: {
            jubelioConfirmedPrice: hargaJubelio,
            jubelioCreateRequestedAt: barang.jubelioCreateRequestedAt?.toISOString() ?? null,
            jubelioCreateRequestedById: barang.jubelioCreateRequestedById,
          },
          after: { jubelioConfirmedPrice: hargaErp, jubelioCreateRequestedAt: null },
          sellingPrice: hargaErp,
        },
      },
    });
    const kiriman = await createProductPushRow(tx, barang.id, input.olehUserId);
    return { hasil: "DIKONFIRMASI", jenis, outboxId: kiriman.id };
  });
}

export type HasilKembalikanHarga =
  | { hasil: "DIKEMBALIKAN"; outboxId: string }
  | { hasil: "HARGA_BERUBAH" | "SUDAH_SAMA" | "TIDAK_BISA_DIKEMBALIKAN" | "TIDAK_DITEMUKAN" };

/**
 * Perubahan harga yang tidak jadi: harga jual ERP dikembalikan ke harga Jubelio terkonfirmasi,
 * tercatat di riwayat harga jual (MANUAL_EDIT — perubahan harga oleh orang, seperti ketikan), dan
 * harga itu dikirim ulang ke Jubelio, yang sekaligus menyembuhkan selisih bila ada.
 */
export async function kembalikanHargaErp(input: {
  itemId: string;
  hargaErpDiharapkan: string | null;
  olehUserId: string;
}): Promise<HasilKembalikanHarga> {
  return runSerializable(async (tx): Promise<HasilKembalikanHarga> => {
    const barang = await tx.item.findUnique({ where: { id: input.itemId }, select: KOLOM_BARANG });
    if (!barang) return { hasil: "TIDAK_DITEMUKAN" };
    const hargaJubelio = hargaBerlaku(hargaKeTeks(barang.jubelioConfirmedPrice));
    const terpetakan = (await tx.jubelioProductMapping.count({ where: { itemId: barang.id } })) > 0;
    if (barang.type !== "FINISHED_GOOD" || !terpetakan || hargaJubelio == null || barang.jubelioConfirmedPrice == null) {
      return { hasil: "TIDAK_BISA_DIKEMBALIKAN" };
    }
    const hargaErp = hargaKeTeks(barang.sellingPrice);
    if (!hargaSama(hargaErp, input.hargaErpDiharapkan)) return { hasil: "HARGA_BERUBAH" };
    if (hargaSama(hargaBerlaku(hargaErp), hargaJubelio)) return { hasil: "SUDAH_SAMA" };

    await tx.item.update({ where: { id: barang.id }, data: { sellingPrice: barang.jubelioConfirmedPrice } });
    await tx.itemPriceChangeLog.create({
      data: {
        itemId: barang.id,
        oldSellingPrice: barang.sellingPrice,
        newSellingPrice: barang.jubelioConfirmedPrice,
        oldAvgCost: null,
        newAvgCost: null,
        marginPercentUsed: null,
        additionalCostUsed: null,
        triggerReason: "MANUAL_EDIT",
        fgReceiptId: null,
        changedById: input.olehUserId,
      },
    });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_HARGA_JUBELIO.DIKEMBALIKAN,
        entityType: "Item",
        entityId: barang.id,
        changes: { before: { sellingPrice: hargaErp }, after: { sellingPrice: hargaJubelio }, jubelioConfirmedPrice: hargaJubelio },
      },
    });
    const kiriman = await createProductPushRow(tx, barang.id, input.olehUserId);
    return { hasil: "DIKEMBALIKAN", outboxId: kiriman.id };
  });
}

export type HasilBatalkanPengajuan =
  | { hasil: "DIBATALKAN" }
  | { hasil: "PENGAJUAN_BERUBAH" | "SUDAH_TIDAK_DIAJUKAN" | "SUDAH_DI_JUBELIO" | "TIDAK_DITEMUKAN" };

/**
 * Produk baru yang tidak perlu dijual di marketplace: pengajuannya ditutup, barangnya keluar dari
 * daftar dan tidak dibuat di Jubelio. Token compare-and-swap-nya waktu pengajuan yang dilihat
 * orangnya, jadi pengajuan yang diperbarui sejak halaman dibuka tidak ikut terhapus.
 */
export async function batalkanPengajuanJubelio(input: {
  itemId: string;
  diajukanPadaDiharapkan: string;
  olehUserId: string;
}): Promise<HasilBatalkanPengajuan> {
  return runSerializable(async (tx): Promise<HasilBatalkanPengajuan> => {
    const barang = await tx.item.findUnique({ where: { id: input.itemId }, select: KOLOM_BARANG });
    if (!barang) return { hasil: "TIDAK_DITEMUKAN" };
    if ((await tx.jubelioProductMapping.count({ where: { itemId: barang.id } })) > 0) return { hasil: "SUDAH_DI_JUBELIO" };
    if (barang.jubelioCreateRequestedAt == null) return { hasil: "SUDAH_TIDAK_DIAJUKAN" };
    const diajukanPada = barang.jubelioCreateRequestedAt.toISOString();
    if (diajukanPada !== input.diajukanPadaDiharapkan) return { hasil: "PENGAJUAN_BERUBAH" };

    await tx.item.update({
      where: { id: barang.id },
      data: { jubelioCreateRequestedAt: null, jubelioCreateRequestedById: null },
    });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_HARGA_JUBELIO.PENGAJUAN_DIBATALKAN,
        entityType: "Item",
        entityId: barang.id,
        changes: {
          before: { jubelioCreateRequestedAt: diajukanPada, jubelioCreateRequestedById: barang.jubelioCreateRequestedById },
          after: { jubelioCreateRequestedAt: null, jubelioCreateRequestedById: null },
        },
      },
    });
    return { hasil: "DIBATALKAN" };
  });
}
