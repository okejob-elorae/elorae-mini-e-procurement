import { prisma } from "@elorae/db";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { NOTIFICATION_TEXT_MAX } from "@/lib/notifications/text";
import { dariMutasi, type JenisKiriman } from "./kiriman";
import { bagianKurangPerjalanan, rangkaiDalamBatas, type InfoAntaran } from "./antaran";
import { muatInfoAntaran } from "./antaran-queries";
import { adaSelisih, teksSelisih, type SelisihTerima } from "./selisih-terima";

/**
 * Hasil terima kiriman yang tidak pas (kurang atau rusak) → salesman yang
 * mengirim. Tanpa ini salesman baru tahu saat toko menolak membayar.
 *
 * - PUTUS_DELIVERY : salesman pesanan pengiriman itu.
 * - KONSI_TRANSFER : salesman pesanan konsi antaran itu.
 * - KONSI_ORDER    : salesman pesanan konsi (lama) itu.
 * - KONSI_SHIPMENT : pemegang toko (`Store.salesmanId`), bila ada.
 *
 * Kiriman yang dibawa sebuah pengiriman (antaran) yang tiba KURANG menyebut
 * di mana harus dicek: pengantar/ekspedisi + resinya, berapa yang dikirim
 * gudang di antaran itu dan berapa yang tiba (`bagianKurangPerjalanan`). Isi
 * kabar dipotong di 191 huruf (`NOTIFICATION_TEXT_MAX`, kolom
 * `NotificationQueue.body`), jadi siapa-yang-dicek ditaruh paling depan dan
 * bagian yang tidak muat dilewati utuh (`rangkaiDalamBatas`) — resinya tidak
 * pernah yang terpotong. Sisa pesanan yang belum dikirim gudang tidak pernah
 * ada di kiriman, jadi tidak pernah terbaca kurang.
 * - Mutasi antar toko TIDAK lewat sini — pembuat mutasi sudah dikabari
 *   (`MUTASI_DITERIMA`) dan selisihnya diputuskan kantor.
 *
 * Isi kabar hanya potong, tidak pernah rupiah: harga konsinyasi tidak boleh
 * sampai ke HP salesman.
 *
 * Dipanggil penulis SESUDAH transaksinya, sekali per tanda terima yang BARU
 * dibuat — kiriman ulang dengan kunci yang sama tidak sampai ke sini.
 */

export function susunKabarSelisih(k: {
  sourceType: JenisKiriman;
  sourceId: string;
  storeId: string;
  docNo: string;
  namaToko: string;
  /** Pesanan yang ditautkan kabar; null untuk titipan konsinyasi (ke halaman toko). */
  orderId: string | null;
  selisih: SelisihTerima;
  /** Antaran yang membawa kiriman ini, bila ada — menambah kalimat "kurang di perjalanan". */
  antaran?: InfoAntaran | null;
}): Kabar {
  const teks = teksSelisih(k.selisih);
  const perjalanan = bagianKurangPerjalanan(k.selisih, k.antaran ?? null);
  const isi = perjalanan
    ? rangkaiDalamBatas(
        [
          perjalanan.cek,
          [
            `${k.namaToko}: tiba ${k.selisih.diterima} dari ${k.selisih.dikirim} pcs yang dikirim gudang di ${perjalanan.docNo}.`,
            perjalanan.rincian,
          ],
          k.selisih.rusak > 0 ? `Rusak ${k.selisih.rusak} pcs.` : null,
          perjalanan.bukti,
        ],
        NOTIFICATION_TEXT_MAX,
      )
    : `${k.namaToko}: tiba ${k.selisih.diterima} dari ${k.selisih.dikirim} pcs — ${teks}.`;
  return {
    jenis: JENIS_KABAR.KIRIMAN_DITERIMA_SELISIH,
    judul: `Kiriman ${k.docNo}: ${teks}`,
    isi,
    data: {
      ...(k.orderId ? { orderId: k.orderId } : {}),
      storeId: k.storeId,
      sourceType: k.sourceType,
      sourceId: k.sourceId,
    },
  };
}

/** Siapa yang mengirim kiriman ini (lihat daftar di atas), dan pesanannya bila ada. */
export async function pengirimKiriman(
  sourceType: JenisKiriman,
  sourceId: string,
  storeId: string,
): Promise<{ userId: string | null; orderId: string | null }> {
  if (sourceType === "PUTUS_DELIVERY") {
    const d = await prisma.fieldSalesDelivery.findFirst({
      where: { id: sourceId, order: { storeId } },
      select: { order: { select: { id: true, salesmanId: true } } },
    });
    return { userId: d?.order.salesmanId ?? null, orderId: d?.order.id ?? null };
  }
  if (sourceType === "KONSI_TRANSFER") {
    const t = await prisma.konsiTransfer.findFirst({
      where: { id: sourceId, storeId },
      select: { order: { select: { id: true, salesmanId: true } } },
    });
    return { userId: t?.order.salesmanId ?? null, orderId: t?.order.id ?? null };
  }
  if (sourceType === "KONSI_ORDER") {
    const o = await prisma.fieldSalesOrder.findFirst({ where: { id: sourceId, storeId }, select: { id: true, salesmanId: true } });
    return { userId: o?.salesmanId ?? null, orderId: o?.id ?? null };
  }
  if (sourceType === "KONSI_SHIPMENT") {
    const s = await prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } });
    return { userId: s?.salesmanId ?? null, orderId: null };
  }
  return { userId: null, orderId: null };
}

/**
 * Kirim kabarnya. Tidak pernah melempar: kabar yang gagal tidak boleh
 * membuat SPG mengira penerimaannya gagal — tanda terimanya sudah tercatat.
 * Mengembalikan penerimanya (null = tidak ada yang dikabari) untuk tes.
 */
export async function kabarkanSelisihTerima(input: {
  sourceType: JenisKiriman;
  sourceId: string;
  storeId: string;
  docNo: string;
  selisih: SelisihTerima;
  /** SPG yang menerima — tidak pernah mengabari dirinya sendiri. */
  penerimaId?: string | null;
}): Promise<{ penerima: string | null }> {
  if (dariMutasi(input.sourceType) || !adaSelisih(input.selisih)) return { penerima: null };
  try {
    const [pengirim, toko, antaran] = await Promise.all([
      pengirimKiriman(input.sourceType, input.sourceId, input.storeId),
      prisma.store.findUnique({ where: { id: input.storeId }, select: { name: true } }),
      // Rincian tambahan saja: kalau gagal dibaca, kabar kekurangannya tetap terkirim (tanpa kalimat antaran).
      input.selisih.kurang > 0
        ? muatInfoAntaran(prisma, input.storeId, input.sourceType, input.sourceId).catch((err) => {
            console.error("kabarkanSelisihTerima: antaran tidak terbaca", input.sourceType, input.sourceId, err);
            return null;
          })
        : Promise.resolve(null),
    ]);
    if (!pengirim.userId || pengirim.userId === input.penerimaId) return { penerima: null };
    await kabariPengguna(
      pengirim.userId,
      susunKabarSelisih({ ...input, namaToko: toko?.name ?? "Toko", orderId: pengirim.orderId, antaran }),
    );
    return { penerima: pengirim.userId };
  } catch (err) {
    console.error("kabarkanSelisihTerima gagal", input.sourceType, input.sourceId, err);
    return { penerima: null };
  }
}
