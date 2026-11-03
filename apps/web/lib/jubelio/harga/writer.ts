import { runSerializable } from "@/lib/db/tx-retry";
import { createProductPushRow } from "@/lib/jubelio/product-push";
import {
  alasanTidakBisaDikirim,
  alasanTidakBisaDikirimUlang,
  bedaDiJubelio,
  hargaBerlaku,
  hargaKeTeks,
  hargaSama,
  jenisMenunggu,
  keadaanHargaJubelio,
  JEJAK_HARGA_JUBELIO,
  type AlasanTidakBisaDikirim,
  type AlasanTidakBisaDikirimUlang,
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
 *
 * Ketiga penulis di sini adalah KEPUTUSAN HARGA (jawaban pemilik P75, 2026-11-02): masing-masing
 * mencap `Item.jubelioPriceDecidedAt` di transaksinya sendiri bersama baris kirimannya. Selama harga
 * di Jubelio berbeda dengan ERP, apps/api hanya mengirim kalau ada keputusan yang diambil sesudah
 * bacaan Jubelio itu berubah; suntingan di Jubelio yang terbaca SESUDAH keputusan membatalkannya.
 */

const KOLOM_BARANG = {
  id: true,
  type: true,
  source: true,
  salesChannel: true,
  categoryId: true,
  sellingPrice: true,
  jubelioConfirmedPrice: true,
  jubelioCreateRequestedAt: true,
  jubelioCreateRequestedById: true,
  jubelioObservedPriceMax: true,
  jubelioObservedPriceMin: true,
  jubelioObservedAt: true,
  jubelioObservedChangedAt: true,
  jubelioPriceDecidedAt: true,
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
        saluran: barang.salesChannel,
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
        jubelioPriceDecidedAt: sekarang,
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
          // Yang ditimpa di Jubelio, bila bacaannya berbeda (P75: penimpaan hanya lewat keputusan).
          jubelioTerbaca: barang.jubelioObservedAt
            ? { tertinggi: hargaKeTeks(barang.jubelioObservedPriceMax), terendah: hargaKeTeks(barang.jubelioObservedPriceMin) }
            : null,
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
 * harga itu dikirim ulang ke Jubelio, yang sekaligus menyembuhkan selisih bila ada. "Toko offline
 * saja" tidak pernah menunggu konfirmasi, jadi tidak ada yang dikembalikan (P3a).
 */
export async function kembalikanHargaErp(input: {
  itemId: string;
  hargaErpDiharapkan: string | null;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilKembalikanHarga> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilKembalikanHarga> => {
    const barang = await tx.item.findUnique({ where: { id: input.itemId }, select: KOLOM_BARANG });
    if (!barang) return { hasil: "TIDAK_DITEMUKAN" };
    const hargaJubelio = hargaBerlaku(hargaKeTeks(barang.jubelioConfirmedPrice));
    const terpetakan = (await tx.jubelioProductMapping.count({ where: { itemId: barang.id } })) > 0;
    if (
      barang.type !== "FINISHED_GOOD" ||
      barang.salesChannel === "OFFLINE" ||
      !terpetakan ||
      hargaJubelio == null ||
      barang.jubelioConfirmedPrice == null
    ) {
      return { hasil: "TIDAK_BISA_DIKEMBALIKAN" };
    }
    const hargaErp = hargaKeTeks(barang.sellingPrice);
    if (!hargaSama(hargaErp, input.hargaErpDiharapkan)) return { hasil: "HARGA_BERUBAH" };
    if (hargaSama(hargaBerlaku(hargaErp), hargaJubelio)) return { hasil: "SUDAH_SAMA" };

    await tx.item.update({
      where: { id: barang.id },
      data: { sellingPrice: barang.jubelioConfirmedPrice, jubelioPriceDecidedAt: sekarang },
    });
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
        changes: {
          before: { sellingPrice: hargaErp },
          after: { sellingPrice: hargaJubelio },
          jubelioConfirmedPrice: hargaJubelio,
          jubelioTerbaca: barang.jubelioObservedAt
            ? { tertinggi: hargaKeTeks(barang.jubelioObservedPriceMax), terendah: hargaKeTeks(barang.jubelioObservedPriceMin) }
            : null,
        },
      },
    });
    const kiriman = await createProductPushRow(tx, barang.id, input.olehUserId);
    return { hasil: "DIKEMBALIKAN", outboxId: kiriman.id };
  });
}

export type HasilKirimUlang =
  | { hasil: "DIKIRIM_ULANG"; outboxId: string }
  | { hasil: "TIDAK_BEDA" | "TERBACA_BERUBAH" | AlasanTidakBisaDikirimUlang | "TIDAK_DITEMUKAN" };

