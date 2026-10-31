import { prisma, Prisma, sqlId } from '@elorae/db';
import { deliveredGoodsValue, undeliveredResidual } from "@/lib/field-sales/delivery/undelivered-residual";
import { nilaiBersihSpg, nilaiSpgElorae, rentangTren, saluranMarketplace, susunTren, type BarisSaluran, type TitikTren } from './tren';
import { awalMingguIniWib, batasHariIniWib } from './hari-wib';
import { overduePOWhere } from '@/lib/purchase-orders/overdue';
import { kesehatanStokPerBarang } from './kesehatan-stok';
import {
  bacaRencana,
  hitungKekuranganBahan,
  STATUS_WO_BUTUH_BAHAN,
  type KekuranganBahan,
  type KekuranganVendor,
  type KekuranganWo,
  type WoUntukBahan,
} from './kekurangan-bahan';


export type DashboardStats = {
  po: {
    /** Waiting for approval (DRAFT). */
    draft: number;
    /** Approved and sent to the supplier (SUBMITTED). */
    submitted: number;
    inProduction: number;
    thisWeek: number;
    overdue: number;
    /** Nilai seluruh PO. `null` bila dimuat untuk beranda (`kartu`): tidak ada kartu yang menggambarnya. */
    totalValue: number | null;
  };
  items: {
    activeCount: number;
    /**
     * Barang MENIPIS (tersedia > 0 dan ≤ titik pesan ulang) — definisi ringkasan
     * Inventori (`kesehatanStokPerBarang`). 0 dan TIDAK dimuat bila kartu stok
     * tersembunyi — `statistikBeranda` membuangnya.
     */
    lowStockCount: number;
    /** Barang HABIS (tersedia = 0), definisi yang sama. */
    habisCount: number;
  };
  workOrders: {
    /** Berjalan = sedang diproduksi + selesai sebagian. */
    inProduction: number;
    /** `IN_PRODUCTION` saja — daftar SPK `?status=IN_PRODUCTION`. */
    sedangDiproduksi: number;
    /** `PARTIAL` saja — daftar SPK `?status=PARTIAL`. */
    selesaiSebagian: number;
    completedToday: number;
  };
  suppliers: {
    activeCount: number;
  };
  inventory: {
    /** Nilai seluruh persediaan. `null` bila dimuat untuk beranda (`kartu`): tidak ada kartu yang menggambarnya. */
    totalValue: number | null;
  };
  grnsThisWeek: number;
  movementsToday: number;
};

/**
 * `kartu` = kartu beranda yang tampil (`kartuBeranda`). Dengan itu kueri kartu
 * yang tersembunyi dilewati: stok menipis hanya untuk kartu stok, dan dua
 * agregat rupiah (nilai persediaan, nilai PO) tidak dijalankan sama sekali
 * karena tidak ada kartu yang menggambarnya. Tanpa `kartu` semuanya dimuat.
 */
