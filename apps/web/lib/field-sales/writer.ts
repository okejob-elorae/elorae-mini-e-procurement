import { prisma, reserveFieldSalesOrder, releaseFieldSalesOrder, reserveKonsiFieldSalesOrder, type OversellAlert, type AdminNotification, type Prisma } from "@elorae/db";
import { effectiveMinQty, validateMinQtyLines } from "@elorae/db/field-sales";
import { muatMinimumToko } from "./minimum-toko";
import { JarakJauhDitolakError, periksaJarakJauh, SALURAN_PORTAL, type SaluranPesanan } from "./jarak-jauh";
import { BatasHarianPortalError } from "./portal-toko-batas";
import { muatAturanJarakJauh } from "./jarak-jauh-toko";
import { susunBonusPesanan } from "./bonus";
import { catatanKurangBonus } from "./bonus-alokasi";
import { computeStorePrice } from "@elorae/db/pricing";
import { applyItemAggregatedPromos } from "./promo-apply";
import { fetchActivePromosForStore } from "@/lib/promos/queries";
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { computeStoreCreditExposure } from "@/lib/finance/ar/credit-exposure";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { NoActiveVisitError, MinQtyViolationError, InvalidOrderTransitionError, InsufficientStockError, InvalidAddedLineError, InvalidFinalPriceError, CreditLimitExceededError, ItemUnavailableError } from "./errors";
import { checkFinalPrices } from "./final-prices";
import { findOrderVisit } from "./visit";
import { sentItemIds } from "./queries";
import { openKonsiQtyByKey } from "./konsi-open-qty";
import { isStockableVariantKey } from "@/lib/items/variants";
import { findExistingInventoryValueRow } from "@/lib/inventory/costing";
import { nilaiKredit } from "@/lib/salesman/kredit";
import { betulkanHasilKunjunganDiTx } from "@/lib/salesman/transaksi-kunjungan";
import { kabariPengguna, type Kabar } from "@/lib/notifications/kabar-pengguna";
import { muatKreditToko } from "./kredit-toko";
import { KreditBelumDiperiksaError, KreditDiblokirError, putuskanKreditPesanan } from "./kredit-pesanan";
import { kabarPesananDisetujui } from "./kabar-pesanan";
import { BarangIndenBelumTercatatError, IndenDitolakError, periksaPesananInden } from "./inden";
import { BarangTanpaHargaError, barangTanpaHarga } from "./harga-wajib";
import { cadangkanPesananInden } from "./inden-writer";
import { bukaSumberPesananDitolak } from "./isi-keranjang-tolak";
import {
  AKSI_PESANAN_DIBATALKAN,
  ENTITAS_PESANAN,
  BatalPesananError,
  PesananLamaTidakBisaDigantiError,
  alasanDiganti,
  periksaAlasanBatal,
} from "./ganti-pesanan";

const AUDIT_REASON_MAX_LENGTH = 191;

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

/**
 * Potongan promo tingkat pesanan yang boleh berlaku: tidak pernah melewati
 * subtotal bersih (subtotal − potongan baris) dan tidak pernah minus, jadi
 * total pesanan tidak bisa di bawah 0. Satu tempat — keputusan pemilik
 * 2026-10-06 (sementara).
 */
