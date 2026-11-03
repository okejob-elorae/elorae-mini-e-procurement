import { Prisma, prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { isR2KeyInFolder } from "@/lib/r2-key";
import { jumlahSpgToko } from "./kiriman";
import {
  alasanGalatPenerimaan,
  sebarSesudahTerima,
  sesudahTerimaKosong,
  terimaKirimanDalamTx,
  type HasilTerimaKiriman,
} from "./stok-writer";

/**
 * Penerimaan kiriman gudang oleh SALESMAN PEMEGANG toko, untuk toko yang SPG-nya sudah BERHENTI
 * sementara barangnya belum diterima (P45/P45a, "benar"): penanggung jawab toko yang menerima,
 * salesman pemegang mencatatnya saat berkunjung, dengan nama penanggung jawab itu dan satu foto.
 *
 * Boleh hanya bila (R12): pengguna ini pemegang toko (`Store.salesmanId`), sedang check-in di toko
 * itu, toko itu kini TANPA SPG (SPG yang hanya tidak masuk tetap ditugaskan — P26: tidak ada yang
 * menerima atas namanya), pengirimannya sudah DISERAHKAN ke toko (DELIVERED/PARTIALLY_DELIVERED —
 * yang masih di jalan diterima lewat konfirmasi ekspedisi/kurir, yang di toko tanpa SPG sekaligus
 * penerimaan toko dan bisa mencatat retur langsung; dikemas atau di jalan → BELUM_DISERAHKAN), dan
 * toko belum menerimanya. Nota yang dicatat tangan tanpa pengiriman tidak pernah lewat sini. Per
 * baris hanya TIBA (penuh/kurang) — kurirnya sudah pergi, jadi tidak ada "ditolak"; barang rusak di
 * toko tanpa SPG belum punya jalur (pertanyaan pemilik). Yang tidak tiba adalah barang hilang,
 * dibuka di transaksi penerimaannya sendiri.
 *
 * Foto WAJIB dan terikat pada DOKUMEN ini: kuncinya harus di
 * `store-receipt-photos/<storeId>/<sourceType>-<sourceId>/…` dan belum dipakai tanda terima lain —
 * satu foto tidak bisa menjadi bukti dua penerimaan.
 */

export const FOLDER_FOTO_TERIMA_TOKO = "store-receipt-photos";

/** Folder R2 foto penerimaan satu dokumen di satu toko (rute unggahnya menulis ke sini). */
export function folderFotoTerimaToko(storeId: string, sourceType: string, sourceId: string): string {
  return `${FOLDER_FOTO_TERIMA_TOKO}/${storeId}/${sourceType}-${sourceId}`;
}

/** Nama penanggung jawab toko: dirapikan, 2–100 huruf; selain itu null. */
export function rapikanNamaPj(v: unknown): string | null {
  const rapi = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  const panjang = Array.from(rapi).length;
  return panjang >= 2 && panjang <= 100 ? rapi : null;
}

export async function terimaKirimanPemegang(input: {
  storeId: string;
  userId: string;
  sourceType: "KONSI_TRANSFER" | "PUTUS_DELIVERY";
  sourceId: string;
  diterima: Array<{ lineId: string; qtyReceived: number }>;
  picName: unknown;
  photoUrl: string;
  photoR2Key: string;
  idempotencyKey: string;
  sekarang?: Date;
}): Promise<HasilTerimaKiriman> {
  const namaPj = rapikanNamaPj(input.picName);
  if (!namaPj) return { ok: false, alasan: "NAMA_PJ_WAJIB" };
  const fotoUrl = typeof input.photoUrl === "string" ? input.photoUrl.trim() : "";
  if (!fotoUrl || !isR2KeyInFolder(input.photoR2Key, folderFotoTerimaToko(input.storeId, input.sourceType, input.sourceId))) {
    return { ok: false, alasan: "FOTO_WAJIB" };
  }
  const kunci = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!kunci || kunci.length > 64) return { ok: false, alasan: "JUMLAH_TIDAK_VALID" };

  const sesudah = sesudahTerimaKosong();
  let hasil: HasilTerimaKiriman;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilTerimaKiriman> => {
      const ada = await tx.storeReceipt.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, storeId: true } });
      if (ada) return ada.storeId === input.storeId ? { ok: true, receiptId: ada.id } : { ok: false, alasan: "KUNCI_DIPAKAI" };

      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { salesmanId: true } });
      if (!toko || toko.salesmanId !== input.userId) return { ok: false, alasan: "BUKAN_PEMEGANG" };
      const kunjungan = await tx.storeVisit.findFirst({
        where: { storeId: input.storeId, userId: input.userId, checkoutAt: null },
        select: { id: true },
      });
      if (!kunjungan) return { ok: false, alasan: "TANPA_KUNJUNGAN" };
      if ((await jumlahSpgToko(tx, input.storeId)) > 0) return { ok: false, alasan: "TOKO_PUNYA_SPG" };

      // Pengirimannya harus sudah DISERAHKAN (dikonfirmasi ekspedisi/kurir) — R12.
      // Dokumen yang tidak ada dan pengiriman yang dibatalkan dijawab `terimaKirimanDalamTx` sendiri.
      const dok =
        input.sourceType === "KONSI_TRANSFER"
          ? await tx.konsiTransfer.findFirst({ where: { id: input.sourceId, storeId: input.storeId }, select: { shipment: { select: { status: true } } } })
          : await tx.fieldSalesDelivery.findFirst({ where: { id: input.sourceId, order: { storeId: input.storeId } }, select: { shipment: { select: { status: true } } } });
      const status = dok?.shipment?.status ?? null;
      if (dok && status !== "DELIVERED" && status !== "PARTIALLY_DELIVERED" && status !== "CANCELLED") {
        return { ok: false, alasan: "BELUM_DISERAHKAN" };
      }

      // Satu foto, satu penerimaan.
      const fotoDipakai = await tx.storeReceipt.findFirst({ where: { photoR2Key: input.photoR2Key }, select: { id: true } });
      if (fotoDipakai) return { ok: false, alasan: "FOTO_WAJIB" };

      return terimaKirimanDalamTx(
        tx,
        {
          storeId: input.storeId,
          userId: input.userId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          diterima: input.diterima.map((d) => ({ lineId: d.lineId, qtyReceived: d.qtyReceived })),
          oleh: "SALESMAN",
          picName: namaPj,
          photo: { url: fotoUrl, r2Key: input.photoR2Key },
          sekarang: input.sekarang,
        },
        sesudah,
        { kunci, waktuTangkap: null },
      );
    });
  } catch (err) {
    // Dua penerimaan bersamaan atas dokumen yang sama: yang kalah membaca hasil pemenangnya.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const ada = await prisma.storeReceipt.findUnique({ where: { idempotencyKey: kunci }, select: { id: true, storeId: true } });
      if (ada && ada.storeId === input.storeId) return { ok: true, receiptId: ada.id };
      return { ok: false, alasan: "SUDAH_DITERIMA" };
    }
    const alasan = alasanGalatPenerimaan(err);
    if (alasan) return { ok: false, alasan };
    throw err;
  }
  if (hasil.ok) {
    await sebarSesudahTerima({
      storeId: input.storeId,
      userId: input.userId,
      sourceType: input.sourceType,
      receiptId: hasil.receiptId,
      sesudah,
    });
  }
  return hasil;
}