export async function getDashboardStats(kartu?: { stok: boolean }): Promise<DashboardStats> {
  const now = new Date();
  // Hari dan minggu WIB — produksi berjalan di UTC, dan `setHours(0)` di sana
  // memotong hari jam 07.00 WIB.
  const todayStart = batasHariIniWib(now).awal;
  const weekStart = awalMingguIniWib(now);

  const [
    poDraft,
    poSubmitted,
    poPartial,
    poThisWeek,
    poOverdue,
    poTotalValue,
    itemsActive,
    inventoryRows,
    inventoryTotalValue,
    woInProduction,
    woPartial,
    woCompletedToday,
    suppliersActive,
    grnsThisWeek,
    movementsToday,
  ] = await Promise.all([
    prisma.purchaseOrder.count({ where: { status: 'DRAFT' } }),
    prisma.purchaseOrder.count({ where: { status: 'SUBMITTED' } }),
    prisma.purchaseOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.purchaseOrder.count({
      where: { createdAt: { gte: weekStart } },
    }),
    prisma.purchaseOrder.count({ where: overduePOWhere(now) }),
    kartu ? null : prisma.purchaseOrder.aggregate({ _sum: { grandTotal: true } }),
    prisma.item.count({ where: { isActive: true } }),
    // Semua baris (bukan hanya yang bertitik pesan ulang): "habis" berlaku untuk setiap barang.
    kartu && !kartu.stok
      ? []
      : prisma.inventoryValue.findMany({
          select: { itemId: true, qtyOnHand: true, reservedQty: true, item: { select: { reorderPoint: true } } },
        }),
    kartu ? null : prisma.inventoryValue.aggregate({ _sum: { totalValue: true } }),
    prisma.workOrder.count({ where: { status: 'IN_PRODUCTION' } }),
    prisma.workOrder.count({ where: { status: 'PARTIAL' } }),
    prisma.workOrder.count({
      where: {
        status: 'COMPLETED',
        completedAt: { gte: todayStart, lte: now },
      },
    }),
    prisma.supplier.count({ where: { isActive: true } }),
    prisma.gRN.count({
      where: { grnDate: { gte: weekStart } },
    }),
    /* Counts every location (main, store, van), not just MAIN - this is the more truthful
     * answer to "what happened today" now that the ledger sees store/van movements that
     * StockMovement never recorded. That makes this number RISE relative to what the
     * dashboard showed before, on any day with store or van activity - that is a
     * correction, not a regression. A second, unrelated cause of a rise: the ledger's
     * cutover backfill stamps createdAt: NOW(3) on every OPENING row it writes, so on the
     * day that migration runs, this count also includes one row per non-zero balance
     * across main/store/van. Historical on production, but live every time the shared dev
     * bed or a fresh environment gets migrated - that is a one-day artefact, not a bug. */
    prisma.stockLedgerEntry.count({
      where: { createdAt: { gte: todayStart } },
    }),
    // Umpan "Aktivitas terkini" sudah tidak di beranda (ada halaman jejak
    // audit), jadi log audit tidak lagi dibaca di sini.
  ]);

  // Sama dengan ringkasan Inventori: per barang, tersedia = di tangan − dipesan.
  const kesehatan = kesehatanStokPerBarang(
    inventoryRows.map((r) => ({
      itemId: r.itemId,
      qtyOnHand: r.qtyOnHand,
      reservedQty: r.reservedQty,
      reorderPoint: r.item.reorderPoint,
    })),
  );

  return {
    po: {
      draft: poDraft,
      submitted: poSubmitted,
      inProduction: poPartial,
      thisWeek: poThisWeek,
      overdue: poOverdue,
      totalValue: poTotalValue ? Number(poTotalValue._sum.grandTotal ?? 0) : null,
    },
    items: {
      activeCount: itemsActive,
      lowStockCount: kesehatan.menipis,
      habisCount: kesehatan.habis,
    },
    workOrders: {
      inProduction: woInProduction + woPartial,
      sedangDiproduksi: woInProduction,
      selesaiSebagian: woPartial,
      completedToday: woCompletedToday,
    },
    suppliers: {
      activeCount: suppliersActive,
    },
    inventory: {
      totalValue: inventoryTotalValue ? Number(inventoryTotalValue._sum.totalValue ?? 0) : null,
    },
    grnsThisWeek,
    movementsToday,
  };
}

export type RawMaterialShortageVendorWo = KekuranganWo;

/** Vendors (CMT / WO vendor) whose work orders still need this material. */
export type RawMaterialShortageVendor = KekuranganVendor;

export type RawMaterialShortageRow = KekuranganBahan & {
  itemName: string;
  uomCode: string;
};

/**
 * Bahan baku yang masih harus dikeluarkan ke perintah kerja tetapi stok
 * tersedianya tidak cukup. Aturannya di `hitungKekuranganBahan` — lihat di sana
 * kenapa aturan lama (rencana penuh vs stok di tangan, hanya WO yang sedang
 * diproduksi) terbalik.
 */
