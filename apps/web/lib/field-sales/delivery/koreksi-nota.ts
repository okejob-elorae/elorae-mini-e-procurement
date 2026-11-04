import { reopenFieldSalesLineStock, type AdminNotification, type Prisma, type StockAdjustmentSource } from "@elorae/db";
import { buildOfflineSalesHistoryRows } from "@elorae/db/field-sales";
import { generateDocNumber } from "@/lib/docNumber";
import { DeliveryShipmentError } from "@/lib/delivery/errors";
import { capNotificationText } from "@/lib/notifications/text";
import { formatIDR } from "@/lib/sales-orders/format";
import { JEJAK, catatJejak } from "@/lib/receivables/jejak";
import { penghalangBatalPiutang, type KodePenghalangBatal } from "@/lib/receivables/penghalang-batal";
import { hitungUlangPiutang } from "@/lib/receivables/writer";
import { batalkanFakturNotaInTx, kembalikanFakturNotaKeAntreanInTx } from "@/lib/tax-invoices/writer";
import { DeliveryError } from "../errors";
import { alokasiNotaDikoreksi, nextDeliveryStatus } from "./plan";
import { deliveredLineNetValues } from "./undelivered-residual";

/**
 * Satu-satunya tempat nota tagihan putus DIKOREKSI atau DIBATALKAN.
 *
 * - Koreksi ke jumlah yang diterima toko (P24: "toko hanya ditagih yang DITERIMA"): barang yang
 *   ditolak di depan pintu ("retur langsung") kembali ke Gudang Utama dan dibuka lagi di
 *   pesanannya; barang yang hilang di perjalanan tidak kembali ke mana pun (catatan barang
 *   hilangnya dibuka penerimaan toko) dan TIDAK dikirim ulang otomatis (P38).
 * - Pembatalan ("tidak jadi dikirim", P25/P41a, atau seluruh barang ditolak di pintu): semua
 *   baris menjadi 0, piutang VOIDED, faktur pajak CANCELLED, stok kembali ke gudang.
 *
 * Semua ditulis di DALAM transaksi pemanggil bersama jejaknya (AuditLog + JEJAK piutang + faktur).
 * Notifikasi Keuangan/admin pajak ditulis di dalam transaksi dan DIKEMBALIKAN untuk disebar
 * pemanggil sesudah commit; pemanggil yang memanggil ulang di dalam `runSerializable` harus
 * menyetel ulang daftar tangkapannya di awal callback.
 *
 * Kelebihan bayar toko HANYA dilaporkan ke Keuangan (P34); tidak ada yang dikembalikan atau
 * diperhitungkan otomatis.
 */

type Tx = Prisma.TransactionClient;

const sen = (n: number) => Math.round(n * 100);

/** Kunci StockAdjustment barang yang kembali dari satu nota (`ref` = tanda terima, atau "batal"). */
export function kunciKembaliNota(deliveryId: string, orderLineId: string, ref: string): string {
  return `nota-kembali-${deliveryId}-${orderLineId}-${ref}`;
}

/** Kunci StockAdjustment konsumsi baris nota — ditulis `consumeFieldSalesOrderPartial`. */
function kunciKonsumsi(orderNo: string, deliveryId: string, orderLineId: string): string {
  return `fieldsales-${orderNo}-delivery-${deliveryId}-line-${orderLineId}`;
}

async function muatNota(tx: Tx, deliveryId: string) {
  const nota = await tx.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      docNo: true,
      orderId: true,
      voidedAt: true,
      deliveredAt: true,
      receivedAt: true,
      receivedByName: true,
      subtotal: true,
      discountAmount: true,
      total: true,
      cogsAmount: true,
      lines: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          orderLineId: true,
          itemId: true,
          variantSku: true,
          productName: true,
          qty: true,
          unitPrice: true,
          discountAmount: true,
          lineTotal: true,
          returnedQty: true,
          lostQty: true,
        },
      },
      taxInvoice: { select: { id: true, status: true, invoiceNo: true, notaPrintedAt: true } },
      receivable: { select: { id: true, status: true, amount: true, invoiceNo: true } },
      order: {
        select: {
          id: true,
          orderNo: true,
          storeId: true,
          subtotal: true,
          orderDiscountAmount: true,
          lines: {
            select: {
              id: true,
              qty: true,
              deliveredQty: true,
              cancelledQty: true,
              discountAmount: true,
              unitPrice: true,
              item: { select: { sku: true, category: { select: { name: true } } } },
            },
          },
          deliveries: {
            select: { id: true, discountAmount: true, lines: { select: { orderLineId: true, discountAmount: true } } },
          },
        },
      },
    },
  });
  if (!nota) throw new DeliveryError("NOT_FOUND");
  return nota;
}

type Nota = Awaited<ReturnType<typeof muatNota>>;

/**
 * SalesHistory nota ini ditulis ulang dari baris yang SEKARANG ditagih (dikunci per nomor nota,
 * `buildOfflineSalesHistoryRows`). Nota yang dibatalkan tidak meninggalkan baris apa pun.
 */
