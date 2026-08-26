import { prisma } from '@elorae/db';
import type { ArchiveFolder } from '@/components/archive/DocumentArchive';

/**
 * Folder archives, one per document family.
 *
 * Each groups documents by the party they belong to — a store, a vendor —
 * because that is how someone looks for a printed note months later ("what did
 * we send Toko Sinar Jaya?"), and no date-ordered list answers that.
 *
 * Every archive keeps parties with zero documents in the result. A folder that
 * disappears when empty makes the archive look complete when it is not, and
 * hides the fact that a store has never been billed at all.
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
 */
export async function getNotaTokoArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [stores, deliveries] = await Promise.all([
    prisma.store.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
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

  const byStore = new Map<string, { count: number; value: number; pending: number }>();
  for (const d of deliveries) {
    const key = d.order.storeId;
    const acc = byStore.get(key) ?? { count: 0, value: 0, pending: 0 };
    acc.count += 1;
    acc.value += Number(d.total);
    if (d.taxInvoice?.status === 'PENDING') acc.pending += 1;
    byStore.set(key, acc);
  }

  const folders = stores.map((store) => {
    const acc = byStore.get(store.id) ?? { count: 0, value: 0, pending: 0 };
    return {
      id: store.id,
      name: store.name,
      count: acc.count,
      pending: acc.pending,
      meta: acc.count > 0 ? `${acc.count} nota · ${rupiah(acc.value)}` : null,
      href: `/backoffice/stores/${store.id}`,
    } satisfies ArchiveFolder;
  });

  // Folders holding work first, then the rest by name — the archive is read to
  // find something outstanding far more often than to browse it.
  folders.sort(
    (a, b) =>
      (b.pending ?? 0) - (a.pending ?? 0) || b.count - a.count || a.name.localeCompare(b.name),
  );

  return {
    folders,
    totalDocs: deliveries.length,
    totalPending: folders.reduce((sum, f) => sum + (f.pending ?? 0), 0),
  };
}

/** Vendor returns per supplier. Pending = not yet processed or completed. */
export async function getReturPemasokArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [vendors, returns] = await Promise.all([
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.vendorReturn.findMany({
      select: { id: true, vendorId: true, status: true },
    }),
  ]);

  const byVendor = new Map<string, { count: number; pending: number }>();
  for (const r of returns) {
    const acc = byVendor.get(r.vendorId) ?? { count: 0, pending: 0 };
    acc.count += 1;
    if (r.status === 'DRAFT' || r.status === 'SUBMITTED') acc.pending += 1;
    byVendor.set(r.vendorId, acc);
  }

  const folders = vendors.map((vendor) => {
    const acc = byVendor.get(vendor.id) ?? { count: 0, pending: 0 };
    return {
      id: vendor.id,
      name: vendor.name,
      count: acc.count,
      pending: acc.pending,
      meta: acc.count > 0 ? `${acc.count} retur` : null,
      href: `/backoffice/vendor-returns?vendorId=${vendor.id}`,
    } satisfies ArchiveFolder;
  });

  folders.sort(
    (a, b) =>
      (b.pending ?? 0) - (a.pending ?? 0) || b.count - a.count || a.name.localeCompare(b.name),
  );

  return {
    folders,
    totalDocs: returns.length,
    totalPending: folders.reduce((sum, f) => sum + (f.pending ?? 0), 0),
  };
}

/** Work orders per CMT vendor. Pending = still open on the floor. */
export async function getWorkOrderArchive(): Promise<{
  folders: ArchiveFolder[];
  totalDocs: number;
  totalPending: number;
}> {
  const [vendors, workOrders] = await Promise.all([
    prisma.supplier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.workOrder.findMany({
      select: { id: true, vendorId: true, status: true },
    }),
  ]);

  const byVendor = new Map<string, { count: number; pending: number }>();
  for (const wo of workOrders) {
    const acc = byVendor.get(wo.vendorId) ?? { count: 0, pending: 0 };
    acc.count += 1;
    if (wo.status === 'DRAFT' || wo.status === 'ISSUED' || wo.status === 'IN_PRODUCTION' || wo.status === 'PARTIAL') {
      acc.pending += 1;
    }
    byVendor.set(wo.vendorId, acc);
  }

  const folders = vendors.map((vendor) => {
    const acc = byVendor.get(vendor.id) ?? { count: 0, pending: 0 };
    return {
      id: vendor.id,
      name: vendor.name,
      count: acc.count,
      pending: acc.pending,
      meta: acc.count > 0 ? `${acc.count} WO` : null,
      href: `/backoffice/work-orders?vendorId=${vendor.id}`,
    } satisfies ArchiveFolder;
  });

  folders.sort(
    (a, b) =>
      (b.pending ?? 0) - (a.pending ?? 0) || b.count - a.count || a.name.localeCompare(b.name),
  );

  return {
    folders,
    totalDocs: workOrders.length,
    totalPending: folders.reduce((sum, f) => sum + (f.pending ?? 0), 0),
  };
}
