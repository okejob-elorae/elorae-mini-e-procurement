import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listPOs } from '@/lib/purchase-orders/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { PurchaseOrdersPageClient, type PurchaseOrder } from './PurchaseOrdersPageClient';

export const dynamic = 'force-dynamic';

export default async function PurchaseOrdersPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const result = await listPOs(undefined, { page: 1, pageSize: DEFAULT_PAGE_SIZE });
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
      initialPOs={initialPOs as PurchaseOrder[]}
      initialTotalCount={initialTotalCount}
      initialPage={1}
    />
  );
}