export async function getRawMaterialShortage(): Promise<RawMaterialShortageRow[]> {
  const wos = await prisma.workOrder.findMany({
    where: { status: { in: [...STATUS_WO_BUTUH_BAHAN] } },
    select: {
      id: true,
      docNumber: true,
      vendorId: true,
      consumptionPlan: true,
      vendor: { select: { name: true, code: true } },
    },
  });

  const untukBahan: WoUntukBahan[] = wos.map((wo) => ({
    woId: wo.id,
    docNumber: wo.docNumber,
    vendorId: wo.vendorId,
    vendorName: wo.vendor.name,
    vendorCode: wo.vendor.code ?? null,
    rencana: bacaRencana(wo.consumptionPlan),
  }));
  const itemIds = Array.from(
    new Set(untukBahan.flatMap((wo) => wo.rencana.map((r) => r.itemId).filter((id): id is string => !!id))),
  );
  if (itemIds.length === 0) return [];

  const inventoryRows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, qtyOnHand: true, reservedQty: true },
  });
  const tersedia = new Map<string, number>();
  for (const r of inventoryRows) {
    tersedia.set(r.itemId, (tersedia.get(r.itemId) ?? 0) + Number(r.qtyOnHand) - Number(r.reservedQty));
  }

  const kurang = hitungKekuranganBahan(untukBahan, tersedia);
  if (kurang.length === 0) return [];

  const items = await prisma.item.findMany({
    where: { id: { in: kurang.map((k) => k.itemId) } },
    select: { id: true, nameId: true, uom: { select: { code: true } } },
  });
  const itemById = new Map(items.map((i) => [i.id, i]));

  return kurang.map((k) => ({
    ...k,
    itemName: itemById.get(k.itemId)?.nameId ?? k.itemId,
    uomCode: itemById.get(k.itemId)?.uom?.code ?? "",
  }));
}

export type WorkOrderStatusCount = {
  status: string;
  count: number;
  totalPlannedQty: number;
};

/** Work orders grouped by status with counts and total planned qty. */
export async function getWorkOrderCountByStatus(): Promise<WorkOrderStatusCount[]> {
  const wos = await prisma.workOrder.findMany({
    select: { status: true, plannedQty: true },
  });
  const byStatus = new Map<string, { count: number; totalPlanned: number }>();
  const statusOrder = ['DRAFT', 'ISSUED', 'IN_PRODUCTION', 'PARTIAL', 'COMPLETED', 'CANCELLED'];
  for (const s of statusOrder) {
    byStatus.set(s, { count: 0, totalPlanned: 0 });
  }
  for (const wo of wos) {
    const s = wo.status;
    if (!byStatus.has(s)) byStatus.set(s, { count: 0, totalPlanned: 0 });
    const rec = byStatus.get(s)!;
    rec.count += 1;
    rec.totalPlanned += Number(wo.plannedQty) || 0;
  }
  return statusOrder.map((status) => {
    const rec = byStatus.get(status) ?? { count: 0, totalPlanned: 0 };
    return { status, count: rec.count, totalPlannedQty: rec.totalPlanned };
  });
}

/** Active suppliers for dashboard report filters. */
export async function getSuppliersForReportFilter(): Promise<
  { id: string; name: string; code: string }[]
> {
  return prisma.supplier.findMany({
    where: { status: 'ACTIVE', isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' },
  });
}

/** COGS / inventory value split: raw materials vs finished goods. */
export async function getCOGSRawVsFinished(): Promise<{
  rawValue: number;
  finishedValue: number;
  rawCount: number;
  finishedCount: number;
}> {
  const rows = await prisma.inventoryValue.findMany({
    where: { qtyOnHand: { gt: 0 } },
    include: { item: { select: { type: true } } },
  });
  const byItem = new Map<string, { totalValue: number; type: string }>();
  for (const r of rows) {
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { totalValue: val, type: r.item.type });
    }
  }
  let rawValue = 0;
  let finishedValue = 0;
  let rawCount = 0;
  let finishedCount = 0;
  for (const a of byItem.values()) {
    if (a.type === 'FINISHED_GOOD') {
      finishedValue += a.totalValue;
      finishedCount += 1;
    } else {
      rawValue += a.totalValue;
      rawCount += 1;
    }
  }
  return { rawValue, finishedValue, rawCount, finishedCount };
}

