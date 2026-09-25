'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  Search,
  Package,
  Edit,
  Trash2,
  MoreHorizontal,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { deleteItem } from '@/app/actions/items';
import type { ItemTypeMasterRow } from '@/app/actions/item-type-master';
import { ItemType } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

export type ItemsListRow = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  isActive: boolean;
  reorderPoint: number | null;
  sellingPrice?: number | null;
  uom: {
    code: string;
    nameId: string;
  };
  inventoryValue: {
    qtyOnHand: number;
    reservedQty: number;
    available: number;
    avgCost: number;
    totalValue: number;
  } | null;
  variants?: Array<Record<string, string>>;
  fgConsumptions?: Array<{
    qtyRequired: number;
    wastePercent: number;
    material?: {
      sku?: string;
      nameId?: string;
      nameEn?: string;
    } | null;
  }>;
};

type ItemCounts = {
  total: number;
  byType: Record<ItemType, number>;
  active: number;
};

/*
 * Routed through the shared category palette instead of a local map. Two
 * reasons: FINISHED_GOOD used green, which means "settled" on every status
 * pill in the app, and a per-page map drifts from every other page's idea of
 * what a fabric badge looks like.
 */
const ITEM_TYPE_CATEGORY: Record<ItemType, string> = {
  FABRIC: 'fabric',
  ACCESSORIES: 'accessories',
  FINISHED_GOOD: 'finished good',
};

type ItemsPageClientProps = {
  items: ItemsListRow[];
  totalCount: number;
  counts: ItemCounts;
  itemTypeMasters: ItemTypeMasterRow[];
  search: string;
  typeFilter: ItemType | 'raw' | '';
  page: number;
  pageSize: number;
  primaryImages?: Record<string, string>;
};