export async function selaraskanRiwayatJualNota(
  tx: Tx,
  nota: {
    docNo: string;
    deliveredAt: Date;
    total: number;
    batal: boolean;
    lines: Array<{
      itemId: string;
      variantSku: string;
      parentSku: string;
      productName: string;
      qty: number;
      nilaiBersih: number;
      productCategory: string | null;
    }>;
  },
): Promise<void> {
  await tx.salesHistory.deleteMany({ where: { channel: "OFFLINE", orderId: nota.docNo } });
  if (nota.batal) return;
  const ditagih = nota.lines.filter((l) => l.qty > 0);
  if (ditagih.length === 0) return;
  const rows = buildOfflineSalesHistoryRows({
    orderNo: nota.docNo,
    orderTotal: nota.total,
    lines: ditagih.map((l) => ({
      itemId: l.itemId,
      variantSku: l.variantSku,
      parentSku: l.parentSku,
      productName: l.productName,
      qty: l.qty,
      unitPrice: l.qty > 0 ? l.nilaiBersih / l.qty : 0,
      lineTotal: l.nilaiBersih,
      productCategory: l.productCategory,
    })),
  }).map((row) => ({ ...row, orderDate: nota.deliveredAt, completedDate: nota.deliveredAt }));
  await tx.salesHistory.createMany({ data: rows });
}

/**
 * Semua laporan pembayaran yang menempel pada piutang nota, dengan status dan nomornya. Satu bacaan
 * untuk dua pemakai: penolakan "tidak jadi dikirim" (`penghalangBatalNota`) dan kalimat Keuangan saat
 * nota dikoreksi/dibatalkan (yang hanya memakai yang masih menunggu cek).
 */
export type LaporanPembayaranNota = {
  dibayar: boolean;
  bkm: Array<{ docNo: string; status: string; nilai: number }>;
  setoran: Array<{ docNo: string; status: string; nilai: number }>;
  pelunasan: Array<{ docNo: string; status: string; nilai: number }>;
  kontrabon: Array<{ docNo: string; nilai: number }>;
};

export async function laporanPembayaranNota(tx: Tx, receivableId: string): Promise<LaporanPembayaranNota> {
  const r = await tx.receivable.findUnique({
    where: { id: receivableId },
    select: {
      status: true,
      paidAmount: true,
      claimLinks: { select: { settledAmount: true, paymentClaim: { select: { docNo: true, status: true } } } },
      collectionLinks: {
        where: { collectionNote: { status: "BERJALAN" } },
        select: { amount: true, collectionNote: { select: { docNo: true } } },
      },
      submissions: { select: { id: true, status: true, amount: true } },
      settlementInvoices: { select: { amount: true, settlement: { select: { docNo: true, status: true } } } },
    },
  });
  return {
    dibayar: r ? r.status === "PAID" || Number(r.paidAmount ?? 0) > 0 : false,
    bkm: (r?.claimLinks ?? []).map((l) => ({ docNo: l.paymentClaim.docNo, status: l.paymentClaim.status, nilai: Number(l.settledAmount) })),
    setoran: (r?.submissions ?? []).map((x) => ({ docNo: `setoran ${x.id.slice(-6)}`, status: x.status, nilai: Number(x.amount) })),
    pelunasan: (r?.settlementInvoices ?? []).map((x) => ({ docNo: x.settlement.docNo, status: x.settlement.status, nilai: Number(x.amount) })),
    kontrabon: (r?.collectionLinks ?? []).map((l) => ({ docNo: l.collectionNote.docNo, nilai: Number(l.amount) })),
  };
}

/**
 * Laporan pembayaran mana yang menghalangi "tidak jadi dikirim" (R14, P16, P33a). Murni.
 *
 * - `RECEIVABLE_PAID` — sudah dibayar (`paidAmount` > 0 atau PAID), ATAU ada laporan pembayaran apa
 *   pun pada nota ini, diperiksa atau belum (P33a: BKM yang dilaporkan berarti toko sudah
 *   menyerahkan uangnya): setiap BKM yang tidak DIBATALKAN (DIKIRIM, TERVERIFIKASI, DITOLAK — BKM
 *   yang ditarik pelapornya sendiri tidak dihitung), setiap setoran penagih, setiap pelunasan toko.
 * - `RECEIVABLE_IN_USE` — nota ini ada di kontrabon BERJALAN (kontrabon bukan laporan pembayaran;
 *   tetap ditolak sampai pemilik memutuskan — tanpa pembatalan sama sekali, perilaku sebelumnya).
 *
 * `detail` = nomor-nomor laporannya (kontrabon diawali "kontrabon"), untuk kalimat penolakan.
 * Tanpa laporan (hanya sudah dibayar) `detail` tidak ada — layar memakai kalimatnya sendiri.
 */
