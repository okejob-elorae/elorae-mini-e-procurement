import { prisma } from '@elorae/db';
import type { ArchiveFolder } from '@/components/archive/DocumentArchive';
import { susunFolder } from './susun-folder';

/**
 * Folder archives, one per document family.
 *
 * Each groups documents by the party they belong to — a store, a vendor —
 * because that is how someone looks for a printed note months later ("what did
 * we send Toko Sinar Jaya?"), and no date-ordered list answers that.
 *
 * Every archive keeps the parties that are EXPECTED to hold documents even
 * with zero documents (every active store; for work orders, every CMT
 * supplier). A folder that disappears when empty makes the archive look
 * complete when it is not, and hides the fact that a store has never been
 * billed at all. Folder building and the summary totals: `susun-folder.ts`.
 */

const rupiah = (value: number) =>
  `Rp ${Math.round(value).toLocaleString('id-ID')}`;

/**
 * Delivery notes per store.
 *
 * `pending` counts deliveries whose tax invoice is still PENDING — a nota
 * tagihan that has been issued to a store but carries no faktur number yet.
 * That is real unfinished work with a real consequence at tax time, which is
 * what earns the red dot.
 *
 * Active stores always get a folder; an inactive store only while it still has
 * notes, so every note stays reachable and the summary equals the folders.
 */
export async function getNotaTokoArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [stores, deliveries] = await Promise.all([
    prisma.store.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.fieldSalesDelivery.findMany({
      select: {
        id: true,
        total: true,
        order: { select: { storeId: true } },
        taxInvoice: { select: { status: true } },
      },
    }),
  ]);

  return susunFolder(
    stores,
    deliveries.map((d) => ({
      pihakId: d.order.storeId,
      pending: d.taxInvoice?.status === 'PENDING',
      nilai: Number(d.total),
    })),
    {
      tampilKosong: (store) => store.isActive,
      meta: (jumlah, nilai) => (jumlah > 0 ? `${jumlah} nota · ${rupiah(nilai)}` : null),
      href: (store) => `/backoffice/archive/toko/${store.id}`,
    },
  );
}

/** Vendor returns per supplier. Pending = not yet processed or completed. */
export async function getReturPemasokArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [vendors, returns] = await Promise.all([
    prisma.supplier.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    }),
    prisma.vendorReturn.findMany({
      select: { id: true, vendorId: true, status: true },
    }),
  ]);

  return susunFolder(
    vendors,
    returns.map((r) => ({ pihakId: r.vendorId, pending: r.status === 'DRAFT' || r.status === 'SUBMITTED' })),
    {
      tampilKosong: (vendor) => vendor.isActive,
      // Same word as the summary ("N nota retur"), so one term carries one meaning.
      meta: (jumlah) => (jumlah > 0 ? `${jumlah} nota retur` : null),
      href: (vendor) => `/backoffice/vendor-returns?vendorId=${vendor.id}`,
    },
  );
}

/** Supplier type code of a CMT / sewing supplier — the only kind that receives work orders. */
const JENIS_PEMASOK_CMT = 'TAILOR';

/**
 * Work orders per CMT vendor. Pending = still open on the floor.
 *
 * Only CMT (sewing) suppliers get an empty folder: a fabric or accessories
 * supplier never receives a work order, and listing it as "kosong" buried the
 * tailors under folders that can never fill. Any supplier that DOES hold a
 * work order still gets its folder, whatever its type.
 */
export async function getWorkOrderArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [vendors, workOrders] = await Promise.all([
    prisma.supplier.findMany({
      select: { id: true, name: true, isActive: true, type: { select: { code: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.findMany({
      select: { id: true, vendorId: true, status: true },
    }),
  ]);

  return susunFolder(
    vendors,
    workOrders.map((wo) => ({
      pihakId: wo.vendorId,
      pending:
        wo.status === 'DRAFT' || wo.status === 'ISSUED' || wo.status === 'IN_PRODUCTION' || wo.status === 'PARTIAL',
    })),
    {
      tampilKosong: (vendor) => vendor.isActive && vendor.type?.code === JENIS_PEMASOK_CMT,
      // "perintah kerja", like the summary and the tab — not "WO" beside "13 perintah kerja".
      meta: (jumlah) => (jumlah > 0 ? `${jumlah} perintah kerja` : null),
      href: (vendor) => `/backoffice/work-orders?vendorId=${vendor.id}`,
    },
  );
}

export type StoreDeliveryRow = {
  id: string;
  docNo: string;
  orderId: string;
  orderNo: string;
  deliveredAt: string;
  /** Tanggal nota tagihan — the date the Faktur pajak queue shows as "Tanggal nota". */
  invoiceDate: string;
  dueDate: string;
  total: number;
  taxStatus: string | null;
};

/**
 * The documents inside one store's folder.
 *
 * Rows link to the order that owns the delivery rather than re-implementing
 * the print flow: DeliveriesCard on that page already builds both notes and
 * stamps the first print. Duplicating ~150 lines of print builder here would
 * mean two places to keep correct, and the second one would drift.
 */
export async function getStoreDeliveries(storeId: string): Promise<{
  storeName: string | null;
  rows: StoreDeliveryRow[];
  totalValue: number;
  pendingTax: number;
}> {
  const [store, deliveries] = await Promise.all([
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
    prisma.fieldSalesDelivery.findMany({
      where: { order: { storeId } },
      orderBy: [{ invoiceDate: 'desc' }, { deliveredAt: 'desc' }],
      select: {
        id: true,
        docNo: true,
        deliveredAt: true,
        invoiceDate: true,
        dueDate: true,
        total: true,
        orderId: true,
        order: { select: { orderNo: true } },
        taxInvoice: { select: { status: true } },
      },
    }),
  ]);

  const rows = deliveries.map((d) => ({
    id: d.id,
    docNo: d.docNo,
    orderId: d.orderId,
    orderNo: d.order.orderNo,
    deliveredAt: d.deliveredAt.toISOString(),
    invoiceDate: d.invoiceDate.toISOString(),
    dueDate: d.dueDate.toISOString(),
    total: Number(d.total),
    taxStatus: d.taxInvoice?.status ?? null,
  }));

  return {
    storeName: store?.name ?? null,
    rows,
    totalValue: rows.reduce((sum, r) => sum + r.total, 0),
    pendingTax: rows.filter((r) => r.taxStatus === 'PENDING').length,
  };
}