export type OversoldInventoryRow = {
  itemId: string;
  variantSku: string | null;
  sku: string;
  nameId: string;
  qtyOnHand: number;
  reservedQty: number;
  available: number;
};

export type SalesmenSalesBucket = {
  count: number;
  amount: number;
};

/** Apa yang dihitung `realised.count` — disebut apa adanya, bukan "transaksi". */
export type RincianTerealisasi = {
  pengiriman: number;
  van: number;
  /**
   * Pesanan putus BERBEDA yang sudah punya pengiriman — supaya angka di beranda bisa
   * dicocokkan dengan daftar pesanan tujuannya (satu pesanan bisa dikirim dua kali).
   */
  pesanan: number;
};

export type SalesmanSalesRow = {
  salesmanId: string;
  salesmanName: string;
  realised: SalesmenSalesBucket;
  realisedRincian: RincianTerealisasi;
  awaitingDelivery: SalesmenSalesBucket;
  outstanding: SalesmenSalesBucket;
  /** Putus DISETUJUI yang belum satu pun dikirim (`deliveryStatus` PENDING) — daftar `?kirim=PENDING`. */
  menungguKirim: SalesmenSalesBucket;
};

export type SalesmenSalesSummary = {
  rows: SalesmanSalesRow[];
  totals: {
    realised: SalesmenSalesBucket;
    realisedRincian: RincianTerealisasi;
    awaitingDelivery: SalesmenSalesBucket;
    outstanding: SalesmenSalesBucket;
    menungguKirim: SalesmenSalesBucket;
  };
};

/**
 * Row shape of the realised-deliveries aggregate. `COUNT(*)` arrives as a BigInt and a summed
 * DECIMAL as a string or a Decimal depending on the driver, so both go through `Number()`.
 */
type RealisedDeliveryRow = {
  salesmanId: string;
  deliveryCount: bigint | number;
  orderCount: bigint | number;
  totalAmount: string | number | null;
};

/**
 * All-time per-salesman sales in four buckets. KONSI is excluded from every bucket; REJECTED
 * (incl. cancelled) never counts.
 * - realised = sum of FieldSalesDelivery.total on PUTUS orders + all VanSale.total.
 * - awaitingDelivery = APPROVED PUTUS orders whose deliveryStatus is PENDING or PARTIAL, valued at
 *   the undelivered residual (see undeliveredResidual), measured against each delivery's exact
 *   goods value (deliveredGoodsValue), not its whole-rupiah total, with the count being orders.
 * - outstanding = PENDING_APPROVAL PUTUS FieldSalesOrder.total, i.e. awaiting approval.
 * - menungguKirim = APPROVED PUTUS orders with no delivery yet (`deliveryStatus` PENDING),
 *   at the order total — exactly the rows of `/backoffice/field-sales-orders?kirim=PENDING`.
 *
 * Realised counts DELIVERIES, not approved orders. Approval stopped moving stock once delivery
 * became its own document, and nothing recomputes FieldSalesOrder.total when only part of an order
 * ships or a remainder is closed — so an approved order's total permanently overstates what the
 * store actually received. That is why awaitingDelivery uses the residual, not the order total.
 * A fully delivered or closed order sits in no awaiting bucket; what shipped is in realised.
 */