export function penghalangBatalNota(
  l: LaporanPembayaranNota,
): { kode: "RECEIVABLE_PAID" | "RECEIVABLE_IN_USE"; detail?: string } | null {
  const laporan = [...l.bkm.filter((b) => b.status !== "DIBATALKAN"), ...l.setoran, ...l.pelunasan].map((b) => b.docNo);
  if (l.dibayar || laporan.length > 0) {
    return { kode: "RECEIVABLE_PAID", ...(laporan.length > 0 ? { detail: laporan.join(", ") } : {}) };
  }
  if (l.kontrabon.length > 0) return { kode: "RECEIVABLE_IN_USE", detail: l.kontrabon.map((k) => `kontrabon ${k.docNo}`).join(", ") };
  return null;
}

/**
 * Penghalang bersama SETIAP pembatalan piutang (`penghalangBatalPiutang`, juga dipakai membuka kunci
 * siklus konsinyasi) dipetakan ke kode penolakan pengiriman. Sesudah `penghalangBatalNota` hanya
 * tugas tagih TERBUKA yang masih bisa tersisa (BKM, kontrabon, dan pembayaran sudah tertolak di
 * sana, dengan aturan nota yang lebih ketat — P33a); pemetaan lainnya hanya penjaga. Murni.
 */
export function kodeTolakDariPenghalangPiutang(kode: KodePenghalangBatal): "RECEIVABLE_PAID" | "RECEIVABLE_IN_USE" {
  return kode === "ADA_BKM" || kode === "ADA_PEMBAYARAN_TOKO" ? "RECEIVABLE_PAID" : "RECEIVABLE_IN_USE";
}

/** Nama penagih tugas tagih TERBUKA yang mencantumkan piutang ini, untuk kalimat penolakan. */
async function tugasTagihPiutang(tx: Tx, receivableId: string): Promise<string | undefined> {
  const r = await tx.receivable.findUnique({ where: { id: receivableId }, select: { storeId: true } });
  if (!r) return undefined;
  const tugas = await tx.collectionTask.findMany({ where: { storeId: r.storeId, status: "TERBUKA" }, select: { assigneeId: true, receivableIds: true } });
  const penagih = [...new Set(tugas.filter((t) => Array.isArray(t.receivableIds) && t.receivableIds.includes(receivableId)).map((t) => t.assigneeId))];
  if (penagih.length === 0) return undefined;
  const orang = await tx.user.findMany({ where: { id: { in: penagih } }, select: { name: true } });
  const nama = orang.map((o) => o.name?.trim()).filter((n): n is string => Boolean(n));
  return nama.length > 0 ? `tugas tagih ${nama.join(", ")}` : "tugas tagih";
}

/**
 * Penolakan "tidak jadi dikirim" untuk nota putus (R14: P16, P33a, P41). Hanya membaca; dipanggil di
 * dalam transaksi serializable pembatalan sebelum apa pun ditulis. Melempar:
 * - `ALREADY_RECEIVED` — toko sudah menerima: ada tanda terima toko, ATAU bukti terima nota (tanda
 *   tangan/foto Max) sudah dicatat — barangnya ada di toko dengan bukti, jadi tidak boleh kembali ke
 *   stok gudang (tinjauan rancangan akhir, R14/R23);
 * - `RECEIVABLE_PAID` / `RECEIVABLE_IN_USE` — `penghalangBatalNota`, lalu penghalang bersama setiap
 *   pembatalan piutang (`penghalangBatalPiutang`: yang tersisa sesudahnya hanya tugas tagih TERBUKA
 *   yang mencantumkan nota ini → `RECEIVABLE_IN_USE`, supaya tugasnya tidak menunjuk tagihan batal);
 * - `RETURN_PRICED` — retur lapangan sudah dihargai dari nota ini.
 */
export async function periksaNotaBolehBatal(tx: Tx, deliveryId: string): Promise<void> {
  const nota = await tx.fieldSalesDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      voidedAt: true,
      receivedAt: true,
      receivedByName: true,
      receivable: { select: { id: true } },
      lines: { select: { id: true } },
    },
  });
  if (!nota) throw new DeliveryError("NOT_FOUND");
  if (nota.voidedAt) throw new DeliveryShipmentError("INVALID_STATE");

  const diterima = await tx.storeReceipt.findUnique({
    where: { sourceType_sourceId: { sourceType: "PUTUS_DELIVERY", sourceId: deliveryId } },
    select: { sourceDocNo: true },
  });
  if (diterima) throw new DeliveryShipmentError("ALREADY_RECEIVED");
  /*
   * A signed bukti terima (Max's proof, R23) is not the receipt marker and moves nothing — but it is
   * the store's signature that the goods are there, so the nota is not voided over it and the stock
   * is not put back in Gudang Utama (the final design review's rule; confirmation asked of the owner).
   */
  if (nota.receivedAt) {
    throw new DeliveryShipmentError("ALREADY_RECEIVED", nota.receivedByName ?? undefined);
  }

  if (nota.receivable) {
    const penghalang = penghalangBatalNota(await laporanPembayaranNota(tx, nota.receivable.id));
    if (penghalang) throw new DeliveryShipmentError(penghalang.kode, penghalang.detail);
    const bersama = await penghalangBatalPiutang(tx, nota.receivable.id);
    if (bersama) {
      const kode = kodeTolakDariPenghalangPiutang(bersama);
      throw new DeliveryShipmentError(kode, bersama === "ADA_TUGAS_TAGIH" ? await tugasTagihPiutang(tx, nota.receivable.id) : undefined);
    }
  }

  const dihargai = await tx.fieldReturnLine.findFirst({
    where: { priceDeliveryLineId: { in: nota.lines.map((l) => l.id) } },
    select: { returnDoc: { select: { docNo: true } } },
  });
  if (dihargai) throw new DeliveryShipmentError("RETURN_PRICED", dihargai.returnDoc.docNo);
}