export function batasiPromoPesanan(potongan: number, subtotalBersih: number): number {
  return Math.max(0, Math.min(potongan, subtotalBersih));
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
  /**
   * Portal toko: batas pesanan PORTAL per toko sejak `sejak` (awal hari WIB),
   * dihitung DI DALAM transaksi serializable ini — kiriman serentak tidak bisa
   * sama-sama lolos. Penuh → `BatasHarianPortalError`.
   */
  batasHarianPortal?: { maks: number; sejak: Date } | null;
}): Promise<{ orderId: string; orderNo: string; oversell: OversellAlert[]; creditHold: boolean; kreditDitahan: boolean }> {
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
  let creditNotification: AdminNotification | undefined;
  let creditHold = false;
  // Barang yang available-nya berubah (cadangan baru, cadangan pesanan lama dilepas) — push sesudah commit.
  let barangStok: string[] = [];
  const result = await runSerializable(async (tx) => {
    /* Retry re-runs this whole callback; reset so a rolled-back attempt's row never survives into the next one. */
    notification = undefined;
    creditNotification = undefined;
    creditHold = false;
    barangStok = [];
    // Tetap PALING DULU: kiriman ulang (antrean HP, jaringan putus di tengah jalan)
    // mengembalikan pesanan yang sudah ada apa adanya — tidak dinilai ulang, jadi
    // pesanan yang sudah tercatat tidak mungkin tiba-tiba ditolak karena kredit.
    if (input.idempotencyKey) {
      const existing = await tx.fieldSalesOrder.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, orderNo: true, creditHoldAtCreate: true, kreditDitahan: true },
      });
      if (existing) {
        return {
          orderId: existing.id,
          orderNo: existing.orderNo,
          oversell: [] as OversellAlert[],
          creditHold: existing.creditHoldAtCreate,
          kreditDitahan: existing.kreditDitahan,
        };
      }
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
      if (input.batasHarianPortal) {
        const { maks, sejak } = input.batasHarianPortal;
        const hariIni = await tx.fieldSalesOrder.count({
          where: { storeId: input.storeId, remoteChannel: SALURAN_PORTAL, createdAt: { gte: sejak } },
        });
        if (hariIni >= maks) throw new BatasHarianPortalError(maks);
      }
    } else if (remoteChannel) {
      // Tanpa kunjungan, kepemilikan toko yang menggantikan bukti bahwa salesman
      // ini berurusan dengan toko itu. Aturan pemilik dibaca di transaksi ini.
      const aturan = await muatAturanJarakJauh(tx);
      const toko = await tx.store.findUnique({ where: { id: input.storeId }, select: { salesmanId: true } });
      const tolak = periksaJarakJauh(aturan, { salesmanId: input.salesmanId, pemegangToko: toko?.salesmanId ?? null });
      if (tolak) throw new JarakJauhDitolakError(tolak);
    } else {
      const visit = await findOrderVisit(tx, { storeId: input.storeId, salesmanId: input.salesmanId, visitId: visitIdDiminta });
      if (!visit) throw new NoActiveVisitError(input.storeId, input.salesmanId);
      visitId = visit.id;
    }

    /* Same predicate as the konsi approve path's added lines. */
    const lineItemIds = Array.from(new Set(input.lines.map((l) => l.itemId)));
    const sellable = await tx.item.findMany({
      where: { id: { in: lineItemIds }, isActive: true, type: "FINISHED_GOOD" },
      select: { id: true },
    });
    const sellableIds = new Set(sellable.map((i) => i.id));
    const unavailable = lineItemIds.filter((id) => !sellableIds.has(id));
    if (unavailable.length > 0) throw new ItemUnavailableError(unavailable);

    const store = await tx.store.findUniqueOrThrow({
      where: { id: input.storeId },
      select: { termsType: true, markupPercent: true, priceDiscountPercent: true, creditLimit: true },
    });
    const isKonsi = store.termsType === "KONSI";
    const markup = store.markupPercent === null ? null : Number(store.markupPercent);
    const priceDiscount = store.priceDiscountPercent === null ? null : Number(store.priceDiscountPercent);

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
      // Barang tanpa harga (kosong, 0, atau tidak dikenal) tidak dijual PUTUS — dulu lolos sebagai baris Rp 0.
      const tanpaHarga = barangTanpaHarga(input.lines.map((l) => l.itemId), priceByItemId);
      if (tanpaHarga.length > 0) throw new BarangTanpaHargaError(tanpaHarga);
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

    /* Konsi lines carry no salesman price; the retail value at the store's markup is computed later at approve. */
    const linesData = input.lines.map((l) => {
      const unitPrice = isKonsi
        ? 0
        : computeStorePrice({ sellingPrice: priceByItemId.get(l.itemId) ?? null, termsType: "PUTUS", markupPercent: markup, priceDiscountPercent: priceDiscount }).price ?? 0;
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

      /*
       * Kredit, dua lapis. Dasarnya batas nilai toko: eksposur piutang toko sekarang
       * (`computeStoreCreditExposure`) ditambah total bersih pesanan ini dibandingkan dengan
       * `Store.creditLimit`; lewat batas → `creditHoldAtCreate`, dan persetujuannya butuh
       * alasan override (`enforceApproveCreditLimit`). Di atasnya mode kredit pemilik
       * (PERINGATAN/TAHAN/BLOKIR) dengan batas faktur terbuka dan janji bayar: BLOKIR menolak
       * pesanan di sini, TAHAN menandai `kreditDitahan` sehingga penyetuju wajib menyatakan
       * sudah memeriksa tagihan.
       */
      creditHold = false;
      let creditExposureAtCreate: number | null = null;
      let creditLimitAtCreate: number | null = null;
      const creditLimit = store.creditLimit === null ? null : Number(store.creditLimit);
      if (creditLimit !== null) {
        const exposure = await computeStoreCreditExposure(tx, input.storeId);
        creditHold = exposure.total + netTotal > creditLimit;
        creditExposureAtCreate = exposure.total;
        creditLimitAtCreate = creditLimit;
      }

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
          creditHoldAtCreate: creditHold,
          creditExposureAtCreate,
          creditLimitAtCreate,
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

    if (creditHold) {
      creditNotification = await tx.adminNotification.create({
        data: {
          category: "CREDIT_LIMIT_HOLD",
          severity: "WARNING",
          title: `Order ${orderNo} exceeds store's credit limit`,
          message: `Putus order ${orderNo} (total ${finalTotal}) puts the store over its credit limit and needs an override to approve.`,
          metadata: { orderId: order.id, orderNo, storeId: input.storeId, salesmanId: input.salesmanId, total: finalTotal },
        },
      });
    }

    return { orderId: order.id, orderNo, oversell, creditHold, kreditDitahan };
  });

  /**
   * Outside the transaction on purpose — `fanOutAdminNotification` performs FCM network calls
   * and must never run inside one — and not awaited, because the salesman is watching a PWA
   * spinner on mobile data while the order that already committed waits on a bell ping. The
   * seam swallows its own failures, so there is no outcome here for this function to report.
   */
  if (notification) void fanOutAdminNotification(notification);
  if (creditNotification) void fanOutAdminNotification(creditNotification);
  // Best-effort, tidak pernah melempar: pesanan sudah tercatat.
  await antrekanPushStok(barangStok, { sumber: "ADJUSTMENT", ref: `pesanan ${result.orderNo}`, userId: input.salesmanId });
  return result;
}

