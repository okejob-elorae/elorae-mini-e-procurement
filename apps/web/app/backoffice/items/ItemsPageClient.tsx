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
import { ItemType } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';

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

const itemTypeColors: Record<ItemType, string> = {
  FABRIC: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ACCESSORIES: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  FINISHED_GOOD: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
};

type ItemsPageClientProps = {
  items: ItemsListRow[];
  totalCount: number;
  counts: ItemCounts;
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
  search: initialSearch,
  typeFilter,
  page,
  pageSize,
  primaryImages = {},
}: ItemsPageClientProps) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('toasts');
  const tItems = useTranslations('items');
  const tPlaceholders = useTranslations('placeholders');
  const itemTypeLabels: Record<ItemType, string> = {
    FABRIC: tItems('fabric'),
    ACCESSORIES: tItems('accessories'),
    FINISHED_GOOD: tItems('finishedGood'),
  };

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  const pushParams = useCallback(
    (updates: { search?: string; page?: number }) => {
      const params = new URLSearchParams();
      const search = updates.search ?? initialSearch;
      const nextPage = updates.page ?? page;
      if (typeFilter) params.set('type', typeFilter);
      if (search.trim()) params.set('search', search.trim());
      if (nextPage > 1) params.set('page', String(nextPage));
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [initialSearch, page, pathname, router, typeFilter]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput === initialSearch) return;
      pushParams({ search: searchInput, page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, initialSearch, pushParams]);

  const handleDelete = async (id: string) => {
    if (!confirm(tItems('confirmDeleteItem'))) return;
    try {
      await deleteItem(id);
      toast.success(t('itemDeletedSuccessfully'));
      router.refresh();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('failedToDeleteItem');
      toast.error(message);
    }
  };

  const isLowStock = (item: ItemsListRow) => {
    if (item.reorderPoint == null || !item.inventoryValue) return false;
    return item.inventoryValue.qtyOnHand <= item.reorderPoint;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{tItems('title')}</h1>
          <p className="text-muted-foreground">
            Manage fabric, accessories, and finished goods
          </p>
        </div>
        <Link href="/backoffice/items/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            New Item
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Items</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fabric</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.FABRIC}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Accessories</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.ACCESSORIES}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Finished Good</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.byType.FINISHED_GOOD}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{counts.active}</p>
          </CardContent>
        </Card>
      </div>

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
            Item List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-12">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No items found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Harga Jual</TableHead>
                    <TableHead className="w-12"></TableHead>
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
                            aria-label="Toggle details"
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
                        <TableCell>
                          <p className="font-medium">
                            {locale === 'en' ? item.nameEn : item.nameId}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Badge className={itemTypeColors[item.type]}>
                            {itemTypeLabels[item.type]}
                          </Badge>
                        </TableCell>
                        <TableCell>{item.uom.code}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {isLowStock(item) && (
                              <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                            )}
                            <span>
                              {Number(item.inventoryValue?.qtyOnHand || 0).toLocaleString()}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          Rp {Number(item.inventoryValue?.avgCost || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          Rp {Number(item.inventoryValue?.totalValue || 0).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.type === 'FINISHED_GOOD' && item.sellingPrice != null
                            ? `Rp ${Number(item.sellingPrice).toLocaleString()}`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem asChild>
                                <Link href={`/backoffice/items/${item.id}`}>
                                  <Edit className="mr-2 h-4 w-4" />
                                  Edit
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleDelete(item.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {expandedId === item.id && (
                        <TableRow>
                          <TableCell colSpan={11}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">Variants</p>
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
                                          .filter(([k]) => k !== 'sku')
                                          .map(([k, v]) => (
                                            <span
                                              key={k}
                                              className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs"
                                            >
                                              {k}: {v}
                                            </span>
                                          ))}
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
                                <p className="text-sm font-semibold">BOM</p>
                                {item.fgConsumptions && item.fgConsumptions.length > 0 ? (
                                  <div className="space-y-1 text-sm">
                                    {item.fgConsumptions.map((rule, idx) => (
                                      <div key={idx} className="flex flex-wrap gap-2">
                                        <span className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs">
                                          {rule.material?.sku || '-'} {rule.material?.nameId || ''}
                                        </span>
                                        <span className="text-muted-foreground">
                                          Qty: {rule.qtyRequired}
                                        </span>
                                        <span className="text-muted-foreground">
                                          Waste: {rule.wastePercent}%
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
