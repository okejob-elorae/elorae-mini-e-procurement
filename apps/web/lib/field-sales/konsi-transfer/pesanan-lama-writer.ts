import { InventoryValueMissingError, MainStockNegativeError, prisma, releaseFieldSalesOrder, type Prisma } from "@elorae/db";
import { runSerializable } from "@/lib/db/tx-retry";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { nextDeliveryStatus, outstandingQty } from "../delivery/plan";
import { KonsiTransferReservationMismatchError } from "../errors";
import { issueKonsiTransfer } from "./writer";
import { kunciOpname, muatPesananKonsiCadanganLama, opnameGudangSesudah } from "./pesanan-lama";
import {
  BATAS_ALASAN_BATAL_KIRIM,
  periksaHitunganSampai,
  peranPenerimaLama,
  type JawabanSampai,
  type PenolakanHitungan,
  type PeranPenerimaLama,
} from "./pesanan-lama-aturan";

/**
 * Penulis pesanan konsinyasi LAMA yang cadangannya masih ditahan (keputusan pemilik no. 9). Siapa
 * yang boleh apa diputuskan DI SINI dari data, bukan dari layar:
 * - "sudah sampai" (`konfirmasiSampaiPesananLama`): SPG toko itu, atau — toko tanpa SPG — salesman
 *   pemegang toko; keduanya harus sedang check-in di toko itu. Kantor tidak pernah lolos.
 * - "tidak jadi dikirim" (`batalKirimPesananLama`): kantor, dengan alasan — melepas cadangan sisa
 *   dan menutup sisa baris (cancelledQty), dicatat di jejak dalam transaksi yang sama.
 * Keduanya hanya untuk pesanan yang dikenali `bacaPesananKonsiCadanganLama`; pesanan yang disetujui
 * sesudah alur per antaran berjalan tetap lewat pengiriman dan tutup sisa biasa.
 */

export const JEJAK_SAMPAI_PESANAN_LAMA = "KONSI_OLD_ORDER_ARRIVAL_CONFIRMED";
export const JEJAK_BATAL_KIRIM_PESANAN_LAMA = "KONSI_OLD_ORDER_REMAINDER_NOT_SENT";

export type AlasanTolakSampai =
  | "TIDAK_DITEMUKAN"
  /** Bukan SPG toko ini, bukan pemegang toko tanpa SPG — termasuk orang kantor dan SPG toko lain. */
  | "BUKAN_PENERIMA"
  /** Belum check-in di toko ini. */
  | "TANPA_KUNJUNGAN"
  | PenolakanHitungan
  /** Stok gudang sendiri lebih kecil dari yang dikonfirmasi (dan gudang belum diopname sesudah disetujui). */
  | "STOK_GUDANG_KURANG"
  /** Cadangan baris ini berubah di tengah jalan (dikirim/ditutup orang lain). */
  | "CADANGAN_BERUBAH"
  /** Baris stok gudang untuk barang ini tidak ada lagi. */
  | "BARIS_GUDANG_HILANG"
  | "KUNCI_DIPAKAI";

export type HasilSampai =
  | {
      ok: true;
      storeId: string;
      transferId: string;
      docNo: string;
      /** Tanda terima buku toko yang ikut dibuat, bila ada. */
      receiptId: string | null;
      pcs: number;
      /** Pcs yang hanya ditambahkan ke toko: gudang sudah diopname sesudah pesanan disetujui. */
      pcsSesudahOpname: number;
      peran: PeranPenerimaLama;
      /** Kiriman ulang berkunci sama: hasil konfirmasi pertama, tidak ada yang ditulis lagi. */
      ulang?: true;
    }
  | { ok: false; alasan: AlasanTolakSampai };

type Tx = Prisma.TransactionClient;

/** Penolakan SESUDAH penulisan dimulai: dilempar supaya transaksi dibatalkan (`runSerializable` meng-commit saat kembali). */
class TolakSampai extends Error {
  constructor(readonly alasan: AlasanTolakSampai) {
    super(`Konfirmasi sampai pesanan konsi lama ditolak: ${alasan}`);
    this.name = "TolakSampai";
  }
}