/**
 * Which of the given (itemId, variantSku) candidates are CURRENT assortment gaps for this store,
 * batched into a fixed handful of queries regardless of candidate count. Mirrors
 * `listAssortmentGaps`'s gap test (which reads through the un-transacted `prisma` singleton) —
 * `targetQty === null` means "must merely be present" (`effectiveQty <= 0`), `targetQty !== null`
 * means a minimum (`effectiveQty < targetQty`). Run inside the approval's own transaction so the
 * `StoreStock` and open-konsi-order reads are consistent with each other and with the order lines
 * the approval is about to write, not a stale snapshot from before the transaction opened.
 *
 * The gap test itself sums physical `StoreStock` with `openKonsiQtyByKey` (same helper
 * `listAssortmentGaps` uses) into an `effectiveQty`, so a store already carrying an
 * approved-but-undelivered konsi line for this item is not offered back as a gap before those
 * units are delivered — this function returns only keys, so unlike `listAssortmentGaps` it has
 * no reason to report the physical and not-yet-delivered figures separately.
 */
async function currentAssortmentGapKeys(
  tx: Prisma.TransactionClient,
  storeId: string,
  candidates: Array<{ itemId: string; variantSku: string }>,
): Promise<Set<string>> {
  if (candidates.length === 0) return new Set();
  const itemIds = Array.from(new Set(candidates.map((c) => c.itemId)));
  const lines = await tx.storeAssortmentLine.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, targetQty: true },
  });
  if (lines.length === 0) return new Set();
  const stockRows = await tx.storeStock.findMany({
    where: { storeId, itemId: { in: itemIds } },
    select: { itemId: true, variantSku: true, qty: true },
  });
  const onHandByKey = new Map(stockRows.map((r) => [`${r.itemId}::${r.variantSku ?? ""}`, r.qty.toNumber()]));
  const openByKey = await openKonsiQtyByKey(tx, storeId, itemIds);
  const gapKeys = new Set<string>();
  for (const line of lines) {
    const key = `${line.itemId}::${line.variantSku ?? ""}`;
    const onHandQty = onHandByKey.get(key) ?? 0;
    const inTransitQty = openByKey.get(key) ?? 0;
    const effectiveQty = onHandQty + inTransitQty;
    const targetQty = line.targetQty === null ? null : line.targetQty.toNumber();
    const isGap = targetQty === null ? effectiveQty <= 0 : effectiveQty < targetQty;
    if (isGap) gapKeys.add(key);
  }
  return gapKeys;
}