type HasilUbahNota = {
  orderId: string;
  batal: boolean;
  barangKembali: string[];
  notifikasi: AdminNotification[];
  /** Nilai bersih per baris nota SEBELUM perubahan (dasar nilai klaim ekspedisi). */
  nilaiBersihSebelum: Map<string, number>;
};

/**
 * Inti koreksi/pembatalan. `perBaris` per id baris nota: `kembali` (ditolak di pintu atau tidak
 * jadi dikirim — kembali ke gudang dan dibuka lagi di pesanan) dan `hilang` (hilang di perjalanan).
 */
async function ubahNota(
  tx: Tx,
  nota: Nota,
  input: {
    perBaris: Map<string, { kembali: number; hilang: number }>;
    refKembali: string;
    olehUserId: string;
    alasan: string;
    sekarang: Date;
    paksaBatal: boolean;
  },
): Promise<HasilUbahNota> {
  if (nota.voidedAt) throw new DeliveryShipmentError("INVALID_STATE");
  const notifikasi: AdminNotification[] = [];
  const barangKembali: string[] = [];

  const sebelumBersih = deliveredLineNetValues({
    discountAmount: Number(nota.discountAmount),
    lines: nota.lines.map((l) => ({ lineTotal: Number(l.lineTotal ?? 0), discountAmount: Number(l.discountAmount) })),
  });
  const nilaiBersihSebelum = new Map(nota.lines.map((l, i) => [l.id, sebelumBersih[i]]));

  for (const [lineId, ubah] of input.perBaris) {
    const l = nota.lines.find((x) => x.id === lineId);
    if (!l) throw new DeliveryError("NOT_FOUND");
    if (!Number.isInteger(ubah.kembali) || !Number.isInteger(ubah.hilang) || ubah.kembali < 0 || ubah.hilang < 0) {
      throw new DeliveryShipmentError("INVALID_QTY");
    }
    if (ubah.kembali + ubah.hilang > l.qty) throw new DeliveryShipmentError("OVER_PLANNED");
  }

  /* Biaya keluar tiap baris = avgCost saat dikonsumsi (StockAdjustment konsumsinya). */
  const konsumsi = await tx.stockAdjustment.findMany({
    where: { idempotencyKey: { in: nota.lines.map((l) => kunciKonsumsi(nota.order.orderNo, nota.id, l.orderLineId)) } },
    select: { idempotencyKey: true, prevAvgCost: true },
  });
  const biayaKeluar = new Map(konsumsi.map((k) => [k.idempotencyKey as string, Number(k.prevAvgCost)]));
  const biayaBaris = (orderLineId: string) => biayaKeluar.get(kunciKonsumsi(nota.order.orderNo, nota.id, orderLineId));

  const sesudahQty = new Map<string, number>();
  const turunKirim = new Map<string, number>();
  for (const l of nota.lines) {
    const ubah = input.perBaris.get(l.id) ?? { kembali: 0, hilang: 0 };
    sesudahQty.set(l.id, l.qty - ubah.kembali - ubah.hilang);
    if (ubah.kembali > 0) {
      const biaya = biayaBaris(l.orderLineId);
      if (biaya === undefined) throw new DeliveryShipmentError("CONSUME_RECORD_MISSING");
      const balik = await reopenFieldSalesLineStock(tx, {
        fieldSalesLineId: l.orderLineId,
        source: "FIELD_SALES",
        itemId: l.itemId,
        variantSku: l.variantSku,
        qty: ubah.kembali,
        unitCost: biaya,
        refType: "FieldSalesConsume",
        refId: l.orderLineId,
        refDocNumber: nota.docNo,
        createdById: input.olehUserId,
      });
      await tx.stockAdjustment.create({
        data: {
          docNumber: await generateDocNumber("ADJ", tx),
          itemId: l.itemId,
          type: "POSITIVE",
          qtyChange: ubah.kembali,
          reason: `${input.paksaBatal ? "Tidak jadi dikirim" : "Ditolak toko (retur langsung)"} nota ${nota.docNo}`,
          prevQty: balik.prevQty,
          newQty: balik.newQty,
          prevAvgCost: balik.prevAvgCost,
          newAvgCost: balik.newAvgCost,
          createdById: input.olehUserId,
          source: "FIELD_SALES_CONSUME_RETURN" satisfies StockAdjustmentSource,
          idempotencyKey: kunciKembaliNota(nota.id, l.orderLineId, input.refKembali),
          externalRef: `fieldsales:${nota.order.orderNo}`,
        },
      });
      turunKirim.set(l.orderLineId, (turunKirim.get(l.orderLineId) ?? 0) + ubah.kembali);
      barangKembali.push(l.itemId);
    }
  }

  for (const [orderLineId, qty] of turunKirim) {
    await tx.fieldSalesOrderLine.update({ where: { id: orderLineId }, data: { deliveredQty: { decrement: qty } } });
  }

  /*
   * Dibatalkan hanya bila "tidak jadi dikirim" atau SELURUH barang ditolak di pintu (R7). Nota yang
   * menjadi nol karena barangnya (juga) hilang di perjalanan tetap DIKOREKSI (R8/R21): barangnya
   * tidak kembali ke gudang, dan catatan barang hilangnya menunjuk nota ini.
   */
  const semuaNol = nota.lines.every((l) => (sesudahQty.get(l.id) ?? 0) === 0);
  const adaHilang = nota.lines.some((l) => l.lostQty + (input.perBaris.get(l.id)?.hilang ?? 0) > 0);
  const batal = input.paksaBatal || (semuaNol && !adaHilang);

  /* Diskon dialokasikan ulang atas jumlah DITAGIH; nota lain dianggap sudah teralokasi. */
  const lainBaris = new Map<string, number>();
  let lainHeader = 0;
  for (const d of nota.order.deliveries) {
    if (d.id === nota.id) continue;
    lainHeader += Number(d.discountAmount);
    for (const dl of d.lines) lainBaris.set(dl.orderLineId, (lainBaris.get(dl.orderLineId) ?? 0) + Number(dl.discountAmount));
  }
  const ditagihPerBarisPesanan = new Map<string, number>();
  for (const l of nota.lines) {
    ditagihPerBarisPesanan.set(l.orderLineId, (ditagihPerBarisPesanan.get(l.orderLineId) ?? 0) + (batal ? 0 : (sesudahQty.get(l.id) ?? 0)));
  }
  const alokasi = alokasiNotaDikoreksi({
    orderSubtotal: Number(nota.order.subtotal),
    orderDiscount: Number(nota.order.orderDiscountAmount),
    orderDiscountAllocatedElsewhere: lainHeader,
    adaHilang,
    lines: nota.order.lines.map((ol) => ({
      orderLineId: ol.id,
      orderedQty: ol.qty,
      cancelledQty: ol.cancelledQty,
      deliveredQtyAfter: ol.deliveredQty - (turunKirim.get(ol.id) ?? 0),
      lineDiscount: Number(ol.discountAmount),
      lineDiscountAllocatedElsewhere: lainBaris.get(ol.id) ?? 0,
      unitPrice: Number(ol.unitPrice),
      billedQty: ditagihPerBarisPesanan.get(ol.id) ?? 0,
    })),
  });
  const diskonBaris = new Map(alokasi.lineDiscounts.map((d) => [d.orderLineId, d.discountAmount]));
  const totalBaru = batal ? 0 : alokasi.total;
  const subtotalBaru = batal ? 0 : alokasi.subtotal;
  const headerBaru = batal ? 0 : alokasi.orderDiscountAmount;

  const sebelumBaris = nota.lines.map((l) => ({ id: l.id, qty: l.qty, returnedQty: l.returnedQty, lostQty: l.lostQty, discountAmount: Number(l.discountAmount) }));
  const sesudahBaris: Array<{ id: string; qty: number; returnedQty: number; lostQty: number; discountAmount: number }> = [];
  /* Satu baris nota per baris pesanan: diskon baris pesanan dibagi ke baris notanya pertama saja. */
  const sudahDiskon = new Set<string>();
  for (const l of nota.lines) {
    const ubah = input.perBaris.get(l.id) ?? { kembali: 0, hilang: 0 };
    const qtyBaru = batal ? 0 : (sesudahQty.get(l.id) ?? 0);
    /* Pembatalan menghitung SEMUA sisa yang ditagih sebagai kembali (stoknya sudah dibuka di atas). */
    const kembaliBaru = l.returnedQty + ubah.kembali;
    const hilangBaru = l.lostQty + ubah.hilang;
    const diskon = !batal && !sudahDiskon.has(l.orderLineId) ? (diskonBaris.get(l.orderLineId) ?? 0) : 0;
    sudahDiskon.add(l.orderLineId);
    await tx.fieldSalesDeliveryLine.update({
      where: { id: l.id },
      data: {
        qty: qtyBaru,
        returnedQty: kembaliBaru,
        lostQty: hilangBaru,
        discountAmount: diskon,
        lineTotal: qtyBaru * Number(l.unitPrice ?? 0),
      },
    });
    sesudahBaris.push({ id: l.id, qty: qtyBaru, returnedQty: kembaliBaru, lostQty: hilangBaru, discountAmount: diskon });
  }

  /* HPP nota = jumlah ditagih × biaya keluarnya; baris tanpa catatan konsumsi memakai bagian lamanya. */
  const qtyLama = nota.lines.reduce((s, l) => s + l.qty, 0);
  const lengkap = nota.lines.every((l) => biayaBaris(l.orderLineId) !== undefined);
  const cogsBaru = batal
    ? 0
    : lengkap
      ? nota.lines.reduce((s, l) => s + (sesudahQty.get(l.id) ?? 0) * (biayaBaris(l.orderLineId) ?? 0), 0)
      : qtyLama > 0
        ? (Number(nota.cogsAmount ?? 0) * nota.lines.reduce((s, l) => s + (sesudahQty.get(l.id) ?? 0), 0)) / qtyLama
        : 0;

  await tx.fieldSalesDelivery.update({
    where: { id: nota.id },
    data: {
      subtotal: subtotalBaru,
      discountAmount: headerBaru,
      total: totalBaru,
      cogsAmount: cogsBaru,
      ...(batal
        ? { voidedAt: input.sekarang, voidedById: input.olehUserId, voidReason: input.alasan }
        : { correctedAt: input.sekarang }),
    },
  });

  /* Piutang: nilai baru, sisa dihitung ulang; nol atau batal = VOIDED (sisa 0 di kedua kolom). */
  let lebihBayar = 0;
  let totalSebelum = Number(nota.total);
  if (nota.receivable) {
    const sisaSebelum = await hitungUlangPiutang(tx, nota.receivable.id);
    totalSebelum = Number(nota.receivable.amount);
    lebihBayar = Math.max(0, Math.round((totalSebelum - sisaSebelum - totalBaru) * 100) / 100);
    if (batal || !(sen(totalBaru) > 0)) {
      await tx.receivable.update({
        where: { id: nota.receivable.id },
        data: { status: "VOIDED", outstanding: 0, outstandingAmount: 0 },
      });
    } else {
      await tx.receivable.update({
        where: { id: nota.receivable.id },
        data: { amount: totalBaru, originalAmount: totalBaru },
      });
      await hitungUlangPiutang(tx, nota.receivable.id);
    }
    await catatJejak(tx, {
      userId: input.olehUserId,
      action: batal || !(sen(totalBaru) > 0) ? JEJAK.PIUTANG_NOTA_DIBATALKAN : JEJAK.PIUTANG_NOTA_DIKOREKSI,
      entityType: "Receivable",
      entityId: nota.receivable.id,
      changes: {
        before: { amount: totalSebelum, status: nota.receivable.status },
        after: { amount: batal ? totalSebelum : totalBaru, status: batal || !(sen(totalBaru) > 0) ? "VOIDED" : "DIHITUNG_ULANG" },
      },
      metadata: { deliveryId: nota.id, docNo: nota.docNo, lebihBayar },
      reason: input.alasan,
    });
  }

  /* Faktur pajak mengikuti nota (P25, P34). */
  const faktur = nota.taxInvoice;
  const bernomor = faktur && (faktur.status === "CREATED" || faktur.status === "SENT_TO_STORE");
  if (faktur && batal && faktur.status !== "CANCELLED") {
    await batalkanFakturNotaInTx(tx, { taxInvoiceId: faktur.id, userId: input.olehUserId, reason: input.alasan });
  } else if (faktur && !batal && bernomor) {
    await kembalikanFakturNotaKeAntreanInTx(tx, { taxInvoiceId: faktur.id, userId: input.olehUserId, reason: input.alasan });
  }

  /* SalesHistory dan status pengiriman pesanan. */
  const bersihSesudah = deliveredLineNetValues({
    discountAmount: headerBaru,
    lines: sesudahBaris.map((b) => {
      const l = nota.lines.find((x) => x.id === b.id)!;
      return { lineTotal: b.qty * Number(l.unitPrice ?? 0), discountAmount: b.discountAmount };
    }),
  });
  const barisPesanan = new Map(nota.order.lines.map((ol) => [ol.id, ol]));
  await selaraskanRiwayatJualNota(tx, {
    docNo: nota.docNo,
    deliveredAt: nota.deliveredAt,
    total: totalBaru,
    batal,
    lines: nota.lines.map((l, i) => ({
      itemId: l.itemId,
      variantSku: l.variantSku,
      parentSku: barisPesanan.get(l.orderLineId)?.item.sku ?? "",
      productName: l.productName,
      qty: sesudahBaris[i].qty,
      nilaiBersih: bersihSesudah[i],
      productCategory: barisPesanan.get(l.orderLineId)?.item.category?.name ?? null,
    })),
  });
  const barisSesudah = await tx.fieldSalesOrderLine.findMany({
    where: { orderId: nota.orderId },
    select: { id: true, qty: true, deliveredQty: true, cancelledQty: true },
  });
  await tx.fieldSalesOrder.update({
    where: { id: nota.orderId },
    data: {
      deliveryStatus: nextDeliveryStatus(
        barisSesudah.map((l) => ({ orderLineId: l.id, qty: l.qty, deliveredQty: l.deliveredQty, cancelledQty: l.cancelledQty })),
      ),
    },
  });

  await tx.auditLog.create({
    data: {
      userId: input.olehUserId,
      action: batal ? "DELIVERY_NOTA_VOIDED" : "DELIVERY_NOTA_CORRECTED",
      entityType: "FieldSalesDelivery",
      entityId: nota.id,
      changes: {
        before: { total: Number(nota.total), lines: sebelumBaris },
        after: { total: totalBaru, lines: sesudahBaris },
      } as Prisma.InputJsonValue,
      metadata: { docNo: nota.docNo, orderId: nota.orderId, lebihBayar } as Prisma.InputJsonValue,
      reason: input.alasan,
    },
  });

  /* Kabar Keuangan (P25, P34, P41a): ditulis di sini, disebar pemanggil sesudah commit. */
  /*
   * Yang menunggu cek (BKM DIKIRIM, setoran/pelunasan PENDING) belum mengurangi sisa (Aturan 1), jadi
   * `lebihBayar` tidak memuatnya — kelebihannya dilaporkan terpisah supaya pemeriksa tahu uangnya
   * nyata ketika verifikasinya nanti ditolak MELEBIHI_SISA (P34).
   */
  const laporan = nota.receivable ? await laporanPembayaranNota(tx, nota.receivable.id) : null;
  const menunggu = laporan
    ? [
        ...laporan.bkm.filter((b) => b.status === "DIKIRIM"),
        ...laporan.setoran.filter((b) => b.status === "PENDING"),
        ...laporan.pelunasan.filter((b) => b.status === "PENDING"),
      ]
    : [];
  const menungguCek = menunggu.map((b) => `${b.docNo} ${formatIDR(b.nilai)}`);
  const nilaiMenunggu = menunggu.reduce((s, b) => s + b.nilai, 0);
  const lebihMenunggu = Math.max(0, Math.round((nilaiMenunggu - totalBaru) * 100) / 100);
  const kontrabon = laporan ? laporan.kontrabon.map((k) => `${k.docNo} ${formatIDR(k.nilai)}`) : [];
  const bkmHidup = laporan ? laporan.bkm.filter((b) => b.status !== "DIBATALKAN").map((b) => b.docNo) : [];
  const dicetak = Boolean(faktur?.notaPrintedAt);

  const kalimatUang = [
    lebihBayar > 0 ? `Toko sudah membayar lebih ${formatIDR(lebihBayar)} — hanya dilaporkan, tidak dikembalikan otomatis.` : "",
    menungguCek.length > 0
      ? `Laporan pembayaran menunggu cek: ${menungguCek.join(", ")}${lebihMenunggu > 0 ? ` (melebihi nota baru ${formatIDR(lebihMenunggu)})` : ""}.`
      : "",
    kontrabon.length > 0 ? `Nota ini ada di kontrabon berjalan: ${kontrabon.join(", ")} — angkanya tidak diubah.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (batal) {
    notifikasi.push(
      await tx.adminNotification.create({
        data: {
          category: "DELIVERY_NOTA_VOIDED",
          severity: "WARNING",
          title: capNotificationText(`Nota ${nota.docNo} dibatalkan${dicetak ? " — ambil kembali kertasnya" : ""}`),
          message:
            `Alasan: ${input.alasan}. Piutang dan faktur pajaknya ikut dibatalkan; barang kembali ke gudang. ` +
            `${dicetak ? "Nota tagihan sudah pernah dicetak. " : "Nota tagihan belum pernah dicetak. "}` +
            `${bkmHidup.length > 0 ? `BKM: ${bkmHidup.join(", ")}. ` : ""}${kalimatUang}`.trim(),
          metadata: {
            orderId: nota.orderId,
            deliveryId: nota.id,
            docNo: nota.docNo,
            dicetak,
            lebihBayar,
            bkm: bkmHidup.join(", "),
            menungguCek: menungguCek.join(", "),
            kontrabon: kontrabon.join(", "),
          },
        },
      }),
    );
  } else {
    notifikasi.push(
      await tx.adminNotification.create({
        data: {
          category: "DELIVERY_NOTA_CORRECTED",
          severity: lebihBayar > 0 || lebihMenunggu > 0 ? "WARNING" : "INFO",
          title: capNotificationText(`Nota ${nota.docNo} dikoreksi ke jumlah diterima toko`),
          message: `Total ${formatIDR(totalSebelum)} → ${formatIDR(totalBaru)}. ${kalimatUang}`.trim(),
          metadata: {
            orderId: nota.orderId,
            deliveryId: nota.id,
            docNo: nota.docNo,
            totalSebelum,
            totalSesudah: totalBaru,
            lebihBayar,
            menungguCek: menungguCek.join(", "),
            kontrabon: kontrabon.join(", "),
          },
        },
      }),
    );
  }

  if (faktur && bernomor) {
    notifikasi.push(
      await tx.adminNotification.create({
        data: {
          category: "TAX_INVOICE_NOTA_CHANGED",
          severity: "WARNING",
          title: capNotificationText(
            batal
              ? `Faktur ${faktur.invoiceNo ?? ""} nota ${nota.docNo} perlu dibatalkan di Coretax`
              : `Nota ${nota.docNo} dikoreksi — buat faktur pengganti`,
          ),
          message: batal
            ? `Nota ${nota.docNo} dibatalkan. Faktur pajaknya (${faktur.invoiceNo ?? "-"}) kini berstatus batal; batalkan juga di Coretax.`
            : `Nota ${nota.docNo} dikoreksi ke jumlah yang diterima toko (${formatIDR(totalBaru)}). Faktur lamanya (${faktur.invoiceNo ?? "-"}) kembali ke antrean untuk faktur pengganti.`,
          metadata: {
            orderId: nota.orderId,
            deliveryId: nota.id,
            docNo: nota.docNo,
            taxInvoiceId: faktur.id,
            invoiceNo: faktur.invoiceNo ?? "",
            jenis: batal ? "BATAL" : "KOREKSI",
          },
        },
      }),
    );
  }

  return { orderId: nota.orderId, batal, barangKembali, notifikasi, nilaiBersihSebelum };
}

/**
 * Nota dikoreksi ke yang DITERIMA toko, dari penerimaan toko (SPG, POD di toko tanpa SPG, atau
 * salesman pemegang): `kembali` = ditolak di pintu, `hilang` = hilang di perjalanan. Tidak pernah
 * menolak karena laporan pembayaran — ini kejadian fisik; kelebihan bayar dilaporkan (P34).
 * SELURUH barang ditolak di pintu = nota dibatalkan TANPA penolakan "tidak jadi dikirim" (R7); nota
 * yang menjadi nol karena ada barang hilang tetap dikoreksi (piutangnya VOIDED karena nilainya nol).
 */
export async function koreksiNotaDiterimaInTx(
  tx: Tx,
  input: {
    deliveryId: string;
    baris: Array<{ deliveryLineId: string; kembali: number; hilang: number }>;
    sumber: "PENERIMAAN_TOKO";
    refKembali: string;
    olehUserId: string;
    alasan: string;
    sekarang: Date;
  },
): Promise<HasilUbahNota> {
  const nota = await muatNota(tx, input.deliveryId);
  const perBaris = new Map<string, { kembali: number; hilang: number }>();
  for (const b of input.baris) {
    if (b.kembali === 0 && b.hilang === 0) continue;
    const ada = perBaris.get(b.deliveryLineId) ?? { kembali: 0, hilang: 0 };
    perBaris.set(b.deliveryLineId, { kembali: ada.kembali + b.kembali, hilang: ada.hilang + b.hilang });
  }
  if (perBaris.size === 0) {
    return { orderId: nota.orderId, batal: false, barangKembali: [], notifikasi: [], nilaiBersihSebelum: new Map() };
  }
  return ubahNota(tx, nota, {
    perBaris,
    refKembali: input.refKembali,
    olehUserId: input.olehUserId,
    alasan: input.alasan,
    sekarang: input.sekarang,
    paksaBatal: false,
  });
}

/**
 * Nota dibatalkan: setiap baris yang masih ditagih kembali ke gudang dan dibuka lagi di pesanan,
 * piutang VOIDED, faktur CANCELLED (nomornya tetap terlihat), SalesHistory dihapus, Keuangan
 * dikabari. `periksa` = jalur "tidak jadi dikirim" (penolakan P16/P33a/P41 dijalankan dulu);
 * `false` hanya dari penolakan penuh di depan pintu, yang adalah kejadian fisik.
 */
export async function batalkanNotaPengirimanInTx(
  tx: Tx,
  input: { deliveryId: string; olehUserId: string; alasan: string; sekarang: Date; refKembali: string; periksa: boolean },
): Promise<HasilUbahNota> {
  if (input.periksa) await periksaNotaBolehBatal(tx, input.deliveryId);
  const nota = await muatNota(tx, input.deliveryId);
  const perBaris = new Map<string, { kembali: number; hilang: number }>();
  for (const l of nota.lines) if (l.qty > 0) perBaris.set(l.id, { kembali: l.qty, hilang: 0 });
  return ubahNota(tx, nota, {
    perBaris,
    refKembali: input.refKembali,
    olehUserId: input.olehUserId,
    alasan: input.alasan,
    sekarang: input.sekarang,
    paksaBatal: true,
  });
}