export async function getSalesmenSalesSummary(): Promise<SalesmenSalesSummary> {
  const [realisedDeliveries, realisedVan, outstandingPutus, awaitingDeliveryPutus, approvedUndelivered] = await Promise.all([
    prisma.$queryRaw<RealisedDeliveryRow[]>(Prisma.sql`
      SELECT o.${sqlId('salesmanId')} AS ${sqlId('salesmanId')},
             COUNT(*) AS ${sqlId('deliveryCount')},
             COUNT(DISTINCT d.${sqlId('orderId')}) AS ${sqlId('orderCount')},
             SUM(d.${sqlId('total')}) AS ${sqlId('totalAmount')}
      FROM ${sqlId('FieldSalesDelivery')} d
      JOIN ${sqlId('FieldSalesOrder')} o ON o.${sqlId('id')} = d.${sqlId('orderId')}
      WHERE o.${sqlId('orderType')} = 'PUTUS'
      GROUP BY o.${sqlId('salesmanId')}
    `),
    prisma.vanSale.groupBy({
      by: ['salesmanId'],
      _count: true,
      _sum: { total: true },
    }),
    prisma.fieldSalesOrder.groupBy({
      by: ['salesmanId'],
      where: { orderType: 'PUTUS', status: 'PENDING_APPROVAL' },
      _count: true,
      _sum: { total: true },
    }),
    prisma.fieldSalesOrder.findMany({
      where: { orderType: "PUTUS", status: "APPROVED", deliveryStatus: { in: ["PENDING", "PARTIAL"] } },
      select: {
        salesmanId: true,
        total: true,
        deliveries: { select: { subtotal: true, discountAmount: true, lines: { select: { discountAmount: true } } } },
      },
    }),
    // Saringan yang SAMA dengan `listFieldSalesOrders({ kirim: 'PENDING' })`.
    prisma.fieldSalesOrder.groupBy({
      by: ['salesmanId'],
      where: { orderType: 'PUTUS', status: 'APPROVED', deliveryStatus: 'PENDING' },
      _count: true,
      _sum: { total: true },
    }),
  ]);

  type Rekap = {
    realised: SalesmenSalesBucket;
    realisedRincian: RincianTerealisasi;
    awaitingDelivery: SalesmenSalesBucket;
    outstanding: SalesmenSalesBucket;
    menungguKirim: SalesmenSalesBucket;
  };
  const bySalesman = new Map<string, Rekap>();
  const ensure = (id: string) => {
    let rec = bySalesman.get(id);
    if (!rec) {
      rec = {
        realised: { count: 0, amount: 0 },
        realisedRincian: { pengiriman: 0, van: 0, pesanan: 0 },
        awaitingDelivery: { count: 0, amount: 0 },
        outstanding: { count: 0, amount: 0 },
        menungguKirim: { count: 0, amount: 0 },
      };
      bySalesman.set(id, rec);
    }
    return rec;
  };

  for (const r of realisedDeliveries) {
    const rec = ensure(r.salesmanId);
    const n = Number(r.deliveryCount ?? 0);
    rec.realised.count += n;
    rec.realisedRincian.pengiriman += n;
    rec.realisedRincian.pesanan += Number(r.orderCount ?? 0);
    rec.realised.amount += Number(r.totalAmount ?? 0);
  }
  for (const r of realisedVan) {
    const rec = ensure(r.salesmanId);
    const n = Number(r._count ?? 0);
    rec.realised.count += n;
    rec.realisedRincian.van += n;
    rec.realised.amount += Number(r._sum.total ?? 0);
  }
  for (const r of outstandingPutus) {
    const rec = ensure(r.salesmanId);
    rec.outstanding.count += Number(r._count ?? 0);
    rec.outstanding.amount += Number(r._sum.total ?? 0);
  }
  for (const o of awaitingDeliveryPutus) {
    const rec = ensure(o.salesmanId);
    rec.awaitingDelivery.count += 1;
    rec.awaitingDelivery.amount += undeliveredResidual(
      Number(o.total),
      o.deliveries.map((d) =>
        deliveredGoodsValue({
          subtotal: Number(d.subtotal),
          discountAmount: Number(d.discountAmount),
          lineDiscounts: d.lines.map((l) => Number(l.discountAmount)),
        }),
      ),
    );
  }
  for (const r of approvedUndelivered) {
    const rec = ensure(r.salesmanId);
    rec.menungguKirim.count += Number(r._count ?? 0);
    rec.menungguKirim.amount += Number(r._sum.total ?? 0);
  }

  const salesmanIds = Array.from(bySalesman.keys());
  const users =
    salesmanIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: salesmanIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
  const nameById = new Map(users.map((u) => [u.id, u.name ?? u.email ?? '—']));

  const rows: SalesmanSalesRow[] = salesmanIds.map((id) => {
    const rec = bySalesman.get(id)!;
    return {
      salesmanId: id,
      salesmanName: nameById.get(id) ?? '—',
      ...rec,
    };
  });
  rows.sort((a, b) => b.realised.amount - a.realised.amount);

  const totals = rows.reduce<SalesmenSalesSummary['totals']>(
    (acc, r) => {
      acc.realised.count += r.realised.count;
      acc.realised.amount += r.realised.amount;
      acc.realisedRincian.pengiriman += r.realisedRincian.pengiriman;
      acc.realisedRincian.van += r.realisedRincian.van;
      acc.realisedRincian.pesanan += r.realisedRincian.pesanan;
      acc.awaitingDelivery.count += r.awaitingDelivery.count;
      acc.awaitingDelivery.amount += r.awaitingDelivery.amount;
      acc.outstanding.count += r.outstanding.count;
      acc.outstanding.amount += r.outstanding.amount;
      acc.menungguKirim.count += r.menungguKirim.count;
      acc.menungguKirim.amount += r.menungguKirim.amount;
      return acc;
    },
    {
      realised: { count: 0, amount: 0 },
      realisedRincian: { pengiriman: 0, van: 0, pesanan: 0 },
      awaitingDelivery: { count: 0, amount: 0 },
      outstanding: { count: 0, amount: 0 },
      menungguKirim: { count: 0, amount: 0 },
    },
  );

  return { rows, totals };
}

