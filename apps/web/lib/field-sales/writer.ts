import { reserveFieldSalesOrder, releaseFieldSalesOrder, transferKonsiFieldSalesOrder, type OversellAlert, type AdminNotification } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines } from "@elorae/db/field-sales";
import { muatMinimumToko } from "./minimum-toko";
import { JarakJauhDitolakError, periksaJarakJauh, SALURAN_PORTAL, type SaluranPesanan } from "./jarak-jauh";
import { muatAturanJarakJauh } from "./jarak-jauh-toko";
import { susunBonusPesanan } from "./bonus";
import { catatanKurangBonus } from "./bonus-alokasi";
import { computeStorePrice } from "@elorae/db/pricing";
import { applyItemAggregatedPromos } from "./promo-apply";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError, InvalidAddedLineError } from "./errors";
import { sentItemIds } from "./queries";
import { nilaiKredit } from "@/lib/salesman/kredit";
import { kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { muatKreditToko } from "./kredit-toko";
import { KreditBelumDiperiksaError, KreditDiblokirError, putuskanKreditPesanan } from "./kredit-pesanan";
import { kabarPesananDisetujui, kabarPesananDitolak } from "./kabar-pesanan";
import { BarangIndenBelumTercatatError, IndenDitolakError, periksaPesananInden } from "./inden";
import { cadangkanPesananInden } from "./inden-writer";
import {
  AKSI_PESANAN_DIBATALKAN,
  ENTITAS_PESANAN,
  BatalPesananError,
  PesananLamaTidakBisaDigantiError,
  alasanDiganti,
  periksaAlasanBatal,
} from "./ganti-pesanan";
import type { Prisma } from "@elorae/db";

/**
 * Kabar keputusan ke salesman — sesudah transaksi, tidak ditunggu, tidak pernah
 * melempar (`kabariPengguna` menelan galatnya sendiri).
 *
 * Tidak dikirim dari proses tes: spesifikasi penulis ini berjalan terhadap basis
 * data dev bersama dengan salesman sungguhan, dan baris `NotificationQueue`
 * yang bocor mendarat di lonceng HP-nya (bahkan push FCM, karena `.env` membawa
 * kredensial Firebase). Alasan yang sama dengan penjaga di `fanOutAdminNotification`.
 */
function kirimKabar(salesmanId: string, kabar: Kabar): void {
  if (process.env.VITEST) return;
  void kabariPengguna(salesmanId, kabar);
}

/**
 * Harga final banding yang tidak bisa menjadi harga jual: negatif atau bukan angka terhingga.
 * Aksi persetujuan sudah menyaring bentuk ini; penulis tetap menolaknya karena penulis adalah
 * satu-satunya yang menyimpan harga.
 */
export class HargaFinalTidakSahError extends Error {
  constructor(readonly lineId: string, readonly finalUnitPrice: number) {
    super(`Harga final tidak sah untuk baris ${lineId}: ${finalUnitPrice}`);
    this.name = "HargaFinalTidakSahError";
  }
}

type CreateLine = {
  itemId: string;
  variantSku: string;
  productName: string;
  qty: number;
  unitPrice: number;
  requestedUnitPrice?: number | null;
  appealReason?: string | null;
};

export async function createFieldSalesOrder(input: {
  storeId: string;
  salesmanId: string;
  visitId?: string;
  lines: CreateLine[];
  note?: string;
  idempotencyKey?: string;
  skipMinQty?: boolean;
  /**
   * Pesanan jarak jauh (toko memesan lewat WA/telepon): tidak butuh kunjungan.
   * Harga, promo, minimum, dan kredit berlaku persis sama dengan pesanan kunjungan.
   */
  remoteChannel?: SaluranPesanan | null;
  /**
   * Pre-order (inden): jendelanya harus BUKA (dinilai ulang di dalam transaksi),
   * setiap barang harus barang jendela itu, dan tokonya PUTUS. Stok TIDAK
   * dicadangkan saat dibuat — barangnya belum ada; dicadangkan saat jendela
   * dirilis (lihat `rilisJendelaInden`). Harga, promo, minimum, dan kredit sama.
   */
  preorderWindowId?: string | null;
  /**
   * Mengubah pesanan sendiri = mengganti. Pesanan lama (milik salesman ini,
   * toko yang sama, MASIH menunggu persetujuan) dibatalkan di transaksi ini,
   * cadangan stoknya dilepas SEBELUM baris baru dicadangkan, dan pesanan baru
   * menunjuknya lewat `replacesOrderId`. Kunjungan, saluran jarak jauh (termasuk
   * PORTAL), dan jendela pre-order DIBAWA dari pesanan lama — nilai pemanggil
   * untuk ketiganya diabaikan. Selain itu semua aturan dinilai ulang persis
   * seperti pesanan baru, jadi kegagalan apa pun membatalkan seluruhnya dan
   * pesanan lama tetap menunggu.
   */
  replacesOrderId?: string | null;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[]; kreditDitahan: boolean }> {
  if (input.lines.length === 0) throw new MinQtyViolationError([]);
  /**
   * Bahan kredit dibaca SEBELUM transaksi: `keadaanTagihanToko` memakai klien
   * prisma biasa (bukan `tx`) dan menghitung ulang piutang dari klaim — kerja
   * baca yang tidak perlu ikut memegang kunci serializable. Penilaiannya tetap
   * di dalam transaksi, karena butuh total pesanan yang dihitung SERVER. Toko
   * konsinyasi menghasilkan null dan tidak pernah dinilai.
   */
  const kredit = await muatKreditToko(input.storeId);
  let notification: AdminNotification | undefined;
  // Barang yang available-nya berubah (cadangan baru, cadangan pesanan lama dilepas) — push sesudah commit.
  let barangStok: string[] = [];
  const result = await runSerializable(async (tx) => {
    /* Retry re-runs this whole callback; reset so a rolled-back attempt's row never survives into the next one. */
    notification = undefined;
    barangStok = [];
    // Tetap PALING DULU: kiriman ulang (antrean HP, jaringan putus di tengah jalan)
    // mengembalikan pesanan yang sudah ada apa adanya — tidak dinilai ulang, jadi
    // pesanan yang sudah tercatat tidak mungkin tiba-tiba ditolak karena kredit.
    if (input.idempotencyKey) {
      const existing = await tx.fieldSalesOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, orderNo: true, kreditDitahan: true },
      });
      if (existing) return { orderId: existing.id, orderNo: existing.orderNo, oversell: [] as OversellAlert[], kreditDitahan: existing.kreditDitahan };
    }

    /*
     * Pesanan yang diganti: diperiksa di transaksi ini (serializable), jadi
     * persetujuan kantor yang berbarengan tidak bisa lolos bersama penggantinya —
     * salah satunya diulang dan melihat keadaan yang sudah berubah.
     */
    let lama: { id: string; orderNo: string; lineIds: string[]; itemIds: string[] } | null = null;
    let carried: { visitId: string | null; remoteChannel: string | null; preorderWindowId: string | null } | null = null;
    if (input.replacesOrderId) {
      const o = await tx.fieldSalesOrder.findUnique({
        where: { id: input.replacesOrderId },
        select: {
          id: true,
          orderNo: true,
          status: true,
          salesmanId: true,
          storeId: true,
          visitId: true,
          remoteChannel: true,
          preorderWindowId: true,
          lines: { select: { id: true, itemId: true } },
        },
      });
      if (!o || o.salesmanId !== input.salesmanId || o.storeId !== input.storeId || o.status !== "PENDING_APPROVAL") {
        throw new PesananLamaTidakBisaDigantiError();
      }
      lama = { id: o.id, orderNo: o.orderNo, lineIds: o.lines.map((l) => l.id), itemIds: o.lines.map((l) => l.itemId) };
      carried = { visitId: o.visitId, remoteChannel: o.remoteChannel, preorderWindowId: o.preorderWindowId };
    }
    const remoteChannel = (carried ? carried.remoteChannel : (input.remoteChannel ?? null)) as SaluranPesanan | null;
    const preorderWindowId = carried ? carried.preorderWindowId : (input.preorderWindowId ?? null);
    const visitIdDiminta = carried ? (carried.visitId ?? undefined) : input.visitId;

    let visitId: string | null = null;
    if (remoteChannel === SALURAN_PORTAL) {
      // Toko memesan sendiri lewat portal. Tautannya sudah diperiksa pemanggil,
      // yang mengisi `salesmanId` dengan pemegang toko; di sini hanya dipastikan
      // bahwa ia memang pemegangnya — portal tidak boleh mencatat pesanan atas
      // nama sembarang orang. Aturan WA/telepon salesman tidak berlaku di sini.
      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { salesmanId: true } });
      if (!toko?.salesmanId || toko.salesmanId !== input.salesmanId) throw new JarakJauhDitolakError("BUKAN_TOKO_SENDIRI");
    } else if (remoteChannel) {
      // Tanpa kunjungan, kepemilikan toko yang menggantikan bukti bahwa salesman
      // ini berurusan dengan toko itu. Aturan pemilik dibaca di transaksi ini.
      const aturan = await muatAturanJarakJauh(tx);
      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { salesmanId: true } });
      const tolak = periksaJarakJauh(aturan, { salesmanId: input.salesmanId, pemegangToko: toko?.salesmanId ?? null });
      if (tolak) throw new JarakJauhDitolakError(tolak);
    } else if (visitIdDiminta) {
      const v = await tx.storeVisit.findFirst({
        where: { id: visitIdDiminta, storeId: input.storeId, userId: input.salesmanId },
        select: { id: true },
      });
      if (!v) throw new NoActiveVisitError(input.storeId, input.salesmanId);
      visitId = v.id;
    } else {
      const active = await tx.storeVisit.findFirst({
        where: { storeId: input.storeId, userId: input.salesmanId, checkoutAt: null },
        select: { id: true },
      });
      if (!active) throw new NoActiveVisitError(input.storeId, input.salesmanId);
      visitId = active.id;
    }

    const store = await tx.store.findUniqueOrThrow({
      where: { id: input.storeId },
      select: { termsType: true, marginPercent: true },
    });
    const isKonsi = store.termsType === "KONSI";
    const margin = store.marginPercent === null ? null : Number(store.marginPercent);

    /*
     * Pre-order: dinilai di transaksi ini, dengan jam server, supaya pesanan
     * yang tertahan di antrean HP sampai sesudah tanggal tutup tidak ikut masuk.
     * Konsinyasi ditolak lebih dulu (lihat `periksaPesananInden`).
     */
    let inden: { id: string; name: string } | null = null;
    if (preorderWindowId) {
      const jendela = await tx.preorderWindow.findUnique({
        where: { id: preorderWindowId },
        select: { id: true, name: true, opensAt: true, closesAt: true, isActive: true, releasedAt: true },
      });
      const barangJendela = jendela
        ? await tx.preorderWindowItem.findMany({ where: { windowId: jendela.id }, select: { itemId: true } })
        : [];
      const tolak = periksaPesananInden({
        jendela,
        termsType: store.termsType,
        barangJendela: new Set(barangJendela.map((b) => b.itemId)),
        barangPesanan: input.lines.map((l) => l.itemId),
        now: new Date(),
      });
      if (tolak) throw new IndenDitolakError(tolak);
      inden = { id: jendela!.id, name: jendela!.name };
    }

    // Server-authoritative putus price: the salesman never sets it, the office rules (store price) do.
    const priceByItemId = new Map<string, number | null>();
    if (!isKonsi) {
      const itemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
      const items = await tx.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, minOrderQty: true, sellingPrice: true } });
      for (const i of items) priceByItemId.set(i.id, i.sellingPrice === null ? null : Number(i.sellingPrice));
      if (!input.skipMinQty) {
        // Minimum bertingkat: pesanan pertama vs pesan ulang (toko yang sudah punya
        // pesanan PUTUS disetujui). `Item.minOrderQty` tetap menimpa keduanya.
        const minToko = await muatMinimumToko(input.storeId, tx);
        const minByItemId = new Map(items.map((i) => [i.id, effectiveMinQty(i.minOrderQty, minToko.min)]));
        // Aggregate qty per item so an item's variants collectively satisfy the min.
        const qtyByItem = new Map<string, number>();
        for (const l of input.lines) qtyByItem.set(l.itemId, (qtyByItem.get(l.itemId) ?? 0) + l.qty);
        const aggLines = Array.from(qtyByItem, ([itemId, qty]) => ({ itemId, qty }));
        const violations = validateMinQtyLines(aggLines, minByItemId);
        if (violations.length > 0) throw new MinQtyViolationError(violations);
      }
    }

    const orderNo = await generateDocNumber(isKonsi ? "KONSI" : "PUTUS", tx);

    /*
     * Ganti: pesanan lama dibatalkan dan cadangan stoknya DILEPAS sebelum baris
     * baru dicadangkan di bawah — stok yang dipegang pesanan lama kembali
     * tersedia untuk penggantinya. Semua yang dinilai SESUDAH ini (kredit
     * BLOKIR, dsb.) melempar dan membatalkan seluruh transaksi, termasuk
     * pembatalan ini: pesanan lama tetap menunggu, tidak ada yang hilang.
     */
    if (lama) {
      const batal = await batalkanPesananDiTx(tx, {
        orderId: lama.id,
        orderNo: lama.orderNo,
        lineIds: lama.lineIds,
        olehId: input.salesmanId,
        alasan: alasanDiganti(orderNo),
        digantiDengan: { orderNo },
      });
      if (!batal) throw new PesananLamaTidakBisaDigantiError();
      barangStok.push(...lama.itemIds);
    }

    // Konsi lines carry no salesman price; gross-up is computed later at approve.
    const linesData = input.lines.map((l) => {
      const unitPrice = isKonsi
        ? 0
        : computeStorePrice({ sellingPrice: priceByItemId.get(l.itemId) ?? null, termsType: "PUTUS", marginPercent: margin }).price ?? 0;
      return {
        ...l,
        unitPrice,
        lineTotal: isKonsi ? 0 : l.qty * unitPrice,
        requestedUnitPrice: l.requestedUnitPrice ?? null,
        appealReason: l.appealReason ?? null,
      };
    });
    const subtotal = linesData.reduce((s, l) => s + l.lineTotal, 0);
    let finalTotal = subtotal;
    let kreditDitahan = false;

    const order = await tx.fieldSalesOrder.create({
      data: {
        orderNo,
        orderType: isKonsi ? "KONSI" : "PUTUS",
        storeId: input.storeId,
        salesmanId: input.salesmanId,
        visitId,
        status: "PENDING_APPROVAL",
        subtotal,
        total: subtotal,
        note: input.note,
        idempotencyKey: input.idempotencyKey ?? null,
        remoteChannel,
        preorderWindowId: inden?.id ?? null,
        replacesOrderId: lama?.id ?? null,
        lines: {
          create: linesData.map((l) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            productName: l.productName,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            requestedUnitPrice: l.requestedUnitPrice,
            appealReason: l.appealReason,
          })),
        },
      },
      include: { lines: true },
    });

    // Putus reserves at create; konsi reserves at approve (see approveFieldSalesOrder).
    // Pre-order (inden) reserves at release — the goods do not exist yet, so a hold now
    // would only push available negative and raise oversell alarms for stock nobody expects.
    let oversell: OversellAlert[] = [];
    if (!isKonsi) {
      if (!inden) {
        const r = await reserveFieldSalesOrder(tx, {
          orderNo,
          lines: order.lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
        });
        oversell = r.oversell;
        barangStok.push(...order.lines.map((l) => l.itemId));
      }

      // Apply promos (server-authoritative, honor-at-create).
      const now = new Date();
      const itemMeta = await tx.item.findMany({
        where: { id: { in: Array.from(new Set(order.lines.map((l) => l.itemId))) } },
        select: { id: true, inventoryValues: { select: { avgCost: true } } },
      });
      const avgCostById = new Map(itemMeta.map((i) => [i.id, i.inventoryValues[0] ? Number(i.inventoryValues[0].avgCost) : 0]));
      const promos = await fetchActivePromosForStore(input.storeId, now, tx);
      // Per-item aggregate + pro-rate — shared with previewFieldSalesPromos so the quote matches.
      const applied = applyItemAggregatedPromos(
        order.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: Number(l.unitPrice), avgCost: avgCostById.get(l.itemId) ?? 0 })),
        promos,
      );
      let netTotal = 0;
      for (let i = 0; i < order.lines.length; i++) {
        const l = order.lines[i];
        netTotal += Number(l.lineTotal) - applied.lineDiscounts[i];
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { discountAmount: applied.lineDiscounts[i], appliedPromoId: applied.lineAppliedPromoId[i] } });
      }
      netTotal -= applied.orderDiscountAmount;

      // Kredit dinilai atas total BERSIH (sesudah promo) — angka yang sama dengan
      // yang dilihat salesman di layar tinjau. BLOKIR melempar: seluruh transaksi
      // (nomor dokumen, reservasi stok) ikut batal, tidak ada pesanan yang tersisa.
      const putusan = kredit
        ? putuskanKreditPesanan(kredit.keadaan ? nilaiKredit(kredit.keadaan, kredit.aturan, kredit.batas, netTotal) : null, kredit.aturan.mode)
        : null;
      if (putusan?.blokir) throw new KreditDiblokirError(putusan.alasan);
      kreditDitahan = putusan?.ditahan ?? false;

      /*
       * Promo bonus ("beli X gratis Y"): barang gratis menjadi BARIS pesanan sendiri
       * (harga 0) supaya ikut dicadangkan, dikirim, dan keluar dari gudang — bukan
       * potongan yang tak terlihat. Dihitung SESUDAH baris pesanan dicadangkan, jadi
       * stok tersedia sudah bersih dari pesanan ini. Stok kurang tidak pernah menahan
       * pesanan: diberikan sebanyak yang ada, kekurangannya dicatat untuk kantor.
       * Total dan penilaian kredit tidak berubah — nilainya nol.
       */
      const bonus = await susunBonusPesanan(tx, {
        storeId: input.storeId,
        now,
        lines: order.lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: l.qty, productName: l.productName })),
        pesananBelumDicadangkan: false,
      });
      const barisBonus: Array<{ id: string; itemId: string; variantSku: string; qty: number }> = [];
      for (const b of bonus) {
        if (b.qty <= 0) continue;
        barisBonus.push(
          await tx.fieldSalesOrderLine.create({
            data: {
              orderId: order.id,
              itemId: b.itemId,
              variantSku: b.variantSku,
              productName: `${b.productName} (bonus)`,
              qty: b.qty,
              unitPrice: 0,
              lineTotal: 0,
              isBonus: true,
              bonusPromoId: b.promoId,
            },
            select: { id: true, itemId: true, variantSku: true, qty: true },
          }),
        );
      }
      // Baris bonus pesanan pre-order ikut dicadangkan bersama pesanannya saat rilis.
      if (barisBonus.length > 0 && !inden) {
        const rb = await reserveFieldSalesOrder(tx, {
          orderNo,
          lines: barisBonus.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
        });
        oversell = [...oversell, ...rb.oversell];
        barangStok.push(...barisBonus.map((l) => l.itemId));
      }
      const kurangBonus = catatanKurangBonus(bonus);

      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: {
          ...(kurangBonus ? { note: input.note?.trim() ? `${input.note}\n${kurangBonus}` : kurangBonus } : {}),
          total: netTotal,
          orderDiscountAmount: applied.orderDiscountAmount,
          appliedOrderPromoId: applied.appliedOrderPromoId,
          kreditDitahan,
          kreditCatatan: putusan?.catatan ?? null,
        },
      });
      finalTotal = netTotal;
    }

    notification = await tx.adminNotification.create({
      data: {
        category: "PENDING_ORDER_APPROVAL",
        severity: "INFO",
        title: `${isKonsi ? "Konsi transfer" : "Putus order"} ${orderNo} awaiting approval`,
        message:
          (isKonsi
            ? `New konsi transfer request ${orderNo} is pending approval.`
            : `New putus order ${orderNo} (total ${finalTotal}) is pending approval.${kreditDitahan ? " Credit on hold: check the store's bills before approving." : ""}`) +
          // Pesanan jarak jauh diberi tanda: tidak ada kunjungan yang menjadi buktinya.
          (remoteChannel ? ` Remote order (${remoteChannel}), taken without a store visit.` : "") +
          // Pre-order: stok belum dipegang sampai jendelanya dirilis.
          (inden ? ` Pre-order (${inden.name}): stock is held when the pre-order is released.` : "") +
          // Ganti: pesanan lama sudah dibatalkan di transaksi ini; kantor cukup memutuskan yang baru.
          (lama ? ` Replaces ${lama.orderNo}, which the salesman cancelled.` : ""),
        metadata: {
          orderId: order.id,
          orderNo,
          orderType: isKonsi ? "KONSI" : "PUTUS",
          storeId: input.storeId,
          salesmanId: input.salesmanId,
          total: finalTotal,
          kreditDitahan,
          remoteChannel,
          preorderWindowId: inden?.id ?? null,
          replacesOrderId: lama?.id ?? null,
        },
      },
    });

    return { orderId: order.id, orderNo, oversell, kreditDitahan };
  });

  /**
   * Outside the transaction on purpose — `fanOutAdminNotification` performs FCM network calls
   * and must never run inside one — and not awaited, because the salesman is watching a PWA
   * spinner on mobile data while the order that already committed waits on a bell ping. The
   * seam swallows its own failures, so there is no outcome here for this function to report.
   */
  if (notification) void fanOutAdminNotification(notification);
  // Best-effort, tidak pernah melempar: pesanan sudah tercatat.
  await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `pesanan ${result.orderNo}`, userId: input.salesmanId });
  return result;
}

