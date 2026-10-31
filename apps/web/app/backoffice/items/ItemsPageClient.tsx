'use client';

import { useState, useEffect, useCallback, useRef, Fragment } from 'react';
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
  FileSpreadsheet,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { alamatDaftarBarang, type StatusBarang } from './saring-barang';
import { angkaStok, kunciGalatHapusBarang, labelJenisBarang } from './tampilan-barang';
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
import { deleteItem, getItemDeleteImpactAction } from '@/app/actions/items';
import type { ItemDeleteImpact } from '@/lib/items/mutations';
import type { ItemTypeMasterRow } from '@/app/actions/item-type-master';
import { ItemType } from '@/lib/constants/enums';
import { Pagination } from '@/components/ui/pagination';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { nadaKategori } from '@/lib/ui/category-color';
import type { ItemVariantGroup } from '@/lib/items/variant-rows';
import { ItemVariantsTable } from './ItemVariantsTable';

export type ItemsListView = 'variant' | 'product';


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
    /** Colour/size the rule is limited to (#437); null = every variant. */
    scope?: string | null;
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
/** Nilai Select untuk "semua" — Select tidak menerima string kosong. */
const SEMUA = '__semua__';

const ITEM_TYPE_CATEGORY: Record<ItemType, string> = {
  FABRIC: 'fabric',
  ACCESSORIES: 'accessories',
  FINISHED_GOOD: 'finished good',
};

/** Kelas warna per jenis untuk tabel varian — palet kategori yang sama dengan CategoryBadge. */
const itemTypeColors: Record<ItemType, string> = {
  FABRIC: nadaKategori(ITEM_TYPE_CATEGORY.FABRIC).className,
  ACCESSORIES: nadaKategori(ITEM_TYPE_CATEGORY.ACCESSORIES).className,
  FINISHED_GOOD: nadaKategori(ITEM_TYPE_CATEGORY.FINISHED_GOOD).className,
};

/** Satuan di belakang angka stok — daftar mencampur kain (YD/MTR/KG) dan barang jadi (PCS). */
function Satuan({ code }: { code: string }) {
  // Kode satuan panjang (data uji) tidak boleh melebarkan tabel sampai menggulir di 1280 px.
  return (
    <span title={code} className="ml-1 inline-block min-w-8 max-w-14 truncate text-left align-bottom text-xs text-muted-foreground">
      {code}
    </span>
  );
}

type ItemsPageClientProps = {
  items: ItemsListRow[];
  totalCount: number;
  counts: ItemCounts;
  itemTypeMasters: ItemTypeMasterRow[];
  search: string;
  typeFilter: ItemType | 'raw' | '';
  kategoriFilter: string;
  statusFilter: StatusBarang;
  kategori: Array<{ id: string; name: string; code: string | null }>;
  page: number;
  pageSize: number;
  primaryImages?: Record<string, string>;
  view: ItemsListView;
  variantGroups: ItemVariantGroup[];
};