/** InventoryValue rows where reservedQty exceeds qtyOnHand (negative available = oversell). */
export async function getOversoldInventory(): Promise<OversoldInventoryRow[]> {
  const rows = await prisma.inventoryValue.findMany({
    where: { reservedQty: { gt: 0 } },
    include: { item: { select: { sku: true, nameId: true } } },
  });
  return rows
    .map((r) => ({
      itemId: r.itemId,
      variantSku: r.variantSku,
      sku: r.item.sku,
      nameId: r.item.nameId,
      qtyOnHand: Number(r.qtyOnHand),
      reservedQty: Number(r.reservedQty),
      available: Number(r.qtyOnHand) - Number(r.reservedQty),
    }))
    .filter((r) => r.available < 0)
    .sort((a, b) => a.available - b.available);
}

// Lencana menu "stok minus" memakai `hitungBarangStokMinus` (per BARANG, sama
// dengan Beranda dan Inventori `?oversold=1`), bukan hitungan per baris varian.

/**
 * Penjualan per hari untuk grafik tren beranda, 180 hari terakhir — cukup
 * untuk membandingkan 90 hari dengan 90 hari sebelumnya.
 *
 * Definisinya SAMA dengan kartu-kartu beranda, supaya grafik dan angkanya
 * tidak berselisih: marketplace = SalesOrder per `transactionDate` tanpa yang
 * batal/retur (seperti `getMarketplaceKpi`); lapangan = pengiriman pesanan
 * PUTUS per `deliveredAt` + penjualan van per `createdAt` + penjualan SPG per
 * `createdAt`, bersih dari barang yang dikembalikan pembeli — nota SPG di toko
 * KONSI dengan harga Elorae, bukan harga toko (KEPUTUSAN 19, `nilaiSpgElorae`). Transfer
 * konsinyasi BUKAN penjualan dan tidak dihitung. Setiap baris membawa
 * salurannya (Shopee/TikTok/Tokopedia/lain, putus/van/SPG) supaya grafik bisa
 * dilihat per saluran tanpa kueri kedua.
 *
 * Dijumlah di JavaScript, bukan GROUP BY tanggal di SQL: pemotongan tanggal
 * per zona waktu ditulis berbeda di MariaDB (produksi) dan PostgreSQL (lokal),
 * dan satu baris (tanggal, nilai) per pesanan tetap ringan untuk beberapa ribu
 * pesanan. Kalau volumenya tumbuh jauh, pindahkan ke agregasi harian.
 */