export async function approveFieldSalesOrder(input: {
  orderId: string;
  approvedById: string;
  finalPrices?: Array<{ lineId: string; finalUnitPrice: number }>;
  addedLines?: Array<{ itemId: string; variantSku: string; qty: number }>;
  /** Wajib `true` untuk pesanan yang kreditnya ditahan saat dibuat (mode TAHAN). */
  kreditDiperiksa?: boolean;
}): Promise<{ ok: true }> {
  let kabar: { salesmanId: string; isi: Kabar } | undefined;
  // Barang yang keluar gudang (transfer konsi) atau dicadangkan (inden sesudah rilis) — push sesudah commit.
  let barangStok: string[] = [];
  let nomorPesanan = "";
  const hasil = await runSerializable(async (tx) => {
    /* Diulang saat deadlock — kabar dari percobaan yang batal tidak boleh ikut terkirim. */
    kabar = undefined;
    barangStok = [];
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { marginPercent: true, name: true } },
        lines: { include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } } },
      },
    });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "APPROVED");
    /**
     * Re-approving an already-APPROVED order is a no-op ONLY when the caller carries nothing new.
     * With additions it is not idempotent at all: two admins can have the same order open, and the
     * second one's staged products would be accepted, discarded, and reported as a success that
     * created nothing. Refuse instead, so the operator sees the same "already decided" toast an
     * already-approved order gets everywhere else.
     */
    if (order.status === "APPROVED") {
      if ((input.addedLines ?? []).length > 0) throw new InvalidOrderTransitionError(order.status, "APPROVED");
      return { ok: true as const };
    }
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "APPROVED");
    // Sesudah cek "sudah disetujui": menyetujui ulang pesanan yang sudah APPROVED
    // tetap no-op, tidak meminta centang lagi.
    if (order.kreditDitahan && input.kreditDiperiksa !== true) throw new KreditBelumDiperiksaError(order.id);

    if (order.orderType === "KONSI") {
      const added = input.addedLines ?? [];
      if (added.length > 0) {
        const onOrder = new Set(order.lines.map((l) => `${l.itemId}::${l.variantSku}`));
        const alreadySent = await sentItemIds(order.storeId, tx);
        const items = await tx.item.findMany({
          where: { id: { in: added.map((a) => a.itemId) }, isActive: true, type: "FINISHED_GOOD" },
          select: { id: true, nameId: true },
        });
        const byId = new Map(items.map((i) => [i.id, i]));
        // Same OR-tolerant (itemId, variantSku) lookup transferKonsiFieldSalesOrder's own
        // findFieldSalesInventory uses — a variantless row is stored keyed null, not "".
        const hasInventoryRow = async (itemId: string, variantSku: string) => {
          const inv =
            variantSku === ""
              ? await tx.inventoryValue.findFirst({ where: { itemId, OR: [{ variantSku: null }, { variantSku: "" }] } })
              : await tx.inventoryValue.findFirst({ where: { itemId, variantSku } });
          return inv !== null;
        };
        const seen = new Set<string>();
        // All validation runs before any write below, so a rejected payload never depends on
        // transaction rollback to leave the order untouched.
        for (const a of added) {
          const key = `${a.itemId}::${a.variantSku}`;
          if (!Number.isInteger(a.qty) || a.qty <= 0) throw new InvalidAddedLineError("BAD_QTY", a.itemId);
          // onOrder MUST be checked before alreadySent: sentItemIds(storeId) includes the
          // PENDING_APPROVAL order being approved, so every item already on this order is also
          // "already sent" — swapping the order changes which code fires for it (DUPLICATE vs
          // ALREADY_SENT), and the DUPLICATE test below pins the intended order.
          if (onOrder.has(key) || seen.has(key)) throw new InvalidAddedLineError("DUPLICATE", a.itemId);
          // ALREADY_SENT is item-level (sentItemIds has no variant dimension) while the dedupe
          // above is variant-level, so a different variant of an item already on the order is
          // rejected here, not there. Correct for an item-level "never sent" suggestion list —
          // flagged so it isn't a surprise to a future reader.
          if (alreadySent.has(a.itemId)) throw new InvalidAddedLineError("ALREADY_SENT", a.itemId);
          if (!byId.has(a.itemId)) throw new InvalidAddedLineError("UNKNOWN_ITEM", a.itemId);
          // A variantSku with no matching InventoryValue row would otherwise surface later as
          // a short line (available 0) out of transferKonsiFieldSalesOrder — "stok kurang" for a
          // product that simply has no stock row, which hides the real cause.
          // Its own code, not UNKNOWN_ITEM: the product exists and is active, so "not found or no
          // longer active" would be untrue and reloading the page would not surface the cause.
          if (!(await hasInventoryRow(a.itemId, a.variantSku))) throw new InvalidAddedLineError("NO_INVENTORY", a.itemId);
          seen.add(key);
        }
        for (const a of added) {
          const item = byId.get(a.itemId)!;
          await tx.fieldSalesOrderLine.create({
            data: {
              orderId: order.id,
              itemId: item.id,
              variantSku: a.variantSku,
              productName: item.nameId,
              qty: a.qty,
              unitPrice: 0,
              lineTotal: 0,
              addedById: input.approvedById,
            },
          });
        }
      }

      /* Re-read: the lines created above are not in the `order.lines` snapshot taken at the top. */
      const lines = await tx.fieldSalesOrderLine.findMany({
        where: { orderId: order.id },
        include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } },
      });

      /*
       * Toko konsinyasi = gudang lain milik kita (keputusan pemilik): disetujui = dikirim, jadi
       * barang keluar dari stok gudang utama DI SINI, per baris, di transaksi ini. Tidak ada
       * dokumen pengiriman konsinyasi terpisah. Stoknya kini dihitung di toko (buku toko /
       * titipan) dan kembali ke gudang hanya lewat retur (NRI). Bukan penjualan: tidak ada
       * SalesHistory. Satu baris kurang = seluruh persetujuan batal.
       */
      const { shortLines } = await transferKonsiFieldSalesOrder(tx, {
        orderNo: order.orderNo,
        lines: lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
        createdById: input.approvedById,
      });
      if (shortLines.length > 0) {
        throw new InsufficientStockError(shortLines.map((s) => ({ itemId: s.itemId, variantSku: s.variantSku, available: s.available })));
      }
      barangStok = lines.map((l) => l.itemId);
      nomorPesanan = order.orderNo;

      const margin = order.store.marginPercent === null ? null : Number(order.store.marginPercent);
      let total = 0;
      for (const l of lines) {
        const { price } = computeStorePrice({
          sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
          termsType: "KONSI",
          marginPercent: margin,
        });
        const unit = price ?? 0;
        const lineTotal = unit * l.qty;
        total += lineTotal;
        await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice: unit, lineTotal } });
      }
      await tx.fieldSalesOrder.update({
        where: { id: order.id },
        data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById, subtotal: total, total },
      });
      kabar = {
        salesmanId: order.salesmanId,
        isi: kabarPesananDisetujui({
          orderId: order.id,
          orderNo: order.orderNo,
          orderType: "KONSI",
          storeName: order.store.name,
          total,
          ajuanDiubah: 0,
          ajuanDiterima: 0,
          ditambahKantor: added.length,
        }),
      };
      return { ok: true as const };
    }

    if ((input.addedLines ?? []).length > 0) {
      throw new InvalidAddedLineError("NOT_KONSI", null);
    }

    /**
     * PUTUS: terapkan harga final banding dari pemilik lalu hitung ulang total pesanan. Stok dan
     * SalesHistory baru bergerak saat pengiriman (lihat delivery/writer.ts).
     *
     * Harga final = harga BERSIH per potong (keputusan pemilik). Promo baris dihitung dari harga
     * toko saat pesanan dibuat, jadi baris yang diberi harga final kehilangan potongan promonya
     * (`discountAmount` 0, `appliedPromoId` dilepas) — kalau tidak, 100.000 promo 10% yang
     * dibanding 80.000 tertagih 70.000. Promo tingkat PESANAN tetap "honor-at-create": nilainya
     * dihormati apa adanya dan tidak dihitung ulang, sama seperti sebelum ada banding.
     */
    const finalPriceByLineId = new Map((input.finalPrices ?? []).map((f) => [f.lineId, f.finalUnitPrice]));
    for (const [lineId, harga] of finalPriceByLineId) {
      if (!Number.isFinite(harga) || harga < 0) throw new HargaFinalTidakSahError(lineId, harga);
    }
    let ajuanDiubah = 0;
    let ajuanDiterima = 0;
    let subtotal = 0;
    const finalLines: Array<
      Omit<(typeof order.lines)[number], "unitPrice" | "lineTotal" | "discountAmount"> & {
        unitPrice: number;
        lineTotal: number;
        discountAmount: number;
      }
    > = [];
    for (const l of order.lines) {
      let unitPrice = Number(l.unitPrice);
      let lineTotal = Number(l.lineTotal);
      let discountAmount = Number(l.discountAmount);
      // Only an appealed line (requestedUnitPrice set) may be repriced; ignore stray entries.
      if (l.requestedUnitPrice !== null && finalPriceByLineId.has(l.id)) {
        unitPrice = finalPriceByLineId.get(l.id)!;
        lineTotal = l.qty * unitPrice;
        discountAmount = 0;
        await tx.fieldSalesOrderLine.update({
          where: { id: l.id },
          data: { unitPrice, lineTotal, discountAmount: 0, appliedPromoId: null },
        });
      }
      // Untuk kabar ke salesman: ajuan yang tidak diberi harga akhir jatuh ke harga
      // toko, jadi itu juga "diubah" dari sudut pandang yang mengajukan.
      if (l.requestedUnitPrice !== null) {
        if (unitPrice === Number(l.requestedUnitPrice)) ajuanDiterima += 1;
        else ajuanDiubah += 1;
      }
      subtotal += lineTotal;
      finalLines.push({ ...l, unitPrice, lineTotal, discountAmount });
    }
    const discountTotal = finalLines.reduce((s, l) => s + l.discountAmount, 0);
    const total = subtotal - discountTotal - Number(order.orderDiscountAmount);

    /*
     * Pre-order yang disetujui SESUDAH jendelanya dirilis: rilis sudah lewat dan
     * tidak akan menyentuh pesanan ini lagi, jadi stoknya dicadangkan di sini —
     * peringatan, bukan penolakan, untuk stok yang kurang (sama dengan PUTUS biasa).
     * `releasedAt` dibaca di transaksi serializable ini, jadi persetujuan yang
     * berbarengan dengan rilis diulang, bukan lolos tanpa dicadangkan siapa pun.
     * Sebelum rilis, persetujuan tetap hanya kertas: stoknya menunggu rilis.
     */
    if (order.preorderWindowId) {
      const jendela = await tx.preorderWindow.findUnique({ where: { id: order.preorderWindowId }, select: { releasedAt: true } });
      if (jendela?.releasedAt) {
        try {
          await cadangkanPesananInden(tx, { orderNo: order.orderNo, lines: order.lines });
          barangStok = order.lines.map((l) => l.itemId);
          nomorPesanan = order.orderNo;
        } catch (e) {
          // Barang tanpa baris persediaan = stok nol yang tercatat; aksi persetujuan sudah
          // memetakan kekurangan stok ke pesan yang menyebut barangnya.
          if (e instanceof BarangIndenBelumTercatatError) {
            throw new InsufficientStockError(e.baris.map((b) => ({ itemId: b.itemId, variantSku: b.variantSku, available: 0 })));
          }
          throw e;
        }
      }
    }

    /**
     * Stock consumption and SalesHistory no longer happen here — a putus order ships in one or
     * more deliveries (see delivery/writer.ts), and stock only leaves + SalesHistory is only
     * written when a delivery is recorded.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "APPROVED", approvedAt: new Date(), approvedById: input.approvedById, subtotal, total },
    });
    kabar = {
      salesmanId: order.salesmanId,
      isi: kabarPesananDisetujui({
        orderId: order.id,
        orderNo: order.orderNo,
        orderType: "PUTUS",
        storeName: order.store.name,
        total,
        ajuanDiubah,
        ajuanDiterima,
        ditambahKantor: 0,
      }),
    };
    return { ok: true as const };
  });
  if (kabar) kirimKabar(kabar.salesmanId, kabar.isi);
  await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `setujui pesanan ${nomorPesanan}`, userId: input.approvedById });
  return hasil;
}

export async function rejectFieldSalesOrder(input: { orderId: string; rejectedById: string; reason?: string }): Promise<{ ok: true }> {
  let kabar: { salesmanId: string; isi: Kabar } | undefined;
  let barangDilepas: string[] = [];
  let nomorPesanan = "";
  const hasil = await runSerializable(async (tx) => {
    kabar = undefined;
    barangDilepas = [];
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: { lines: { select: { id: true, itemId: true } }, store: { select: { name: true } } },
    });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "REJECTED");
    if (order.status === "REJECTED") return { ok: true as const };
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "REJECTED");

    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: order.lines.map((l) => l.id) });
    barangDilepas = order.lines.map((l) => l.itemId);
    nomorPesanan = order.orderNo;
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: input.rejectedById, rejectReason: input.reason },
    });
    kabar = {
      salesmanId: order.salesmanId,
      isi: kabarPesananDitolak({ orderId: order.id, orderNo: order.orderNo, storeName: order.store.name, alasan: input.reason ?? null }),
    };
    return { ok: true as const };
  });
  // Tolak ulang pesanan yang sudah ditolak tidak mengabari lagi — `kabar` hanya terisi saat status benar-benar berpindah.
  if (kabar) kirimKabar(kabar.salesmanId, kabar.isi);
  // Cadangan putus dilepas, available naik (konsi belum memegang stok: tanpa baris cadangan, push tetap aman).
  await antrekanPushStok(barangDilepas, { sumber: "ADJUSTMENT", ref: `tolak pesanan ${nomorPesanan}`, userId: input.rejectedById });
  return hasil;
}

/**
 * Batalkan satu pesanan yang MASIH menunggu, di dalam transaksi pemanggil:
 * compare-and-swap status (dua penekan bersamaan tidak bisa sama-sama berhasil),
 * lepas cadangan stoknya persis seperti tolak, dan tulis jejaknya di transaksi
 * yang sama. Mengembalikan false bila pesanan sudah tidak menunggu — pemanggil
 * yang memutuskan galatnya.
 *
 * Status menjadi `REJECTED` (semua kueri "pesanan hidup" memakai `<> REJECTED`);
 * `rejectedById`/`rejectedAt` ikut diisi supaya pembaca lama tetap utuh, dan
 * `cancelledById`/`cancelledAt` yang membedakannya dari penolakan kantor.
 * Konsinyasi belum memegang stok sebelum disetujui; melepasnya tidak berbuat apa-apa.
 */
