'use client';

import { useState, useEffect, Fragment } from 'react';
import { useLocale } from 'next-intl';
import { useSearchParams } from 'next/navigation';
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
import { getItems, deleteItem, getItemCounts } from '@/app/actions/items';
import { ItemType } from '@/lib/constants/enums';

interface Item {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: ItemType;
  isActive: boolean;
  reorderPoint: string | null;
  uom: {
    code: string;
    nameId: string;
  };
  inventoryValue: {
    qtyOnHand: string;
    avgCost: string;
    totalValue: string;
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
}

const itemTypeLabels: Record<ItemType, string> = {
  FABRIC: 'Kain',
  ACCESSORIES: 'Aksesoris',
  FINISHED_GOOD: 'Barang Jadi'
};

const itemTypeColors: Record<ItemType, string> = {
  FABRIC: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ACCESSORIES: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
  FINISHED_GOOD: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
};

export default function ItemsPage() {
  const locale = useLocale();
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ItemType | 'raw' | ''>('');
  const [page, setPage] = useState(1);

  // Sync type filter from URL (e.g. /items?type=raw or ?type=FINISHED_GOOD)
  useEffect(() => {
    const t = searchParams.get('type');
    if (t === 'raw' || t === 'FABRIC' || t === 'ACCESSORIES' || t === 'FINISHED_GOOD') {
      setTypeFilter(t as ItemType | 'raw');
    }
  }, [searchParams]);
  const [pageSize, _setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ total: number; byType: Record<ItemType, number>; active: number } | null>(null);

  useEffect(() => {
    getItemCounts().then(setCounts).catch(() => setCounts(null));
  }, []);

  const fetchItems = async () => {
    setIsLoading(true);
    try {
      const data = await getItems(
        {
          search: searchQuery || undefined,
          type: typeFilter || undefined
        },
        { page, pageSize }
      );

      if (data && 'items' in data) {
        setItems(data.items as Item[]);
        setTotalCount(data.totalCount || 0);
      } else {
        setItems((data as Item[]) || []);
        setTotalCount((data as Item[])?.length || 0);
      }
    } catch (_error) {
      toast.error('Failed to load items');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [searchQuery, typeFilter]);

  useEffect(() => {
    fetchItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchItems is stable; deps are query/page
  }, [searchQuery, typeFilter, page, pageSize]);

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    
    try {
      await deleteItem(id);
      toast.success('Item deleted successfully');
      fetchItems();
    } catch (error: any) {
      toast.error(error.message || 'Failed to delete item');
    }
  };

  const isLowStock = (item: Item) => {
    if (!item.reorderPoint || !item.inventoryValue) return false;
    return Number(item.inventoryValue.qtyOnHand) <= Number(item.reorderPoint);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Items</h1>
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

      {/* Mini dashboard counts */}
      {counts && (
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
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by SKU or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Items Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Item List
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : items.length === 0 ? (
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
                    <TableHead>SKU</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Avg Cost</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <Fragment key={item.id}>
                      <TableRow key={item.id}>
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
                          <TableCell colSpan={9}>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold">Variants</p>
                                {item.variants && item.variants.length > 0 ? (
                                  <div className="space-y-1 text-sm">
                                    {item.variants.map((variant, idx) => (
                                      <div key={idx} className="flex flex-wrap gap-2">
                                        <span className="text-muted-foreground">Variant {idx + 1}:</span>
                                        {Object.entries(variant).map(([k, v]) => (
                                          <span key={k} className="px-2 py-1 rounded bg-muted text-muted-foreground text-xs">
                                            {k}: {v}
                                          </span>
                                        ))}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">This item has no variants.</p>
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
                                  <p className="text-sm text-muted-foreground">This item has no BOM.</p>
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

              {/* Pagination */}
              <div className="flex items-center justify-between mt-4">
                <div className="text-sm text-muted-foreground">
                  Page {page} of {Math.max(1, Math.ceil(totalCount / pageSize) || 1)}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setPage((p) =>
                        Math.min(Math.max(1, Math.ceil(totalCount / pageSize) || 1), p + 1)
                      )
                    }
                    disabled={page >= Math.max(1, Math.ceil(totalCount / pageSize) || 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