export async function getTrenPenjualan(hariIni: Date = new Date()): Promise<TitikTren[]> {
  const HARI = 180;
  const baris = await ambilPenjualan(new Date(hariIni.getTime() - (HARI + 1) * 86_400_000));
  return susunTren(baris, hariIni, HARI);
}

/**
 * Tren untuk rentang pilihan pengguna, DITAMBAH periode sama panjang tepat
 * sebelumnya — supaya pembandingnya dihitung dengan cara yang sama seperti
 * 7/30/90 hari. `null` untuk rentang yang tidak sah (lihat `rentangTren`).
 */
export async function getTrenPenjualanRentang(mulai: string, akhir: string): Promise<TitikTren[] | null> {
  const r = rentangTren(mulai, akhir);
  if (!r) return null;
  const baris = await ambilPenjualan(
    new Date(`${r.mulaiPembanding}T00:00:00+07:00`),
    new Date(`${akhir}T23:59:59.999+07:00`),
  );
  return susunTren(baris, new Date(`${akhir}T12:00:00+07:00`), r.panjang * 2);
}

async function ambilPenjualan(dari: Date, sampai?: Date): Promise<BarisSaluran[]> {
  const waktu = sampai ? { gte: dari, lte: sampai } : { gte: dari };
  const [pesanan, kiriman, van, spg] = await Promise.all([
    prisma.salesOrder.findMany({
      where: { transactionDate: waktu, status: { notIn: ['CANCELLED', 'RETURNED'] } },
      select: { transactionDate: true, grandTotal: true, channel: true },
    }),
    prisma.fieldSalesDelivery.findMany({
      where: { deliveredAt: waktu, order: { orderType: 'PUTUS' } },
      select: { deliveredAt: true, total: true },
    }),
    prisma.vanSale.findMany({
      where: { createdAt: waktu },
      select: { createdAt: true, total: true },
    }),
    // SPG ikut "lapangan": judul grafiknya "marketplace dan lapangan", dan nota
    // SPG adalah penjualan lapangan yang sudah terjadi. Sebelumnya ia tidak
    // tergambar sama sekali.
    prisma.spgSale.findMany({
      where: { createdAt: waktu },
      select: {
        createdAt: true,
        total: true,
        lines: { select: { unitPrice: true, returnedQty: true, qty: true, lineTotal: true } },
        // KEPUTUSAN 19: nota toko KONSI dikonversi ke harga Elorae (`nilaiSpgElorae`).
        store: { select: { termsType: true, markupPercent: true } },
      },
    }),
  ]);
  return [
    ...pesanan.map((p) => ({
      tanggal: p.transactionDate,
      nilai: Number(p.grandTotal),
      saluran: saluranMarketplace(p.channel),
    })),
    ...kiriman.map((k) => ({ tanggal: k.deliveredAt, nilai: Number(k.total), saluran: 'putus' as const })),
    ...van.map((v) => ({ tanggal: v.createdAt, nilai: Number(v.total), saluran: 'van' as const })),
    ...spg.map((n) => ({
      tanggal: n.createdAt,
      nilai: nilaiSpgElorae(nilaiBersihSpg(n.total, n.lines), n.store),
      saluran: 'spg' as const,
    })),
  ];
}