export function ItemsPageClient({
  items,
  totalCount,
  counts,
  itemTypeMasters,
  search: initialSearch,
  typeFilter,
  kategoriFilter,
  statusFilter,
  kategori,
  page,
  pageSize,
  primaryImages = {},
  view,
  variantGroups,
}: ItemsPageClientProps) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const tTable = useTranslations('tableHeaders');
  const tNav = useTranslations('navigation');
  const tItems = useTranslations('items');
  const tPlaceholders = useTranslations('placeholders');
  const tDaftar = useTranslations('itemList');
  const tUi = useTranslations('ui');
  const tImport = useTranslations('itemImport');
  const [hapusTarget, setHapusTarget] = useState<ItemsListRow | null>(null);
  const [menghapus, setMenghapus] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<ItemDeleteImpact | null>(null);
  const [deleteImpactFailed, setDeleteImpactFailed] = useState(false);
  /* The dialog's current item, re-read after an await so a late impact response for another item is dropped. */
  const deleteTargetRef = useRef<string | null>(null);
  const tForm = useTranslations('itemForm');
  const itemTypeLabels: Record<ItemType, string> = {
    FABRIC: tForm('typeName.FABRIC'),
    ACCESSORIES: tForm('typeName.ACCESSORIES'),
    FINISHED_GOOD: tForm('typeName.FINISHED_GOOD'),
  };

  const [searchInput, setSearchInput] = useState(initialSearch);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const activeTab =
    typeFilter && typeFilter !== 'raw' ? typeFilter : 'all';

  // Label tab dari kode jenis (sentence case, satu istilah); jenis asing memakai nama di master.
  const typeTabLabel = (master: ItemTypeMasterRow) =>
    labelJenisBarang(master, locale, (code) => tForm(`typeName.${code}`));

  useEffect(() => {
    setSearchInput(initialSearch);
  }, [initialSearch]);

  const pushParams = useCallback(
    (updates: {
      search?: string;
      page?: number;
      type?: ItemType | 'raw' | '';
      kategori?: string;
      status?: StatusBarang;
      view?: ItemsListView;
    }) => {
      const alamat = alamatDaftarBarang(pathname, {
        type: updates.type !== undefined ? updates.type : typeFilter,
        search: updates.search ?? initialSearch,
        kategori: updates.kategori !== undefined ? updates.kategori : kategoriFilter,
        status: updates.status !== undefined ? updates.status : statusFilter,
        page: updates.page ?? page,
      });
      const nextView = updates.view ?? view;
      router.push(nextView === 'product' ? `${alamat}${alamat.includes('?') ? '&' : '?'}view=product` : alamat);
    },
    [initialSearch, kategoriFilter, page, pathname, router, statusFilter, typeFilter, view]
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

  const closeDeleteDialog = () => {
    deleteTargetRef.current = null;
    setHapusTarget(null);
    setDeleteImpact(null);
    setDeleteImpactFailed(false);
  };

  const openDeleteDialog = async (item: ItemsListRow) => {
    deleteTargetRef.current = item.id;
    setHapusTarget(item);
    setDeleteImpact(null);
    setDeleteImpactFailed(false);
    try {
      const impact = await getItemDeleteImpactAction(item.id);
      if (deleteTargetRef.current === item.id) setDeleteImpact(impact);
    } catch {
      if (deleteTargetRef.current === item.id) setDeleteImpactFailed(true);
    }
  };

  const handleDelete = async () => {
    if (!hapusTarget) return;
    setMenghapus(true);
    try {
      const result = await deleteItem(hapusTarget.id);
      if (!result.success) {
        toast.error(tDaftar(kunciGalatHapusBarang(result.messageKey)));
        return;
      }
      closeDeleteDialog();
      toast.success(tDaftar('deletedToast'));
      router.refresh();
    } catch {
      toast.error(tDaftar('errDelete'));
    } finally {
      setMenghapus(false);
    }
  };

  const isLowStock = (item: ItemsListRow) => {
    if (item.reorderPoint == null || !item.inventoryValue) return false;
    return item.inventoryValue.available <= item.reorderPoint;
  };

  const hasDeleteImpact =
    deleteImpact !== null &&
    (deleteImpact.images > 0 || deleteImpact.priceChanges > 0 || deleteImpact.salesHistory > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={tNav('navItemsAll')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/backoffice/items/import">
              <Button variant="outline">
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                {tImport('openImport')}
              </Button>
            </Link>
            <Link href="/backoffice/items/new">
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                {tItems('newItem')}
              </Button>
            </Link>
          </div>
        }
      />

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

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-4">
        <div className="relative flex-1 min-w-[16rem] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={
              view === 'variant' ? tItems('searchVariantPlaceholder') : tPlaceholders('searchBySkuOrName')
            }
            aria-label={
              view === 'variant' ? tItems('searchVariantPlaceholder') : tPlaceholders('searchBySkuOrName')
            }
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={kategoriFilter || SEMUA}
          onValueChange={(v) => pushParams({ kategori: v === SEMUA ? '' : v, page: 1 })}
        >
          <SelectTrigger className="w-full sm:w-52" aria-label={tDaftar('filterCategory')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tDaftar('allCategories')}</SelectItem>
            {kategori.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.code ? `${k.code} — ${k.name}` : k.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter || SEMUA}
          onValueChange={(v) => pushParams({ status: v === SEMUA ? '' : (v as StatusBarang), page: 1 })}
        >
          <SelectTrigger className="w-full sm:w-44" aria-label={tDaftar('filterStatus')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEMUA}>{tDaftar('allStatuses', { count: counts.total })}</SelectItem>
            <SelectItem value="aktif">{tDaftar('statusActive', { count: counts.active })}</SelectItem>
            <SelectItem value="nonaktif">{tDaftar('statusInactive', { count: counts.total - counts.active })}</SelectItem>
          </SelectContent>
        </Select>
        <div
          role="group"
          aria-label={tItems('viewToggleLabel')}
          className="inline-flex self-start rounded-md border p-1 gap-1 sm:self-auto"
        >
          <Button
            type="button"
            size="sm"
            variant={view === 'variant' ? 'default' : 'ghost'}
            aria-pressed={view === 'variant'}
            className="h-9"
            onClick={() => pushParams({ view: 'variant', page: 1 })}
          >
            {tItems('viewByVariant')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'product' ? 'default' : 'ghost'}
            aria-pressed={view === 'product'}
            className="h-9"
            onClick={() => pushParams({ view: 'product', page: 1 })}
          >
            {tItems('viewByProduct')}
          </Button>
        </div>
      </div>

      {view === 'variant' ? (
        <ItemVariantsTable
          key={`${page}|${initialSearch}|${typeFilter}|${kategoriFilter}|${statusFilter}`}
          groups={variantGroups}
          totalCount={totalCount}
          page={page}
          pageSize={pageSize}
          images={primaryImages}
          hasFilter={initialSearch.trim() !== '' || typeFilter !== '' || kategoriFilter !== '' || statusFilter !== ''}
          typeLabels={itemTypeLabels}
          typeColors={itemTypeColors}
          onPageChange={(p) => pushParams({ page: p })}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {tDaftar('cardTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {items.length === 0 ? (
              <div className="text-center py-12">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">{tDaftar('empty')}</p>
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
                      {/* Satuan ditulis di belakang angka Stok dan Tersedia (bukan
                          kolom sendiri). Harga rata-rata dan nilai disembunyikan di
                          bawah 2xl: di layar 1280 px keduanya mendorong Harga jual
                          keluar layar; keduanya tetap ada di rincian barang dan Inventori. */}
                      <TableHead className="text-right">{tTable('stock')}</TableHead>
                      <TableHead className="text-right">{tTable('available')}</TableHead>
                      <TableHead className="hidden 2xl:table-cell text-right">{tDaftar('colAvgCost')}</TableHead>
                      <TableHead className="hidden 2xl:table-cell text-right">{tTable('value')}</TableHead>
                      <TableHead className="text-right">{tDaftar('colSellingPrice')}</TableHead>
                      <TableHead className="sticky right-0 bg-card text-right">{tUi('actions')}</TableHead>
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
                          <TableCell className="font-medium">
                            <Link href={`/backoffice/items/${item.id}`} className="hover:underline underline-offset-4">
                              {item.sku}
                            </Link>
                          </TableCell>
                          <TableCell className="whitespace-normal min-w-[160px]">
                            <Link
                              href={`/backoffice/items/${item.id}`}
                              className="font-medium hover:underline underline-offset-4"
                            >
                              {locale === 'en' ? item.nameEn : item.nameId}
                            </Link>
                            {!item.isActive ? (
                              <Badge variant="outline" className="ml-2 align-middle">
                                {tDaftar('inactive')}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <CategoryBadge label={ITEM_TYPE_CATEGORY[item.type]}>
                              {itemTypeLabels[item.type]}
                            </CategoryBadge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {isLowStock(item) && (
                                <AlertTriangle className="h-4 w-4 text-amber-500 dark:text-amber-400" />
                              )}
                              <span className="tabular-nums">
                                {angkaStok(item.inventoryValue?.qtyOnHand)}
                                <Satuan code={item.uom.code} />
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={
                                (item.inventoryValue?.available ?? 0) < 0
                                  ? 'font-medium text-red-600 dark:text-red-400'
                                  : undefined
                              }
                            >
                              {angkaStok(item.inventoryValue?.available)}
                            </span>
                            <Satuan code={item.uom.code} />
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
                          <TableCell className="sticky right-0 bg-card text-right">
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
                                  onClick={() => void openDeleteDialog(item)}
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
                            <TableCell colSpan={11}>
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
                                      {tDaftar('noVariants')}
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
                                          {rule.scope && (
                                            <span className="text-muted-foreground">({rule.scope})</span>
                                          )}
                                          <span className="text-muted-foreground">
                                            {tItems('bomQty', {
                                              qty: Number(rule.qtyRequired).toLocaleString('id-ID', { maximumFractionDigits: 4 }),
                                            })}
                                          </span>
                                          <span className="text-muted-foreground">
                                            {tItems('bomWaste', {
                                              percent: Number(rule.wastePercent).toLocaleString('id-ID', { maximumFractionDigits: 2 }),
                                            })}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="text-sm text-muted-foreground">{tDaftar('noBom')}</p>
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

                {totalCount > pageSize || page > 1 ? (
                  <Pagination
                    page={page}
                    totalPages={Math.max(1, Math.ceil(totalCount / pageSize) || 1)}
                    onPageChange={(p) => pushParams({ page: p })}
                    totalCount={totalCount}
                    pageSize={pageSize}
                  />
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={hapusTarget !== null}
        onOpenChange={(open) => {
          if (!open && !menghapus) closeDeleteDialog();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tDaftar('deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {deleteImpactFailed ? (
                  <p>{tItems('deleteImpactLoadFailed')}</p>
                ) : deleteImpact === null ? (
                  <p className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </p>
                ) : deleteImpact.blocked ? (
                  <p>{tDaftar('errInUse')}</p>
                ) : (
                  <>
                    <p>
                      {hapusTarget
                        ? tDaftar('deleteBody', {
                            nama: locale === 'en' ? hapusTarget.nameEn : hapusTarget.nameId,
                            sku: hapusTarget.sku,
                          })
                        : null}
                    </p>
                    {hasDeleteImpact && (
                      <ul className="list-disc space-y-1 pl-5">
                        {deleteImpact.images > 0 && (
                          <li>{tItems('deleteImpactImages', { count: deleteImpact.images })}</li>
                        )}
                        {deleteImpact.priceChanges > 0 && (
                          <li>
                            {tItems('deleteImpactPriceChanges', { count: deleteImpact.priceChanges })}
                          </li>
                        )}
                        {deleteImpact.salesHistory > 0 && (
                          <li>
                            {tItems('deleteImpactSalesHistory', { count: deleteImpact.salesHistory })}
                          </li>
                        )}
                      </ul>
                    )}
                    {hasDeleteImpact && (
                      <p className="text-xs text-muted-foreground">{tItems('deleteImpactHint')}</p>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={menghapus}>{tDaftar('cancel')}</AlertDialogCancel>
            {!deleteImpactFailed && !deleteImpact?.blocked && (
              <AlertDialogAction
                variant="destructive"
                disabled={menghapus || deleteImpact === null}
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete();
                }}
              >
                {menghapus && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tDaftar('deleteConfirm')}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
