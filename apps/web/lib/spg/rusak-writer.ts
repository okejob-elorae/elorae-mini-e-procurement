import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna } from "@/lib/notifications/kabar-pengguna";
import { bukuDimulai } from "./mutasi-terima";
import { ENTITAS_RUSAK, JEJAK_RUSAK, bacaKeputusanRusak, jenisGerakLayakJual, rapikanTeksRusak, type KeputusanRusak } from "./rusak";
import { kabariTitipanTersedia } from "./titip-tersedia";

/**
 * Gudang memutuskan nasib barang rusak yang dicatat SPG saat menerima kiriman.
 *
 * Penjaganya `damageStatus = TERBUKA`, dibandingkan-lalu-ditukar DI DALAM
 * transaksi serializable (Prisma `updateMany` sendiri bukan CAS): dua orang
 * gudang yang menekan bersamaan tidak bisa sama-sama memutuskan.
 *
 * - `LAYAK_JUAL`: barangnya masuk buku stok toko sebesar `qtyDamaged`, dengan
 *   jenis yang sama dengan penerimaannya (TERIMA / MUTASI_MASUK), `refType`
 *   `StoreReceiptLine`. Hanya bila buku toko sudah dimulai dan barisnya barang
 *   katalog — toko tanpa buku mendapat angka pertamanya dari opname.
 * - `KEMBALI_GUDANG` dan `DIHAPUSKAN`: tidak ada gerakan barang di sini.
 *
 * Jejak `STORE_RECEIPT_DAMAGE_DECIDED` ditulis di transaksi yang sama; SPG yang
 * menerima diberi kabar sesudahnya.
 */

export type AlasanTolakRusak = "KEPUTUSAN_TIDAK_SAH" | "CATATAN_WAJIB" | "TIDAK_DITEMUKAN" | "SUDAH_DIPUTUSKAN";

export type HasilPutuskanRusak = { ok: true; receiptId: string; bukuDitulis: boolean } | { ok: false; alasan: AlasanTolakRusak };

type Kabar = { userId: string; receiptId: string; docNo: string; productName: string; qty: number; keputusan: KeputusanRusak; catatan: string };