type CreditOverrideStamp = {
  creditExposureAtApprove: number;
  creditLimitAtApprove: number;
  creditOverrideReason: string;
  creditOverrideById: string;
  creditOverrideAt: Date;
};

/**
 * The approve-time credit gate both order types share, run inside the approver's serializable
 * transaction. A store with no credit limit (`null`) is not gated. Otherwise the store's live
 * `computeStoreCreditExposure` plus `orderTotal` is compared against the limit: a PUTUS approve
 * passes its final order total, a KONSI approve passes 0, because consigned goods are not owed
 * until a sell-through report invoices them. Over the limit with no override reason it THROWS
 * `CreditLimitExceededError` — never a return, since `runSerializable` commits on return. With a
 * reason it writes the `CREDIT_LIMIT_OVERRIDE` audit row and hands back the five approve-side
 * columns for the caller's own status write; within the limit it returns null.
 */
async function enforceApproveCreditLimit(
  tx: Prisma.TransactionClient,
  input: {
    orderId: string;
    storeId: string;
    creditLimit: Prisma.Decimal | null;
    orderTotal: number;
    approvedById: string;
    creditOverrideReason?: string;
  },
): Promise<CreditOverrideStamp | null> {
  if (input.creditLimit === null) return null;
  const creditLimit = Number(input.creditLimit);
  const exposure = await computeStoreCreditExposure(tx, input.storeId);
  if (exposure.total + input.orderTotal > creditLimit) {
    const reason = input.creditOverrideReason?.trim();
    if (!reason) {
      throw new CreditLimitExceededError(exposure, creditLimit, input.orderTotal);
    }
    await tx.auditLog.create({
      data: {
        userId: input.approvedById,
        action: "CREDIT_LIMIT_OVERRIDE",
        entityType: "FieldSalesOrder",
        entityId: input.orderId,
        /* `AuditLog.reason` is VARCHAR(191); the full reason is kept on `creditOverrideReason` (`@db.Text`). */
        reason: Array.from(reason).slice(0, AUDIT_REASON_MAX_LENGTH).join(""),
        metadata: { exposure, creditLimit, orderTotal: input.orderTotal },
      },
    });
    return {
      creditExposureAtApprove: exposure.total,
      creditLimitAtApprove: creditLimit,
      creditOverrideReason: reason,
      creditOverrideById: input.approvedById,
      creditOverrideAt: new Date(),
    };
  }
  return null;
}