export function ItemsPageClient({
  items,
  totalCount,
  counts,
  itemTypeMasters,
  search: initialSearch,
  typeFilter,
  page,
  pageSize,
  primaryImages = {},
}: ItemsPageClientProps) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const tTable = useTranslations('tableHeaders');
  const t = useTranslations('toasts');
  const tNav = useTranslations('navigation');
  const tItems = useTranslations('items');
  const tPlaceholders = useTranslations('placeholders');
  const itemTypeLabels: Record<ItemType, string> = {
    FABRIC: tItems('fabric'),
    ACCESSORIES: tItems('accessories'),
    FINISHED_GOOD: tItems('finishedGood'),
  };

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeTab =
    typeFilter && typeFilter !== 'raw' ? typeFilter : 'all';

  const typeTabLabel = (master: ItemTypeMasterRow) =>
    locale === 'en' ? master.nameEn : master.nameId;

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  const pushParams = useCallback(
    (updates: { search?: string; page?: number; type?: ItemType | 'raw' | '' }) => {
      const params = new URLSearchParams();
      const search = updates.search ?? initialSearch;
      const nextPage = updates.page ?? page;
      const nextType = updates.type !== undefined ? updates.type : typeFilter;
      if (nextType) params.set('type', nextType);
      if (search.trim()) params.set('search', search.trim());
      if (nextPage > 1) params.set('page', String(nextPage));
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [initialSearch, page, pathname, router, typeFilter]
  );

  const handleTabChange = (value: string) => {
    pushParams({ type: value === 'all' ? '' : (value as ItemType | 'raw'), page: 1 });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === initialSearch) return;
      pushParams({ search: searchInput, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, initialSearch, pushParams]);

  const handleDelete = async (id: string) => {
    if (!confirm(tItems('confirmDeleteItem'))) return;
    const result = await deleteItem(id);
    if (!result.success) {
      toast.error(t(result.messageKey));
      return;
    }
    toast.success(t('itemDeletedSuccessfully'));
    router.refresh();
  };

  const isLowStock = (item: ItemsListRow) => {
    if (item.reorderPoint == null || !item.inventoryValue) return false;
    return item.inventoryValue.available <= item.reorderPoint;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tNav('navItemsAll')}</h1>
          <p className="text-muted-foreground">{tItems('subtitle')}</p>
        </div>
        <Link href="/backoffice/items/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            {tItems('newItem')}
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tItems('totalItems')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tItems('fabric')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.FABRIC}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tItems('accessories')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.ACCESSORIES}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tItems('finishedGood')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.FINISHED_GOOD}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tItems('active')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.active}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="all">
            {tItems('tabAll')}
            <Badge variant="secondary" className="ml-1.5 tabular-nums">
              {counts.total}
            </Badge>
          </TabsTrigger>
          {itemTypeMasters.map((master) => {
            const code = master.code as ItemType;
            const count = counts.byType[code] ?? 0;
            return (
              <TabsTrigger key={master.code} value={master.code}>
                {typeTabLabel(master)}
                <Badge variant="secondary" className="ml-1.5 tabular-nums">
                  {count}
                </Badge>
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={tPlaceholders('searchBySkuOrName')}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {tItems('itemList')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">{tItems('noItemsFound')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>{tTable('name')}</TableHead>
                    <TableHead>{tTable('type')}</TableHead>
                    {/* Satuan, harga rata-rata dan nilai disembunyikan di bawah
                        2xl: di layar 1280 px kolom-kolom ini mendorong Harga
                        Jual keluar layar. Ketiganya tetap ada di halaman
                        detail barang dan di Inventori. */}
                    <TableHead className="hidden 2xl:table-cell">{tTable('uom')}</TableHead>
                    <TableHead className="text-right">{tTable('stock')}</TableHead>
                    <TableHead className="text-right">{tTable('available')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell text-right">{tTable('avgCost')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell text-right">{tTable('value')}</TableHead>
                    <TableHead className="text-right">{tTable('sellingPrice')}</TableHead>
                    <TableHead className="w-12 sticky right-0 bg-card">
                      <span className="sr-only">{tItems('actions')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <Fragment key={item.id}>
                      <TableRow>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setExpandedId(expandedId === item.id ? null : item.id)
                            }
                            aria-label={tItems('toggleDetails')}
                            aria-expanded={expandedId === item.id}
                          >
                            {expandedId === item.id ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>
                          {primaryImages[`${item.id}|`] ? (
                            <img
                              src={primaryImages[`${item.id}|`]}
                              alt=""
                              className="w-10 h-10 rounded object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded bg-muted" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{item.sku}</TableCell>
                        <TableCell className="whitespace-normal min-w-[160px]">
                          <p className="font-medium">
                            {locale === 'en' ? item.nameEn : item.nameId}
                          </p>
                        </TableCell>
                        <TableCell>
                          <CategoryBadge label={ITEM_TYPE_CATEGORY[item.type]}>
                            {itemTypeLabels[item.type]}
                          </CategoryBadge>
                        </TableCell>
                        <TableCell className="hidden 2xl:table-cell">{item.uom.code}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isLowStock(item) && (
                              <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                            )}
                            <span>
                              {Number(item.inventoryValue?.qtyOnHand || 0).toLocaleString('id-ID')}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={
                              (item.inventoryValue?.available ?? 0) < 0
                                ? 'font-medium text-red-600 dark:text-red-400'
                                : undefined
                            }
                          >
                            {Number(item.inventoryValue?.available ?? 0).toLocaleString('id-ID')}
                          </span>
                        </TableCell>
                        <TableCell className="hidden 2xl:table-cell text-right">
                          Rp {Number(item.inventoryValue?.avgCost || 0).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="hidden 2xl:table-cell text-right">
                          Rp {Number(item.inventoryValue?.totalValue || 0).toLocaleString('id-ID')}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.type === 'FINISHED_GOOD' && item.sellingPrice != null
                            ? `Rp ${Number(item.sellingPrice).toLocaleString('id-ID')}`
                            : '—'}
                        </TableCell>
                        <TableCell className="sticky right-0 bg-card">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={tItems('rowMenu', { sku: item.sku })}
                                title={tItems('rowMenu', { sku: item.sku })}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/backoffice/items/${item.id}`}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  {tItems('edit')}
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(item.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                {tItems('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {expandedId === item.id && (
                        <TableRow>
                          <TableCell colSpan={12}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">{tItems('variants')}</p>
                                {item.variants && item.variants.length > 0 ? (
                                  <div className="space-y-1 text-sm">
                                    {item.variants.map((variant, idx) => (
                                      <div
                                        key={idx}
                                        className="flex flex-wrap gap-2 items-center"
                                      >
                                        <span className="text-muted-foreground">
                                          {tItems('variantLabel', { index: idx + 1 })}
                                        </span>
                                        {variant.sku && (
                                          <span className="px-2 py-1 rounded bg-primary/10 text-foreground ring-1 ring-inset ring-primary/20 text-xs font-medium">
                                            {variant.sku}
                                          </span>
                                        )}
                                        {Object.entries(variant)
                                          .filter(
                                            ([k, v]) =>
                                              k !== 'sku' &&
                                              k !== 'barcode' &&
                                              v != null &&
                                              String(v).trim() !== ''
                                          )
                                          .map(([k, v]) => (
                                            <span
                                              key={k}
                                              className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs"
                                            >
                                              {k}: {v}
                                            </span>
                                          ))}
                                        {variant.barcode?.trim() && (
                                          <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs font-mono">
                                            {tItems('variantBarcode')}: {variant.barcode.trim()}
                                          </span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">
                                    {tItems('noVariants')}
                                  </p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">{tItems('bom')}</p>
                                {item.fgConsumptions && item.fgConsumptions.length > 0 ? (
                                  <div className="space-y-1 text-sm">
                                    {item.fgConsumptions.map((rule, idx) => (
                                      <div key={idx} className="flex flex-wrap gap-2">
                                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs">
                                          {rule.material?.sku || '-'} {rule.material?.nameId || ''}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {tItems('bomQty', { qty: rule.qtyRequired })}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {tItems('bomWaste', { percent: rule.wastePercent })}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">{tItems('noBOM')}</p>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>

              <Pagination
                page={page}
                totalPages={Math.max(1, Math.ceil(totalCount / pageSize) || 1)}
                onPageChange={(p) => pushParams({ page: p })}
                totalCount={totalCount}
                pageSize={pageSize}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