type MetaSampai = {
  idempotencyKey?: string | null;
  transferId?: string;
  docNo?: string;
  receiptId?: string | null;
  pcs?: number;
  pcsSesudahOpname?: number;
  peran?: PeranPenerimaLama;
  storeId?: string;
};

/**
 * Konfirmasi ulang berkunci sama untuk pesanan ini, dari jejaknya. Metadata JSON dicocokkan di JS:
 * penyaringan jalur JSON tidak bisa diandalkan di adaptor ini, dan barisnya per pesanan sedikit.
 */
async function konfirmasiDenganKunci(tx: Tx, orderId: string, kunci: string): Promise<MetaSampai | null> {
  const rows = await tx.auditLog.findMany({
    where: { entityType: "FieldSalesOrder", entityId: orderId, action: JEJAK_SAMPAI_PESANAN_LAMA },
    select: { metadata: true },
  });
  for (const r of rows) {
    const m = (r.metadata ?? null) as MetaSampai | null;
    if (m && m.idempotencyKey === kunci) return m;
  }
  return null;
}

/**
 * SPG / salesman pemegang toko menghitung barang pesanan lama yang BENAR-BENAR ada di toko dan
 * mengonfirmasinya. Per baris yang dikonfirmasi N pcs:
 * - biasa: cadangan dipakai dan stok pindah gudang sendiri → toko (qtyOnHand −N, reservedQty −N,
 *   StoreStock +N) lewat `issueKonsiTransfer`, satu `KonsiTransfer` (tanpa pengiriman, ditandai
 *   `oldOrderArrival`) per konfirmasi;
 * - gudang sendiri sudah diopname SESUDAH pesanan disetujui (`opnameGudangSesudah`): hitungan itu
 *   sudah tidak memuat barang ini, jadi hanya toko yang bertambah dan cadangannya dilepas
 *   (reservedQty −N, qtyOnHand tetap) — tidak memotong dua kali.
 * Terkirim baris naik sebesar N; status kirim pesanan dihitung ulang. Kurang dari sisa: sisanya
 * tetap dicadangkan untuk konfirmasi berikutnya atau "tidak jadi dikirim" kantor — TIDAK pernah
 * menjadi catatan barang hilang. Lebih dari sisa: ditolak.
 *
 * SPG (atau pemegang di toko yang buku stoknya sudah dimulai) juga mendapat tanda terima buku toko
 * (`StoreReceipt` KONSI_TRANSFER untuk transfer itu + gerak TERIMA) di transaksi yang sama, sebesar
 * yang dihitung — dikirim = diterima, jadi tidak ada selisih. Toko yang belum punya buku tidak
 * dibukakan buku oleh konfirmasi ini: stok titipannya dibaca dari baris transfer.
 *
 * Jurnal pindah konsinyasinya diposting pemanggil SESUDAH commit (`kaitPindahKonsiTransfer`).
 */