async function batalkanPesananDiTx(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    orderNo: string;
    lineIds: string[];
    olehId: string;
    alasan: string;
    digantiDengan?: { orderNo: string };
  },
): Promise<boolean> {
  const sekarang = new Date();
  const r = await tx.fieldSalesOrder.updateMany({
    where: { id: input.orderId, status: "PENDING_APPROVAL" },
    data: {
      status: "REJECTED",
      rejectedAt: sekarang,
      rejectedById: input.olehId,
      rejectReason: input.alasan,
      cancelledAt: sekarang,
      cancelledById: input.olehId,
    },
  });
  if (r.count !== 1) return false;
  await releaseFieldSalesOrder(tx, { fieldSalesLineIds: input.lineIds });
  await tx.auditLog.create({
    data: {
      userId: input.olehId,
      action: AKSI_PESANAN_DIBATALKAN,
      entityType: ENTITAS_PESANAN,
      entityId: input.orderId,
      changes: {
        before: { status: "PENDING_APPROVAL" },
        after: { status: "REJECTED", cancelledById: input.olehId, cancelledAt: sekarang.toISOString() },
      },
      metadata: { orderNo: input.orderNo, ...(input.digantiDengan ? { digantiDengan: input.digantiDengan.orderNo } : {}) },
      reason: input.alasan,
    },
  });
  return true;
}

