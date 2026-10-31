import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getItemTypeMasters } from '@/app/actions/item-type-master';
import { listItems, getItemCounts } from '@/lib/items/queries';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants/pagination';
import { ItemType } from '@elorae/db';
import { getPrimaryImagesBatch } from '@/lib/items/images/queries';
import { listItemVariantGroups } from '@/lib/items/variant-rows';
import { listItemCategories } from '@/lib/item-categories/queries';
import { ItemsPageClient, type ItemsListView } from './ItemsPageClient';
import { bacaSaringBarang, isActiveDariStatus } from './saring-barang';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<{
    search?: string;
    type?: string;
    page?: string;
    view?: string;
    kategori?: string;
    status?: string;
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
  const saring = bacaSaringBarang(sp);
  const filters = {
    search: search || undefined,
    type: typeFilter,
    categoryId: saring.kategori || undefined,
    isActive: isActiveDariStatus(saring.status),
  };

  if (view === 'variant') {
    const [variantResult, counts, itemTypeMasters, kategori] = await Promise.all([
      listItemVariantGroups(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
      getItemCounts(),
      getItemTypeMasters(),
      listItemCategories(true),
    ]);
    const variantImageMap = await getPrimaryImagesBatch(
      variantResult.groups.flatMap((group) => [
        { itemId: group.itemId, variantSku: null },
        ...group.rows.map((row) => ({
          itemId: row.itemId,
          variantSku: row.variantSku === '' ? null : row.variantSku,
        })),
      ]),
    );

    return (
      <ItemsPageClient
        items={[]}
        totalCount={variantResult.totalCount}
        counts={counts}
        itemTypeMasters={itemTypeMasters}
        search={search}
        typeFilter={typeFilter ?? ''}
        kategoriFilter={saring.kategori}
        statusFilter={saring.status}
        kategori={kategori.map((k) => ({ id: k.id, name: k.name, code: k.code ?? null }))}
        page={page}
        pageSize={DEFAULT_PAGE_SIZE}
        primaryImages={Object.fromEntries(variantImageMap)}
        view={view}
        variantGroups={variantResult.groups}
      />
    );
  }

  const [listResult, counts, itemTypeMasters, kategori] = await Promise.all([
    listItems(filters, { page, pageSize: DEFAULT_PAGE_SIZE }),
    getItemCounts(),
    getItemTypeMasters(),
    listItemCategories(true),
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
      kategoriFilter={saring.kategori}
      statusFilter={saring.status}
      kategori={kategori.map((k) => ({ id: k.id, name: k.name, code: k.code ?? null }))}
      page={page}
      pageSize={DEFAULT_PAGE_SIZE}
      primaryImages={primaryImages}
      view={view}
      variantGroups={[]}
    />
  );
}