export async function putuskanBarangRusak(input: {
  lineId: string;
  keputusan: unknown;
  catatan: unknown;
  olehUserId: string;
  sekarang?: Date;
}): Promise<HasilPutuskanRusak> {
  const keputusan = bacaKeputusanRusak(input.keputusan);
  if (!keputusan) return { ok: false, alasan: "KEPUTUSAN_TIDAK_SAH" };
  const catatan = rapikanTeksRusak(input.catatan);
  if (!catatan) return { ok: false, alasan: "CATATAN_WAJIB" };
  const sekarang = input.sekarang ?? new Date();

  // Diisi di dalam transaksi; percobaan ulang menyetelnya ulang.
  const sesudah: { kabar: Kabar | null; tokoTitipan: string | null } = { kabar: null, tokoTitipan: null };

  const hasil = await runSerializable(async (tx): Promise<HasilPutuskanRusak> => {
    sesudah.kabar = null;
    sesudah.tokoTitipan = null;

    const baris = await tx.storeReceiptLine.findUnique({
      where: { id: input.lineId },
      select: {
        id: true,
        itemId: true,
        variantSku: true,
        productName: true,
        qtyDamaged: true,
        damageStatus: true,
        receipt: { select: { id: true, storeId: true, sourceType: true, sourceDocNo: true, receivedById: true, receivedAt: true } },
      },
    });
    if (!baris || baris.qtyDamaged <= 0) return { ok: false, alasan: "TIDAK_DITEMUKAN" };
    if (baris.damageStatus !== "TERBUKA") return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };

    const r = await tx.storeReceiptLine.updateMany({
      where: { id: baris.id, damageStatus: "TERBUKA" },
      data: { damageStatus: keputusan, damageDecidedById: input.olehUserId, damageDecidedAt: sekarang, damageDecisionNote: catatan },
    });
    if (r.count !== 1) return { ok: false, alasan: "SUDAH_DIPUTUSKAN" };

    const storeId = baris.receipt.storeId;
    let bukuDitulis = false;
    if (keputusan === "LAYAK_JUAL" && baris.itemId && (await bukuDimulai(tx, storeId))) {
      await tx.storeStockMovement.create({
        data: {
          storeId,
          itemId: baris.itemId,
          variantSku: baris.variantSku,
          qty: baris.qtyDamaged,
          kind: jenisGerakLayakJual(baris.receipt.sourceType),
          refType: ENTITAS_RUSAK,
          refId: baris.id,
          createdById: input.olehUserId,
          createdAt: sekarang,
        },
      });
      bukuDitulis = true;
    }

    // Opname sesudah barang tiba: kalau SPG ikut menghitung barang rusak itu di
    // rak, masuknya sekarang menghitungnya dua kali. Tidak ditolak (barang rusak
    // biasanya disisihkan), tapi dicatat supaya kantor bisa menanyakannya.
    const opnameSesudah = bukuDitulis
      ? await tx.storeOpname.findFirst({
          where: { storeId, countedAt: { gt: baris.receipt.receivedAt } },
          select: { id: true },
        })
      : null;

    await tx.auditLog.create({
      data: {
        userId: input.olehUserId,
        action: JEJAK_RUSAK.DIPUTUSKAN,
        entityType: ENTITAS_RUSAK,
        entityId: baris.id,
        changes: { before: { damageStatus: "TERBUKA" }, after: { damageStatus: keputusan } },
        metadata: {
          receiptId: baris.receipt.id,
          storeId,
          sourceType: baris.receipt.sourceType,
          sourceDocNo: baris.receipt.sourceDocNo,
          qty: baris.qtyDamaged,
          bukuDitulis,
          ...(opnameSesudah ? { opnameSesudahTerima: opnameSesudah.id } : {}),
        },
        reason: catatan,
      },
    });

    sesudah.kabar = {
      userId: baris.receipt.receivedById,
      receiptId: baris.receipt.id,
      docNo: baris.receipt.sourceDocNo,
      productName: baris.productName,
      qty: baris.qtyDamaged,
      keputusan,
      catatan,
    };
    if (bukuDitulis) sesudah.tokoTitipan = storeId;
    return { ok: true, receiptId: baris.receipt.id, bukuDitulis };
  });

  if (hasil.ok) {
    // Barang yang dititip-pesankan pembeli mungkin baru saja masuk stok.
    if (sesudah.tokoTitipan) void kabariTitipanTersedia(sesudah.tokoTitipan);
    if (sesudah.kabar) await kabariPengguna(sesudah.kabar.userId, kalimatKabar(sesudah.kabar));
  }
  return hasil;
}

function kalimatKabar(k: Kabar) {
  const barang = `${k.qty} potong ${k.productName}`;
  const judul =
    k.keputusan === "LAYAK_JUAL"
      ? `Barang rusak dari ${k.docNo}: boleh dijual`
      : k.keputusan === "KEMBALI_GUDANG"
        ? `Barang rusak dari ${k.docNo}: kirim balik ke gudang`
        : `Barang rusak dari ${k.docNo}: dihapuskan`;
  const isi =
    k.keputusan === "LAYAK_JUAL"
      ? `${barang} masuk stok toko dan boleh dijual. Catatan gudang: ${k.catatan}`
      : k.keputusan === "KEMBALI_GUDANG"
        ? `Kirim balik ${barang} lewat nota retur dari menu Terima kiriman. Catatan gudang: ${k.catatan}`
        : `${barang} tidak perlu dikirim balik. Catatan gudang: ${k.catatan}`;
  return { jenis: JENIS_KABAR.KIRIMAN_RUSAK_DIPUTUSKAN, judul, isi, data: { receiptId: k.receiptId } };
}