export async function approveFieldSalesOrder(input: {
  orderId: string;
  approvedById: string;
  finalPrices?: Array<{ lineId: string; finalUnitPrice: number }>;
  addedLines?: Array<{ itemId: string; variantSku: string; qty: number }>;
  creditOverrideReason?: string;
  /** Wajib `true` untuk pesanan yang kreditnya ditahan saat dibuat (mode TAHAN). */
  kreditDiperiksa?: boolean;
}): Promise<{ ok: true }> {
  let kabar: { salesmanId: string; isi: Kabar } | undefined;
  // Barang yang dicadangkan (konsi, inden sesudah rilis) — push sesudah commit.
  let barangStok: string[] = [];
  let nomorPesanan = "";
  const hasil = await runSerializable(async (tx) => {
    /* Diulang saat deadlock — kabar dari percobaan yang batal tidak boleh ikut terkirim. */
    kabar = undefined;
    barangStok = [];
    const order = await tx.fieldSalesOrder.findUnique({
      where: { id: input.orderId },
      include: {
        store: { select: { markupPercent: true, priceDiscountPercent: true, creditLimit: true, name: true } },
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
      /* input.finalPrices is ignored here on purpose: konsi lines carry no salesman price to appeal. */
      const added = input.addedLines ?? [];
      if (added.length > 0) {
        const onOrder = new Set(order.lines.map((l) => `${l.itemId}::${l.variantSku}`));
        const alreadySent = await sentItemIds(order.storeId, tx);
        const gapKeys = await currentAssortmentGapKeys(
          tx,
          order.storeId,
          added.map((a) => ({ itemId: a.itemId, variantSku: a.variantSku ?? "" })),
        );
        const items = await tx.item.findMany({
          where: { id: { in: added.map((a) => a.itemId) }, isActive: true, type: "FINISHED_GOOD" },
          select: { id: true, nameId: true, variants: true },
        });
        const byId = new Map(items.map((i) => [i.id, i]));
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
          //
          // EXCEPT: an item sentItemIds flags as "already sent" can still be a CURRENT assortment
          // gap for this store (shipped once, now at zero, or below its target) — exactly the
          // population listKonsiAssortmentGaps exists to surface, and exactly what the gap panel
          // just offered the admin to stage. Refusing it here would abort the whole approval for
          // the feature's primary use case. gapKeys is keyed at (itemId, variantSku) grain, so a
          // gap on one variant does not exempt a different variant of the same item — that other
          // variant still hits ALREADY_SENT below, unchanged. ALREADY_SENT still fires for a line
          // that is merely "never sent" and NOT a current gap — i.e. an admin re-adding something
          // the never-sent list should not have offered.
          if (alreadySent.has(a.itemId) && !gapKeys.has(key)) throw new InvalidAddedLineError("ALREADY_SENT", a.itemId);
          if (!byId.has(a.itemId)) throw new InvalidAddedLineError("UNKNOWN_ITEM", a.itemId);
          /**
           * A variantSku with no matching InventoryValue row would otherwise surface later as
           * InventoryValueMissingError out of reserveKonsiFieldSalesOrder — a @elorae/db class
           * with no `code`, which the action layer has nothing to map to a UI-facing reason.
           * Its own code, not UNKNOWN_ITEM: the product exists and is active, so "not found or no
           * longer active" would be untrue and reloading the page would not surface the cause.
           *
           * Stock is per variant for an item with SKU variants: a "" line would reserve against a
           * pooled variantless row and land StoreStock on "", where per-variant SPG sales and the
           * gap tests never see it. So such an item takes only its own variant SKUs, and a
           * variantless item only "" — `isStockableVariantKey` is the one spelling of that rule,
           * shared with the konsi push writer. The row lookup then reuses the shared OR-tolerant
           * `findExistingInventoryValueRow`, since a variantless row is stored keyed null or "".
           */
          if (!isStockableVariantKey(byId.get(a.itemId)!.variants, a.variantSku ?? "")) throw new InvalidAddedLineError("NO_INVENTORY", a.itemId);
          if (!(await findExistingInventoryValueRow(tx, a.itemId, a.variantSku))) throw new InvalidAddedLineError("NO_INVENTORY", a.itemId);
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

      const konsi = await approveKonsiOrderInTx(tx, {
        orderId: order.id,
        approvedById: input.approvedById,
        creditOverrideReason: input.creditOverrideReason,
      });
      barangStok = konsi.itemIds;
      nomorPesanan = order.orderNo;
      kabar = {
        salesmanId: order.salesmanId,
        isi: kabarPesananDisetujui({
          orderId: order.id,
          orderNo: order.orderNo,
          orderType: "KONSI",
          storeName: order.store.name,
          total: konsi.total,
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
    const priceCheck = checkFinalPrices(order.lines, input.finalPrices);
    if (!priceCheck.ok) throw new InvalidFinalPriceError(priceCheck.code, priceCheck.lineId);

    let ajuanDiubah = 0;
    let ajuanDiterima = 0;
    let subtotal = 0;
    const finalLines: Array<{ id: string; unitPrice: number; lineTotal: number; discountAmount: number; changed: boolean }> = [];
    for (const l of order.lines) {
      let unitPrice = Number(l.unitPrice);
      let lineTotal = Number(l.lineTotal);
      let discountAmount = Number(l.discountAmount);
      let changed = false;
      /* checkFinalPrices already refused anything but exactly one entry per appealed line. */
      if (l.requestedUnitPrice !== null && finalPriceByLineId.has(l.id)) {
        unitPrice = finalPriceByLineId.get(l.id)!;
        lineTotal = l.qty * unitPrice;
        discountAmount = 0;
        changed = true;
      }
      // Untuk kabar ke salesman: ajuan yang tidak diberi harga yang diajukan dihitung "diubah".
      if (l.requestedUnitPrice !== null) {
        if (unitPrice === Number(l.requestedUnitPrice)) ajuanDiterima += 1;
        else ajuanDiubah += 1;
      }
      subtotal += lineTotal;
      finalLines.push({ id: l.id, unitPrice, lineTotal, discountAmount, changed });
    }
    const discountTotal = finalLines.reduce((s, l) => s + l.discountAmount, 0);
    /*
     * Promo pesanan dihormati sejak dibuat, tapi tidak boleh melewati subtotal bersih
     * sesudah harga final banding (keputusan pemilik 2026-10-06) — kalau tidak, total
     * minus. Angka yang DIBATASI yang disimpan: pengiriman memprorata `orderDiscountAmount`.
     */
    const orderDiscountAmount = batasiPromoPesanan(Number(order.orderDiscountAmount), subtotal - discountTotal);
    const total = subtotal - discountTotal - orderDiscountAmount;

    /**
     * Credit gate — computed and enforced BEFORE any write below, including the per-line
     * unitPrice/lineTotal updates the finalPrices loop used to fire first. `runSerializable` is a
     * plain `prisma.$transaction`: it commits on a normal return and rolls back only on a throw,
     * so a refusal placed after any write would commit that write while reporting a block. See
     * docs/superpowers/specs/2026-08-27-credit-limit-enforcement-design.md § 4.
     *
     * The order being approved is still PENDING_APPROVAL here — computeStoreCreditExposure only
     * counts APPROVED orders in its residual term, so this order is not counted against itself.
     */
    const creditOverride = await enforceApproveCreditLimit(tx, {
      orderId: order.id,
      storeId: order.storeId,
      creditLimit: order.store.creditLimit,
      orderTotal: total,
      approvedById: input.approvedById,
      creditOverrideReason: input.creditOverrideReason,
    });

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

    for (const l of finalLines) {
      if (l.changed) {
        await tx.fieldSalesOrderLine.update({
          where: { id: l.id },
          data: { unitPrice: l.unitPrice, lineTotal: l.lineTotal, discountAmount: 0, appliedPromoId: null },
        });
      }
    }

    /**
     * Stock consumption and SalesHistory no longer happen here — a putus order ships in one or
     * more deliveries (see delivery/writer.ts), and stock only leaves + SalesHistory is only
     * written when a delivery is recorded.
     */
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: {
        status: "APPROVED",
        approvedAt: new Date(),
        approvedById: input.approvedById,
        subtotal,
        total,
        orderDiscountAmount,
        ...(creditOverride ?? {}),
      },
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

/**
 * The KONSI half of an approval, shared by `approveFieldSalesOrder` and the admin push
 * (`createKonsiPushOrder`): gate on the store's credit exposure, reserve every line against main
 * stock, price each line at the store's markup (an informational value; nothing bills from it)
 * and flip the order to APPROVED. It runs inside the caller's serializable transaction and throws
 * `CreditLimitExceededError` or `InsufficientStockError` (naming every short line), so the
 * caller's whole transaction rolls back, any lines it wrote first included. It moves no stock.
 * The caller must already have verified a PENDING_APPROVAL KONSI order: this checks neither the
 * status nor the type. A line that already has a reservation is skipped, not re-reserved, so a
 * wrong order is not refused here — it is repriced at the konsi markup and flipped to APPROVED.
 * Returns the repriced total and the reserved lines' item ids (for the post-commit stock push).
 */
export async function approveKonsiOrderInTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; approvedById: string; creditOverrideReason?: string },
): Promise<{ total: number; itemIds: string[] }> {
  const order = await tx.fieldSalesOrder.findUniqueOrThrow({
    where: { id: input.orderId },
    select: {
      id: true,
      orderNo: true,
      storeId: true,
      store: { select: { markupPercent: true, priceDiscountPercent: true, creditLimit: true } },
    },
  });

  /**
   * Gated on exposure alone, before any reservation or price write: the order's own retail value
   * is never added (orderTotal 0), because consigned goods stay ours until a sell-through report
   * invoices them — and that invoice's receivable is what counts toward exposure. Both konsi
   * approve paths reach this through here, so neither can skip it; an already-APPROVED replay
   * returns before its caller ever gets here and stays ungated.
   */
  const creditOverride = await enforceApproveCreditLimit(tx, {
    orderId: order.id,
    storeId: order.storeId,
    creditLimit: order.store.creditLimit,
    orderTotal: 0,
    approvedById: input.approvedById,
    creditOverrideReason: input.creditOverrideReason,
  });

  /* Read the lines fresh: the caller may have created some inside this same transaction. */
  const lines = await tx.fieldSalesOrderLine.findMany({
    where: { orderId: order.id },
    include: { item: { select: { sku: true, sellingPrice: true, category: { select: { name: true } } } } },
  });

  const { shortLines } = await reserveKonsiFieldSalesOrder(tx, {
    orderNo: order.orderNo,
    lines: lines.map((l) => ({ fieldSalesLineId: l.id, itemId: l.itemId, variantSku: l.variantSku, qty: l.qty })),
  });
  if (shortLines.length > 0) throw new InsufficientStockError(shortLines);

  const markup = order.store.markupPercent === null ? null : Number(order.store.markupPercent);
  const priceDiscount = order.store.priceDiscountPercent === null ? null : Number(order.store.priceDiscountPercent);
  let total = 0;
  for (const l of lines) {
    const { price } = computeStorePrice({
      sellingPrice: l.item.sellingPrice === null ? null : Number(l.item.sellingPrice),
      termsType: "KONSI",
      markupPercent: markup,
      priceDiscountPercent: priceDiscount,
    });
    const unit = price ?? 0;
    const lineTotal = unit * l.qty;
    total += lineTotal;
    await tx.fieldSalesOrderLine.update({ where: { id: l.id }, data: { unitPrice: unit, lineTotal } });
  }

  /**
   * Approve only RESERVES konsi stock. It moves main → the store's virtual warehouse at
   * delivery-shipment completion (`completeDeliveryShipment`), one `KonsiTransfer` per
   * completed shipment, so a short or refused delivery never lands at the store. Never
   * through a FIELD_SALES_CONSUME mover: konsi is a transfer, not a sale. No SalesHistory for konsi.
   */
  await tx.fieldSalesOrder.update({
    where: { id: order.id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedById: input.approvedById,
      subtotal: total,
      total,
      ...(creditOverride ?? {}),
    },
  });
  return { total, itemIds: lines.map((l) => l.itemId) };
}

/** The salesman's rejection notice. The notification helper caps it to its `VARCHAR(191)` column; the full reason stays on the order. */
export function buildOrderRejectionBody(orderNo: string, reason: string | undefined): string {
  return reason ? `Order ${orderNo} ditolak: ${reason}` : `Order ${orderNo} ditolak`;
}

export async function rejectFieldSalesOrder(input: { orderId: string; rejectedById: string; reason?: string }): Promise<{ ok: true }> {
  let barangDilepas: string[] = [];
  let nomorPesanan = "";
  const rejected = await runSerializable(async (tx) => {
    barangDilepas = [];
    const order = await tx.fieldSalesOrder.findUnique({ where: { id: input.orderId }, include: { lines: { select: { id: true, itemId: true } } } });
    if (!order) throw new InvalidOrderTransitionError("MISSING", "REJECTED");
    if (order.status === "REJECTED") return null;
    if (order.status !== "PENDING_APPROVAL") throw new InvalidOrderTransitionError(order.status, "REJECTED");

    await releaseFieldSalesOrder(tx, { fieldSalesLineIds: order.lines.map((l) => l.id) });
    barangDilepas = order.lines.map((l) => l.itemId);
    nomorPesanan = order.orderNo;
    await tx.fieldSalesOrder.update({
      where: { id: order.id },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectedById: input.rejectedById, rejectReason: input.reason },
    });
    return { orderId: order.id, orderNo: order.orderNo, storeId: order.storeId, salesmanId: order.salesmanId };
  });

  /*
   * After the commit and best-effort: the rejection already stands, so a failed push must never
   * surface as a failed reject. An idempotent replay of an already-rejected order returns null
   * above and notifies nobody a second time.
   */
  if (rejected) {
    try {
      const salesman = await prisma.user.findUnique({ where: { id: rejected.salesmanId }, select: { id: true, fcmToken: true } });
      if (salesman) {
        await sendNotificationToUsers([salesman], {
          type: "FIELD_SALES_ORDER_REJECTED",
          title: `Order ${rejected.orderNo} ditolak`,
          body: buildOrderRejectionBody(rejected.orderNo, input.reason),
          data: { orderId: rejected.orderId, orderNo: rejected.orderNo, storeId: rejected.storeId },
        });
      }
    } catch (err) {
      console.error(`[field-sales] rejection notice failed for ${rejected.orderNo}`, err);
    }
  }
  /*
   * Sesudah commit: permintaan SPG / rekomendasi yang dibuatkan pesanan ini dibuka lagi
   * (keputusan pemilik 2026-10-06). Idempoten dan tidak pernah melempar, jadi dipanggil
   * juga pada tolak ulang — kalau panggilan pertama gagal di tengah jalan, ini yang memperbaikinya.
   */
  await bukaSumberPesananDitolak(input.orderId);
  // Cadangan dilepas, available naik — teruskan ke Jubelio.
  await antrekanPushStok(barangDilepas, { sumber: "ADJUSTMENT", ref: `tolak pesanan ${nomorPesanan}`, userId: input.rejectedById });
  return { ok: true };
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
      select: {
        id: true,
        orderNo: true,
        status: true,
        salesmanId: true,
        cancelledById: true,
        visitId: true,
        lines: { select: { id: true, itemId: true } },
      },
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
    /*
     * Kunjungan yang sudah check-out dengan hasil TRANSAKSI hanya karena pesanan
     * ini: hasilnya dicabut di transaksi yang sama (keputusan pemilik 2026-10-06).
     * Dinilai SESUDAH pembatalan di atas, jadi pesanan ini sudah tidak terhitung.
     */
    if (order.visitId) {
      await betulkanHasilKunjunganDiTx(tx, {
        visitId: order.visitId,
        olehId: input.salesmanId,
        alasan: alasan.alasan,
        sebab: { orderId: order.id, orderNo: order.orderNo },
      });
    }
    barangDilepas = order.lines.map((l) => l.itemId);
    return { ok: true as const, orderNo: order.orderNo, sudahDibatalkan: false };
  });
  // Sesudah commit: cadangan dilepas, available naik — teruskan ke Jubelio.
  await antrekanPushStok(barangDilepas, { sumber: "ADJUSTMENT", ref: `batal pesanan ${hasil.orderNo}`, userId: input.salesmanId });
  return hasil;
}