/**
 * Salesman membatalkan pesanannya sendiri selama masih menunggu persetujuan.
 *
 * - Alasan wajib (dipangkas, ≤500) — kantor perlu tahu kenapa pesanan hilang dari antreannya.
 * - Hanya pemiliknya; pesanan orang lain = TIDAK_DITEMUKAN (tidak membocorkan nomornya).
 * - Yang sudah disetujui atau ditolak kantor = SUDAH_DIPUTUSKAN.
 * - Membatalkan ulang pesanan yang sudah ia batalkan = tidak berbuat apa-apa (ketukan
 *   ganda, kiriman ulang), tanpa jejak kedua.
 *
 * Tidak ada kabar: antrean kantor kehilangan pesanan itu dengan sendirinya.
 */
export async function cancelFieldSalesOrderBySalesman(input: {
  orderId: string;
  salesmanId: string;
  reason: unknown;
}): Promise<{ ok: true; orderNo: string; sudahDibatalkan: boolean }> {
  const alasan = periksaAlasanBatal(input.reason);
  if (!alasan.ok) throw new BatalPesananError(alasan.kode);
  let barangDilepas: string[] = [];
  const hasil = await runSerializable(async (tx) => {
    barangDilepas = [];
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      select: { id: true, orderNo: true, status: true, salesmanId: true, cancelledById: true, lines: { select: { id: true, itemId: true } } },
    });
    if (!order || order.salesmanId !== input.salesmanId) throw new BatalPesananError("TIDAK_DITEMUKAN");
    if (order.status === "REJECTED" && order.cancelledById === input.salesmanId) {
      return { ok: true as const, orderNo: order.orderNo, sudahDibatalkan: true };
    }
    if (order.status !== "PENDING_APPROVAL") throw new BatalPesananError("SUDAH_DIPUTUSKAN");
    const berhasil = await batalkanPesananDiTx(tx, {
      orderId: order.id,
      orderNo: order.orderNo,
      lineIds: order.lines.map((l) => l.id),
      olehId: input.salesmanId,
      alasan: alasan.alasan,
    });
    if (!berhasil) throw new BatalPesananError("SUDAH_DIPUTUSKAN");
    barangDilepas = order.lines.map((l) => l.itemId);
    return { ok: true as const, orderNo: order.orderNo, sudahDibatalkan: false };
  });
  // Sesudah commit: cadangan dilepas, available naik — teruskan ke Jubelio.
  await antrekanPushStok(barangDilepas, { sumber: "ADJUSTMENT", ref: `batal pesanan ${hasil.orderNo}`, userId: input.salesmanId });
  return hasil;
}
