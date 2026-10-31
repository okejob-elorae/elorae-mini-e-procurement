import type { Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { JENIS_KABAR, kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { ENTITAS_REKOMENDASI } from "@/lib/salesman/rekomendasi-aturan";
import { dibatalkanSalesman } from "./ganti-pesanan";
import { catatanDibuatkanPesanan } from "./isi-keranjang-sumber";

/**
 * Dokumen sumber (permintaan barang SPG, rekomendasi toko) yang sudah
 * dibuatkan pesanan, lalu pesanannya DIBATALKAN atau DIGANTI salesman.
 *
 * - Diganti (ubah pesanan): tautannya pindah ke pesanan pengganti — mengikuti
 *   rantai A → B → C sampai pesanan terakhir. Status dokumen tidak berubah.
 *   Rantai dibaca dua arah: tautan yang tertinggal di pesanan yang lebih lama
 *   (pemindahan tidak sempat jalan) ikut dirapikan saat pesanan mana pun di
 *   rantai itu dibatalkan atau diubah.
 * - Dibatalkan tanpa pengganti hidup: permintaan `DIPROSES` kembali `BARU`
 *   tanpa tautan, rekomendasi `SELESAI` kembali `DITERIMA` tanpa tautan, dan
 *   SPG tokonya dikabari. Pemegang toko bisa membuatkan pesanan lagi.
 *
 * Permintaan yang sudah ditandai SELESAI/DITOLAK dengan tangan tidak dibuka
 * lagi: keputusan itu milik orangnya. Pesanan yang DITOLAK KANTOR (bukan
 * dibatalkan salesman) di luar aturan ini.
 *
 * Bekerja dari KEADAAN basis data, bukan dari siapa yang memanggil: aman
 * dipanggil ulang (kiriman ulang, perbaikan), dan tidak berbuat apa-apa untuk
 * pesanan yang masih hidup. Penjaga keadaan di dalam `runSerializable` —
 * Prisma 7 `updateMany` bukan compare-and-swap — dan jejaknya di transaksi
 * yang sama. Kabar sesudah commit. Tidak pernah melempar.
 */

/** Nama tindakan jejak (`AuditLog.action`). Jangan ditulis sebagai string bebas di tempat lain. */
export const JEJAK_SUMBER_PESANAN = {
  PERMINTAAN_PESANAN_BATAL: "STOCK_REQUEST_ORDER_CANCELLED",
  PERMINTAAN_PESANAN_DIGANTI: "STOCK_REQUEST_ORDER_REPLACED",
  REKOMENDASI_PESANAN_BATAL: "STORE_RECOMMENDATION_ORDER_CANCELLED",
  REKOMENDASI_PESANAN_DIGANTI: "STORE_RECOMMENDATION_ORDER_REPLACED",
} as const;

const ENTITAS_PERMINTAAN = "StockRequest";

/** Batas panjang rantai ubah pesanan yang diikuti — penjaga putaran, bukan aturan bisnis. */
const BATAS_RANTAI = 20;

export type HasilRapikanSumber = { dibuka: number; dipindah: number };

const NOL: HasilRapikanSumber = { dibuka: 0, dipindah: 0 };

type PesananRantai = {
  id: string;
  orderNo: string;
  status: string;
  salesmanId: string;
  cancelledById: string | null;
  rejectReason: string | null;
  replacesOrderId: string | null;
};

const PILIH_PESANAN = {
  id: true,
  orderNo: true,
  status: true,
  salesmanId: true,
  cancelledById: true,
  rejectReason: true,
  replacesOrderId: true,
} as const;

type KabarTertunda = { userId: string; kabar: Kabar };

/** Seluruh rantai ubah pesanan yang memuat `awal`, dari pesanan pertama sampai pesanan terakhir. */
async function bacaRantai(tx: Prisma.TransactionClient, awal: PesananRantai): Promise<PesananRantai[]> {
  const rantai = [awal];
  // Mundur: pesanan yang digantikan `awal`, dan seterusnya.
  let pangkal = awal;
  for (let i = 0; i < BATAS_RANTAI && pangkal.replacesOrderId; i++) {
    const lama = await tx.fieldSalesOrder.findUnique({ where: { id: pangkal.replacesOrderId }, select: PILIH_PESANAN });
    if (!lama || rantai.some((o) => o.id === lama.id)) break;
    rantai.unshift(lama);
    pangkal = lama;
  }
  // Maju: pengganti `awal`, sampai pesanan terakhir.
  let ujung = awal;
  for (let i = 0; i < BATAS_RANTAI; i++) {
    const berikut = await tx.fieldSalesOrder.findFirst({
      where: { replacesOrderId: ujung.id },
      orderBy: { createdAt: "asc" },
      select: PILIH_PESANAN,
    });
    if (!berikut || rantai.some((o) => o.id === berikut.id)) break;
    rantai.push(berikut);
    ujung = berikut;
  }
  return rantai;
}

/**
 * `salesmanId`: hanya bertindak bila pesanan itu milik salesman ini — dipakai
 * aksi ubah pesanan, karena kiriman ulang (kunci idempotensi yang sama) tidak
 * memeriksa ulang pemilik pesanan lama.
 */
export async function rapikanSumberPesananBatal(
  orderId: string,
  opsi: { salesmanId?: string } = {},
): Promise<HasilRapikanSumber> {
  let kabar: KabarTertunda[] = [];
  let hasil: HasilRapikanSumber = NOL;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilRapikanSumber> => {
      // Diulang saat bentrok — kabar dari percobaan yang batal tidak boleh ikut terkirim.
      kabar = [];
      const awal = await tx.fieldSalesOrder.findUnique({ where: { id: orderId }, select: PILIH_PESANAN });
      if (!awal || !dibatalkanSalesman(awal)) return NOL;
      if (opsi.salesmanId !== undefined && awal.salesmanId !== opsi.salesmanId) return NOL;

      const rantai = await bacaRantai(tx, awal);
      const ujung = rantai[rantai.length - 1];
      // Ujung rantai yang juga dibatalkan salesman = tidak ada pesanan hidup: dokumennya dibuka lagi.
      // Selain itu (menunggu, disetujui, atau ditolak kantor) tautannya pindah ke ujung.
      const buka = dibatalkanSalesman(ujung);
      // Hanya pesanan yang memang dibatalkan salesman yang dilepas tautannya.
      const asal = (buka ? rantai : rantai.slice(0, -1)).filter(dibatalkanSalesman);
      const idAsal = asal.map((o) => o.id);
      const nomor = new Map(rantai.map((o) => [o.id, o.orderNo]));
      const oleh = ujung.cancelledById ?? ujung.salesmanId;
      const alasan = buka ? ujung.rejectReason : null;
      let dibuka = 0;
      let dipindah = 0;

      const permintaan = await tx.stockRequest.findMany({
        where: { fieldSalesOrderId: { in: idAsal } },
        select: { id: true, status: true, fieldSalesOrderId: true, handledById: true, handleNote: true, requestedById: true },
      });
      for (const r of permintaan) {
        const lamaId = r.fieldSalesOrderId as string;
        const lamaNo = nomor.get(lamaId) ?? "";
        if (!buka) {
          // Catatan otomatis ikut menyebut nomor pengganti; catatan buatan orang dibiarkan.
          const catatan = r.handleNote === catatanDibuatkanPesanan(lamaNo) ? catatanDibuatkanPesanan(ujung.orderNo) : r.handleNote;
          const n = await tx.stockRequest.updateMany({
            where: { id: r.id, fieldSalesOrderId: lamaId },
            data: { fieldSalesOrderId: ujung.id, handleNote: catatan },
          });
          if (n.count !== 1) continue;
          await tx.auditLog.create({
            data: {
              userId: oleh,
              action: JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_DIGANTI,
              entityType: ENTITAS_PERMINTAAN,
              entityId: r.id,
              changes: {
                before: { fieldSalesOrderId: lamaId, orderNo: lamaNo, handleNote: r.handleNote },
                after: { fieldSalesOrderId: ujung.id, orderNo: ujung.orderNo, handleNote: catatan },
              },
            },
          });
          dipindah += 1;
          continue;
        }
        if (r.status !== "DIPROSES") continue;
        const n = await tx.stockRequest.updateMany({
          where: { id: r.id, status: "DIPROSES", fieldSalesOrderId: lamaId },
          data: { status: "BARU", fieldSalesOrderId: null, handledById: null, handledAt: null, handleNote: null },
        });
        if (n.count !== 1) continue;
        await tx.auditLog.create({
          data: {
            userId: oleh,
            action: JEJAK_SUMBER_PESANAN.PERMINTAAN_PESANAN_BATAL,
            entityType: ENTITAS_PERMINTAAN,
            entityId: r.id,
            changes: {
              before: { status: "DIPROSES", fieldSalesOrderId: lamaId, orderNo: lamaNo, handledById: r.handledById, handleNote: r.handleNote },
              after: { status: "BARU", fieldSalesOrderId: null },
            },
            reason: alasan,
          },
        });
        kabar.push({
          userId: r.requestedById,
          kabar: {
            jenis: JENIS_KABAR.PERMINTAAN_STOK_DIPROSES,
            judul: "Pesanan dari permintaan Anda dibatalkan",
            isi: `Salesman membatalkan pesanan ${ujung.orderNo}. Permintaan Anda dibuka lagi dan menunggu dibuatkan pesanan.`,
            data: { requestId: r.id, status: "BARU" },
          },
        });
        dibuka += 1;
      }

      const rekomendasi = await tx.storeRecommendation.findMany({
        where: { fieldSalesOrderId: { in: idAsal } },
        select: { id: true, status: true, storeId: true, fieldSalesOrderId: true },
      });
      for (const k of rekomendasi) {
        const lamaId = k.fieldSalesOrderId as string;
        const lamaNo = nomor.get(lamaId) ?? "";
        if (!buka) {
          const n = await tx.storeRecommendation.updateMany({
            where: { id: k.id, fieldSalesOrderId: lamaId },
            data: { fieldSalesOrderId: ujung.id },
          });
          if (n.count !== 1) continue;
          await tx.auditLog.create({
            data: {
              userId: oleh,
              action: JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_DIGANTI,
              entityType: ENTITAS_REKOMENDASI,
              entityId: k.id,
              changes: {
                before: { fieldSalesOrderId: lamaId, orderNo: lamaNo },
                after: { fieldSalesOrderId: ujung.id, orderNo: ujung.orderNo },
              },
              metadata: { storeId: k.storeId },
            },
          });
          dipindah += 1;
          continue;
        }
        if (k.status !== "SELESAI") continue;
        const n = await tx.storeRecommendation.updateMany({
          where: { id: k.id, status: "SELESAI", fieldSalesOrderId: lamaId },
          data: { status: "DITERIMA", fieldSalesOrderId: null },
        });
        if (n.count !== 1) continue;
        await tx.auditLog.create({
          data: {
            userId: oleh,
            action: JEJAK_SUMBER_PESANAN.REKOMENDASI_PESANAN_BATAL,
            entityType: ENTITAS_REKOMENDASI,
            entityId: k.id,
            changes: {
              before: { status: "SELESAI", fieldSalesOrderId: lamaId, orderNo: lamaNo },
              after: { status: "DITERIMA", fieldSalesOrderId: null },
            },
            metadata: { storeId: k.storeId },
            reason: alasan,
          },
        });
        // SPG toko = pengguna yang toko tetapnya toko ini (sama dengan penerima rekomendasi).
        const spg = await tx.user.findMany({ where: { assignedStoreId: k.storeId }, select: { id: true } });
        for (const s of spg) {
          kabar.push({
            userId: s.id,
            kabar: {
              jenis: JENIS_KABAR.REKOMENDASI_MASUK,
              judul: "Pesanan rekomendasi dibatalkan",
              isi: `Salesman membatalkan pesanan ${ujung.orderNo} dari rekomendasi yang Anda terima. Barangnya belum dipesan.`,
              data: { recommendationId: k.id },
            },
          });
        }
        dibuka += 1;
      }

      return { dibuka, dipindah };
    });
  } catch (err) {
    console.error("rapikanSumberPesananBatal gagal", orderId, err);
    return NOL;
  }
  // SESUDAH commit; `kabariPengguna` menelan galatnya sendiri.
  for (const k of kabar) await kabariPengguna(k.userId, k.kabar);
  return hasil;
}
