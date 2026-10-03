import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listPOs } from '@/lib/purchase-orders/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { parsePOStatusFilter } from '@/lib/purchase-orders/overdue';
import { PurchaseOrdersPageClient, type PurchaseOrder } from './PurchaseOrdersPageClient';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session) redirect('/login');

  // `?status=` dari tautan beranda dan lencana menu — dibaca di server juga,
  // supaya daftar pertama yang tampil sudah tersaring, tidak berkedip dari
  // "semua PO" ke yang dimaksud.
  const status = parsePOStatusFilter((await searchParams).status);
  const result = await listPOs(
    status === 'overdue' ? { overdue: true } : status ? { status } : undefined,
    { page: 1, pageSize: DEFAULT_PAGE_SIZE }
  );
  const initialPOs =
    result != null && typeof result === 'object' && 'items' in result
      ? (result as { items: unknown[] }).items
      : [];
  const initialTotalCount =
    result != null && typeof result === 'object' && 'totalCount' in result
      ? Number((result as { totalCount: number }).totalCount) || 0
      : 0;

  return (
    <PurchaseOrdersPageClient
      // Dipasang ulang saat `?status=` berubah lewat navigasi (lencana menu,
      // tautan beranda) — state awal hanya dibaca sekali saat dipasang.
      key={status || 'all'}
      initialPOs={initialPOs as PurchaseOrder[]}
      initialTotalCount={initialTotalCount}
      initialPage={1}
      initialStatus={status}
    />
  );
}