export async function konfirmasiSampaiPesananLama(input: {
  orderId: string;
  userId: string;
  baris: JawabanSampai[];
  /** Dibuat HP sekali per formulir; kiriman ulang berkunci sama mendapat hasil yang sama. */
  idempotencyKey?: string | null;
  note?: string | null;
}): Promise<HasilSampai> {
  if (typeof input.orderId !== "string" || input.orderId === "" || typeof input.userId !== "string" || input.userId === "") {
    return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  }
  const kunci = typeof input.idempotencyKey === "string" && input.idempotencyKey.trim() !== "" ? input.idempotencyKey.trim() : null;
  const catatan = typeof input.note === "string" && input.note.trim() !== "" ? input.note.trim().slice(0, 500) : null;

  let hasil: HasilSampai;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilSampai> => {
      const order = await tx.fieldSalesOrder.findUnique({ where: { id: input.orderId }, select: { id: true, orderNo: true, storeId: true } });
      if (!order) return { ok: false, alasan: "TIDAK_DITEMUKAN" };

      // Kunci diperiksa PALING DULU: sesudah konfirmasi yang menghabiskan sisanya, pesanannya
      // bukan pesanan lama lagi, dan kiriman ulangnya harus mendapat hasil yang sama, bukan "tidak ditemukan".
      if (kunci) {
        const ada = await konfirmasiDenganKunci(tx, order.id, kunci);
        if (ada) {
          if (ada.storeId !== order.storeId || !ada.transferId || !ada.docNo || !ada.peran) return { ok: false, alasan: "KUNCI_DIPAKAI" };
          return {
            ok: true,
            storeId: order.storeId,
            transferId: ada.transferId,
            docNo: ada.docNo,
            receiptId: ada.receiptId ?? null,
            pcs: ada.pcs ?? 0,
            pcsSesudahOpname: ada.pcsSesudahOpname ?? 0,
            peran: ada.peran,
            ulang: true,
          };
        }
      }

      const lama = await muatPesananKonsiCadanganLama(tx, order.id);
      if (!lama) return { ok: false, alasan: "TIDAK_DITEMUKAN" };

      const [pengguna, jumlahSpg, toko] = await Promise.all([
        tx.user.findUnique({ where: { id: input.userId }, select: { id: true, assignedStoreId: true } }),
        tx.user.count({ where: { assignedStoreId: order.storeId } }),
        tx.store.findUnique({ where: { id: order.storeId }, select: { salesmanId: true } }),
      ]);
      if (!pengguna || !toko) return { ok: false, alasan: "BUKAN_PENERIMA" };
      const peran = peranPenerimaLama({
        userId: pengguna.id,
        tokoTetapPengguna: pengguna.assignedStoreId,
        storeId: order.storeId,
        jumlahSpg,
        pemegangTokoId: toko.salesmanId,
      });
      if (!peran) return { ok: false, alasan: "BUKAN_PENERIMA" };

      // Menghitung barang adalah pekerjaan DI toko: kunjungan berjalan pengguna ini harus di toko ini.
      const kunjungan = await tx.storeVisit.findFirst({
        where: { userId: pengguna.id, checkoutAt: null },
        orderBy: { checkinAt: "desc" },
        select: { id: true, storeId: true },
      });
      if (!kunjungan || kunjungan.storeId !== order.storeId) return { ok: false, alasan: "TANPA_KUNJUNGAN" };

      const sisa = new Map(lama.baris.map((b) => [b.lineId, b.sisa]));
      const periksa = periksaHitunganSampai(sisa, input.baris);
      if (!periksa.ok) return { ok: false, alasan: periksa.alasan };

      const barisById = new Map(lama.baris.map((b) => [b.lineId, b]));
      const dikonfirmasi = periksa.baris.map((j) => ({ ...barisById.get(j.lineId)!, qty: j.qty }));
      const opname = await opnameGudangSesudah(tx, { sejak: lama.approvedAt, barang: dikonfirmasi });

      // ── Mulai menulis: setiap penolakan dari sini DILEMPAR (`TolakSampai`) ──
      let transfer: { transferId: string; docNo: string };
      try {
        transfer = await issueKonsiTransfer(tx, {
          order: {
            id: order.id,
            storeId: order.storeId,
            lines: dikonfirmasi.map((b) => ({
              id: b.lineId,
              itemId: b.itemId,
              variantSku: b.variantSku,
              productName: b.productName,
              qty: b.qty,
              mainCountedByOpnameId: opname.get(kunciOpname(b.itemId, b.variantSku)) ?? null,
            })),
          },
          shipmentId: null,
          transferredById: pengguna.id,
          oldOrderArrival: true,
        });
      } catch (e) {
        if (e instanceof KonsiTransferReservationMismatchError) throw new TolakSampai("CADANGAN_BERUBAH");
        if (e instanceof MainStockNegativeError) throw new TolakSampai("STOK_GUDANG_KURANG");
        if (e instanceof InventoryValueMissingError) throw new TolakSampai("BARIS_GUDANG_HILANG");
        throw e;
      }

      for (const b of dikonfirmasi) {
        await tx.fieldSalesOrderLine.update({ where: { id: b.lineId }, data: { deliveredQty: { increment: b.qty } } });
      }
      const barisPesanan = await tx.fieldSalesOrderLine.findMany({
        where: { orderId: order.id },
        select: { id: true, qty: true, deliveredQty: true, cancelledQty: true },
      });
      const statusSebelum = await tx.fieldSalesOrder.findUnique({ where: { id: order.id }, select: { deliveryStatus: true } });
      const statusSesudah = nextDeliveryStatus(
        barisPesanan.map((l) => ({ orderLineId: l.id, qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty })),
      );
      await tx.fieldSalesOrder.update({ where: { id: order.id }, data: { deliveryStatus: statusSesudah } });

      // Tanda terima buku toko: SPG selalu (penerimaannya yang memulai buku, sama dengan kiriman
      // biasa); pemegang toko hanya bila buku toko sudah dimulai.
      const tulisBuku =
        peran === "SPG" || (await tx.storeStockMovement.findFirst({ where: { storeId: order.storeId }, select: { id: true } })) !== null;
      let receiptId: string | null = null;
      if (tulisBuku) {
        const receipt = await tx.storeReceipt.create({
          data: {
            storeId: order.storeId,
            sourceType: "KONSI_TRANSFER",
            sourceId: transfer.transferId,
            sourceDocNo: transfer.docNo,
            receivedById: pengguna.id,
            note: catatan ?? `Konfirmasi barang pesanan lama ${order.orderNo} sudah sampai`,
            lines: {
              create: dikonfirmasi.map((b) => ({
                itemId: b.itemId,
                variantSku: b.variantSku,
                productName: b.productName,
                qtySent: b.qty,
                qtyReceived: b.qty,
              })),
            },
          },
          select: { id: true },
        });
        receiptId = receipt.id;
        await tx.storeStockMovement.createMany({
          data: dikonfirmasi.map((b) => ({
            storeId: order.storeId,
            itemId: b.itemId,
            variantSku: b.variantSku,
            qty: b.qty,
            kind: "TERIMA" as const,
            refType: "StoreReceipt",
            refId: receipt.id,
            createdById: pengguna.id,
          })),
        });
      }

      const pcsSesudahOpname = dikonfirmasi.filter((b) => opname.has(kunciOpname(b.itemId, b.variantSku))).reduce((n, b) => n + b.qty, 0);
      await tx.auditLog.create({
        data: {
          userId: pengguna.id,
          action: JEJAK_SAMPAI_PESANAN_LAMA,
          entityType: "FieldSalesOrder",
          entityId: order.id,
          changes: {
            sebelum: { deliveryStatus: statusSebelum?.deliveryStatus ?? null, sisa: Object.fromEntries(lama.baris.map((b) => [b.lineId, b.sisa])) },
            sesudah: {
              deliveryStatus: statusSesudah,
              sisa: Object.fromEntries(lama.baris.map((b) => [b.lineId, b.sisa - (periksa.baris.find((j) => j.lineId === b.lineId)?.qty ?? 0)])),
            },
          },
          metadata: {
            idempotencyKey: kunci,
            storeId: order.storeId,
            orderNo: order.orderNo,
            transferId: transfer.transferId,
            docNo: transfer.docNo,
            receiptId,
            peran,
            visitId: kunjungan.id,
            pcs: periksa.total,
            pcsSesudahOpname,
            baris: dikonfirmasi.map((b) => ({
              lineId: b.lineId,
              qty: b.qty,
              mainCountedByOpnameId: opname.get(kunciOpname(b.itemId, b.variantSku)) ?? null,
            })),
          },
        },
      });

      return {
        ok: true,
        storeId: order.storeId,
        transferId: transfer.transferId,
        docNo: transfer.docNo,
        receiptId,
        pcs: periksa.total,
        pcsSesudahOpname,
        peran,
      };
    });
  } catch (e) {
    if (e instanceof TolakSampai) return { ok: false, alasan: e.alasan };
    throw e;
  }

  // Sesudah commit: barang yang gudangnya sudah diopname hanya melepas cadangan — tersedia gudang
  // naik, jadi angka Jubelio diteruskan. Yang biasa memotong qtyOnHand dan cadangan sama besar.
  if (hasil.ok && !hasil.ulang && hasil.pcsSesudahOpname > 0) {
    const barang = await prisma.konsiTransferLine.findMany({
      where: { transferId: hasil.transferId, mainCountedByOpnameId: { not: null } },
      select: { itemId: true },
    });
    await antrekanPushStok(
      barang.map((b) => b.itemId),
      { sumber: "KONSI_TRANSFER", ref: `konfirmasi sampai pesanan konsi lama ${hasil.docNo}`, userId: input.userId },
    );
  }
  return hasil;
}