/**
 * "Kirim ulang harga ERP" — satu-satunya jalan keluar "Harga di Jubelio berbeda dengan ERP" (jawaban
 * pemilik P74, 2026-11-02): harga ERP TERKONFIRMASI dikirim ulang ke Jubelio dan menimpa harga yang
 * terbaca di sana. Ini keputusan harga (P75): dicap `jubelioPriceDecidedAt`, dicatat di jejak audit
 * (`JUBELIO_PRICE_RESENT`, sebelum = yang terbaca di Jubelio, sesudah = harga terkonfirmasi), dan
 * kirimannya dibuat di transaksi yang sama.
 *
 * Compare-and-swap pada waktu bacaan Jubelio berubah yang dilihat halaman: kalau Jubelio berubah
 * lagi sejak halaman dibuka, ditolak (`TERBACA_BERUBAH`) — orangnya harus melihat angka barunya
 * dulu. Tidak pernah menulis `sellingPrice` atau `jubelioConfirmedPrice`. Barang "Toko offline
 * saja" yang sudah di Jubelio boleh: kirimannya mengirim ulang penonaktifan dengan harga
 * terkonfirmasi (P72).
 */
export async function kirimUlangHargaJubelio(input: {
  itemId: string;
  /** ISO `jubelioObservedChangedAt` yang ditampilkan halaman; null bila halaman tidak punya waktunya. */
  berubahPadaDiharapkan: string | null;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilKirimUlang> {
  const sekarang = input.sekarang ?? new Date();
  return runSerializable(async (tx): Promise<HasilKirimUlang> => {
    const barang = await tx.item.findUnique({ where: { id: input.itemId }, select: KOLOM_BARANG });
    if (!barang) return { hasil: "TIDAK_DITEMUKAN" };

    const [jumlahPemetaan, jumlahDikirim] = await Promise.all([
      tx.jubelioProductMapping.count({ where: { itemId: barang.id } }),
      tx.jubelioOutbox.count({
        where: { entityType: "product_push", entityId: barang.id, status: { in: ["PENDING", "PROCESSING"] } },
      }),
    ]);
    const hargaTerkonfirmasi = hargaKeTeks(barang.jubelioConfirmedPrice);
    const jubelioTertinggi = hargaKeTeks(barang.jubelioObservedPriceMax);
    const jubelioTerendah = hargaKeTeks(barang.jubelioObservedPriceMin);
    const beda = bedaDiJubelio({
      barangJadi: barang.type === "FINISHED_GOOD",
      terpetakan: jumlahPemetaan > 0,
      terbacaPada: barang.jubelioObservedAt,
      jubelioTertinggi,
      jubelioTerendah,
      hargaTerkonfirmasi,
      diputuskanPada: barang.jubelioPriceDecidedAt,
      berubahPada: barang.jubelioObservedChangedAt,
      sedangDikirim: jumlahDikirim > 0,
    });
    if (!beda) return { hasil: "TIDAK_BEDA" };
    const berubahPada = barang.jubelioObservedChangedAt?.toISOString() ?? null;
    if (berubahPada !== input.berubahPadaDiharapkan) return { hasil: "TERBACA_BERUBAH" };

    const kategoriTerpetakan = barang.categoryId
      ? (await tx.jubelioCategoryMapping.count({ where: { itemCategoryId: barang.categoryId } })) > 0
      : false;
    const hargaErp = hargaKeTeks(barang.sellingPrice);
    const menungguKonfirmasi =
      barang.salesChannel !== "OFFLINE" && !hargaSama(hargaBerlaku(hargaErp), hargaBerlaku(hargaTerkonfirmasi));
    const alasan = alasanTidakBisaDikirimUlang({
      hargaTerkonfirmasi,
      kategoriTerpetakan,
      menungguKonfirmasi,
      hargaErp,
      jubelioTertinggi,
      jubelioTerendah,
    });
    if (alasan) return { hasil: alasan };

    await tx.item.update({ where: { id: barang.id }, data: { jubelioPriceDecidedAt: sekarang } });
    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_HARGA_JUBELIO.DIKIRIM_ULANG,
        entityType: "Item",
        entityId: barang.id,
        changes: {
          before: { jubelioTertinggi, jubelioTerendah },
          after: { jubelioConfirmedPrice: hargaTerkonfirmasi },
          berubahPada,
          ...(barang.salesChannel === "OFFLINE" ? { saluran: "OFFLINE", kiriman: "NONAKTIFKAN" } : {}),
        },
      },
    });
    const kiriman = await createProductPushRow(tx, barang.id, input.olehUserId);
    return { hasil: "DIKIRIM_ULANG", outboxId: kiriman.id };
  });
}
