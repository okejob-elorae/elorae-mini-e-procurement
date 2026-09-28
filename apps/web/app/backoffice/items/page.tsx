import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getItemTypeMasters } from '@/app/actions/item-type-master';
import { listItems, getItemCounts } from '@/lib/items/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { ItemType } from '@elorae/db';
import { getPrimaryImagesBatch } from '@/lib/items/images/queries';
import { listItemVariantRows } from '@/lib/items/variant-rows';
import { ItemsPageClient, type ItemsListView } from './ItemsPageClient';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{
    search?: string;
    type?: string;
    page?: string;
    view?: string;
  }>;
};

function parseTypeFilter(
  raw: string | undefined
): ItemType | 'raw' | undefined {
  if (!raw) return undefined;
  if (raw === 'raw') return 'raw';
  if (raw === 'FABRIC' || raw === 'ACCESSORIES' || raw === 'FINISHED_GOOD') {
    return raw;
  }
  return undefined;
}

export default async function ItemsPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session) redirect('/login');

  const sp = await searchParams;
  const search = sp.search?.trim() ?? '';
  const typeFilter = parseTypeFilter(sp.type);
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1);
  const view: ItemsListView = sp.view === 'product' ? 'product' : 'variant';
  const filters = { search: search || undefined, type: typeFilter };

  if (view === 'variant') {
    const [variantResult, counts, itemTypeMasters] = await Promise.all([
      listItemVariantRows(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
      getItemCounts(),
      getItemTypeMasters(),
    ]);
    const variantImageMap = await getPrimaryImagesBatch(
      variantResult.rows.map((row) => ({
        itemId: row.itemId,
        variantSku: row.variantSku === '' ? null : row.variantSku,
      })),
    );

    return (
      <ItemsPageClient
        items={[]}
        totalCount={variantResult.totalCount}
        counts={counts}
        itemTypeMasters={itemTypeMasters}
        search={search}
        typeFilter={typeFilter ?? ''}
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        primaryImages={Object.fromEntries(variantImageMap)}
        view={view}
        variantRows={variantResult.rows}
      />
    );
  }

  const [listResult, counts, itemTypeMasters] = await Promise.all([
    listItems(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
    getItemCounts(),
    getItemTypeMasters(),
  ]);

  const items = 'items' in listResult ? listResult.items : [];
  const totalCount = 'totalCount' in listResult ? listResult.totalCount : items.length;

  const primaryImageMap = await getPrimaryImagesBatch(
    items.map((it) => ({ itemId: (it as unknown as { id: string }).id, variantSku: null })),
  );
  const primaryImages: Record<string, string> = Object.fromEntries(primaryImageMap);

  return (
    <ItemsPageClient
      items={items as unknown as Parameters<typeof ItemsPageClient>[0]['items']}
      totalCount={totalCount}
      counts={counts}
      itemTypeMasters={itemTypeMasters}
      search={search}
      typeFilter={typeFilter ?? ''}
      page={page}
      pageSize={DEFAULT_PAGE_SIZE}
      primaryImages={primaryImages}
      view={view}
      variantRows={[]}
    />
  );
}