export type AlasanTolakBatalKirim = "TIDAK_DITEMUKAN" | "ALASAN_WAJIB";

/**
 * Kantor menandai sisa pesanan lama "tidak jadi dikirim": setiap baris yang masih bersisa ditutup
 * (cancelledQty += sisa), cadangannya dilepas (reservedQty −sisa, qtyOnHand tetap), status kirim
 * dihitung ulang, dan pesanan dicap ditutup (closedAt/closedById/closeReason) — persis tutup sisa
 * biasa, ditambah baris jejak berisi keadaan sebelum/sesudah DI transaksi yang sama. Hanya untuk
 * pesanan lama; pesanan lain memakai tutup sisa biasa.
 */
export async function batalKirimPesananLama(input: {
  orderId: string;
  userId: string;
  alasan: string;
}): Promise<{ ok: true; orderNo: string; pcs: number } | { ok: false; alasan: AlasanTolakBatalKirim }> {
  if (typeof input.orderId !== "string" || input.orderId === "" || typeof input.userId !== "string" || input.userId === "") {
    return { ok: false, alasan: "TIDAK_DITEMUKAN" };
  }
  const alasan = typeof input.alasan === "string" ? input.alasan.trim() : "";
  if (alasan === "" || alasan.length > BATAS_ALASAN_BATAL_KIRIM) return { ok: false, alasan: "ALASAN_WAJIB" };

  let barangDilepas: string[] = [];
  const hasil = await runSerializable(async (tx) => {
    barangDilepas = [];
    const lama = await muatPesananKonsiCadanganLama(tx, input.orderId);
    if (!lama) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      select: {
        id: true,
        orderNo: true,
        deliveryStatus: true,
        lines: { select: { id: true, itemId: true, qty: true, deliveredQty: true, cancelledQty: true } },
      },
    });
    if (!order) return { ok: false as const, alasan: "TIDAK_DITEMUKAN" as const };

    const terbuka = order.lines.filter((l) => outstandingQty(l) > 0);
    for (const l of terbuka) {
      await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { cancelledQty: { increment: outstandingQty(l) } } });
    }
    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: terbuka.map((l) => l.id) });

    const sesudah = order.lines.map((l) => ({
      orderLineId: l.id,
      qty: l.qty,
      deliveredQty: l.deliveredQty,
      cancelledQty: l.cancelledQty + outstandingQty(l),
    }));
    const statusSesudah = nextDeliveryStatus(sesudah);
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { deliveryStatus: statusSesudah, closedAt: new Date(), closedById: input.userId, closeReason: alasan },
    });

    const pcs = terbuka.reduce((n, l) => n + outstandingQty(l), 0);
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: JEJAK_BATAL_KIRIM_PESANAN_LAMA,
        entityType: "FieldSalesOrder",
        entityId: order.id,
        reason: alasan,
        changes: {
          sebelum: { deliveryStatus: order.deliveryStatus, dibatalkan: Object.fromEntries(order.lines.map((l) => [l.id, l.cancelledQty])) },
          sesudah: { deliveryStatus: statusSesudah, dibatalkan: Object.fromEntries(sesudah.map((l) => [l.orderLineId, l.cancelledQty])) },
        },
        metadata: { orderNo: order.orderNo, pcs, baris: terbuka.map((l) => ({ lineId: l.id, qty: outstandingQty(l) })) },
      },
    });
    barangDilepas = terbuka.map((l) => l.itemId);
    return { ok: true as const, orderNo: order.orderNo, pcs };
  });

  // Sesudah commit: cadangan sisa dilepas, tersedia gudang naik — teruskan ke Jubelio.
  if (hasil.ok) {
    await antrekanPushStok(barangDilepas, { sumber: "PESANAN_LAPANGAN", ref: `tidak jadi dikirim pesanan konsi lama ${hasil.orderNo}`, userId: input.userId });
  }
  return hasil;
}
