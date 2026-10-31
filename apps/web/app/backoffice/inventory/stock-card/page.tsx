'use client';

import React, { useState, useCallback, useEffect, useRef, Fragment } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { alamatBerubah, bacaParamKartuStok, tulisParamKartuStok } from './param-kartu-stok';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { TombolBantuan } from '@/components/bantuan/TombolBantuan';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
import { DateRangePicker } from '@/components/ui/date-range-picker';
import { formatDateOnly, formatDisplayDateTime, parseDateOnly, parseDateOnlyEnd } from '@/lib/date-only';
import { useLocale, useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Loader2, ChevronDown, ChevronRight, Printer, Info } from 'lucide-react';
import { getStockCard, getStockCardByType, getStockCardByCategory, getCurrentStockSummary, getItemVariantOptions } from '@/app/actions/stock-card';
import { getItemCategories } from '@/app/actions/item-categories';
import { logPrint } from '@/app/actions/audit';
import { buildStockCardPrintHtml } from '@/lib/print/stock-card-html';
import type { StockCardPrintLabels } from '@/lib/print/stock-card-html';
import { printHtmlInIframe } from '@/lib/print/print-html-in-iframe';
/* Subpath import, not the main barrel: this is a client component, and @elorae/db's barrel
   eagerly pulls in Prisma and the mariadb driver, which would follow it into the browser
   bundle. Same idiom StoreStockCard.tsx and MovementsPageClient.tsx already use for this
   exact refType -> label lookup. */
import { ledgerRefMessageKey } from '@/lib/inventory/ledger-ref-display';
import { toast } from 'sonner';
import { toCsv } from "@/lib/reports/csv";

const stockCardPrintLabelsId: Partial<StockCardPrintLabels> = {
  title: 'Kartu Stok',
  period: 'Periode',
  openingBalance: 'Saldo awal',
  openingValue: 'Nilai awal',
  closingBalance: 'Saldo akhir',
  closingValue: 'Nilai akhir',
  variant: 'Varian',
  colDate: 'Tanggal',
  colDoc: 'Dokumen',
  colDesc: 'Keterangan',
  colNotes: 'Catatan',
  colVariant: 'Varian',
  colIn: 'Masuk',
  colOut: 'Keluar',
  colBalance: 'Sisa',
  colUnitCost: 'Harga satuan',
  colBalanceValue: 'Nilai persediaan',
  noMovements: 'Tidak ada mutasi pada periode ini.',
};

const defaultFrom = startOfDay(subDays(new Date(), 30));
const defaultTo = endOfDay(new Date());
const RENTANG_BAWAAN = { dari: format(defaultFrom, 'yyyy-MM-dd'), sampai: format(defaultTo, 'yyyy-MM-dd') };

type ViewMode = 'by-item' | 'by-type' | 'by-category';

/** Kartu stok yang belum dijawab sesudah ini dianggap gagal (tombol dibuka lagi). */
const BATAS_MUAT_MS = 45_000;

export default function StockCardPage() {
  const t = useTranslations('inventory.stockCard');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  // Barang, varian, dan rentang dibaca dari URL sekali (?itemId=&varian=&dari=&sampai=).
  const [awalUrl] = useState(() => bacaParamKartuStok(searchParams, RENTANG_BAWAAN));
  /* RefType labels reuse the same locale keys the ledger movement card and the store
     detail card already resolve refType through - never a second hardcoded mapping of
     the same StockLedgerRefType union. */
  const tMovements = useTranslations('stockMovements');
  const describeRefType = useCallback(
    (refType: string) => {
      const key = ledgerRefMessageKey(refType);
      return key ? tMovements(key) : refType;
    },
    [tMovements]
  );

  const [viewMode, setViewMode] = useState<ViewMode>('by-item');
  const [itemId, setItemId] = useState<string>(awalUrl.itemId);
  const [dateFrom, setDateFrom] = useState(awalUrl.dari);
  const [dateTo, setDateTo] = useState(awalUrl.sampai);
  const [variantSku, setVariantSku] = useState<string>(awalUrl.varian);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getCurrentStockSummary>>>([]);
  const [data, setData] = useState<Awaited<ReturnType<typeof getStockCard>> | null>(null);
  const [dataByType, setDataByType] = useState<Awaited<ReturnType<typeof getStockCardByType>> | null>(null);
  const [dataByCategory, setDataByCategory] = useState<Awaited<ReturnType<typeof getStockCardByCategory>> | null>(null);
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof getItemCategories>>>([]);
  const [categoryId, setCategoryId] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'raw' | 'finished'>('raw');
  const [isLoading, setIsLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [expandedByType, setExpandedByType] = useState<Set<string>>(new Set());
  const [expandedByCategory, setExpandedByCategory] = useState<Set<string>>(new Set());
  const [variantOptions, setVariantOptions] = useState<string[]>([]);

  const loadSummary = useCallback(async () => {
    try {
      const list = await getCurrentStockSummary();
      setSummary(list);
    } catch {
      toast.error(t('loadItemsFailed'));
    }
  }, [t]);

  const loadCategories = useCallback(async () => {
    try {
      const list = await getItemCategories(true);
      setCategories(list);
    } catch {
      toast.error(t('loadCategoriesFailed'));
    }
  }, [t]);

  const loadStockCard = useCallback(async () => {
    if (!itemId) {
      toast.error(t('selectItemFirst'));
      return;
    }
    setIsLoading(true);
    try {
      const from = parseDateOnly(dateFrom) ?? new Date(NaN);
      const to = parseDateOnlyEnd(dateTo) ?? new Date(NaN);
      // Batas waktu: jawaban yang tidak pernah datang tidak boleh mengunci tombol selamanya.
      const result = await Promise.race([
        getStockCard(itemId, { from, to }, variantSku || undefined),
        new Promise<never>((_, tolak) => window.setTimeout(() => tolak(new Error('BATAS_WAKTU')), BATAS_MUAT_MS)),
      ]);
      setData(result);
      setLoadedOnce(true);
    } catch (err) {
      toast.error(err instanceof Error && err.message === 'BATAS_WAKTU' ? t('loadTimeout') : t('loadFailed'));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [itemId, dateFrom, dateTo, variantSku, t]);

  const loadStockCardByType = useCallback(async () => {
    setIsLoading(true);
    try {
      const from = parseDateOnly(dateFrom) ?? new Date(NaN);
      const to = parseDateOnlyEnd(dateTo) ?? new Date(NaN);
      const result = await getStockCardByType(typeFilter, { from, to });
      setDataByType(result);
      setLoadedOnce(true);
    } catch {
      toast.error(t('loadByTypeFailed'));
      setDataByType(null);
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter, dateFrom, dateTo, t]);

  const loadStockCardByCategory = useCallback(async () => {
    if (!categoryId) {
      toast.error(t('selectCategoryFirst'));
      return;
    }
    setIsLoading(true);
    try {
      const from = parseDateOnly(dateFrom) ?? new Date(NaN);
      const to = parseDateOnlyEnd(dateTo) ?? new Date(NaN);
      const result = await getStockCardByCategory(categoryId, { from, to });
      setDataByCategory(result);
      setLoadedOnce(true);
    } catch {
      toast.error(t('loadByCategoryFailed'));
      setDataByCategory(null);
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, dateFrom, dateTo, t]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // Pilihan per barang ditulis ke URL (replace) supaya tautannya bisa dibagikan.
  useEffect(() => {
    if (viewMode !== 'by-item') return;
    const qs = tulisParamKartuStok({ itemId, varian: variantSku, dari: dateFrom, sampai: dateTo }, RENTANG_BAWAAN);
    // Alamat yang sudah sama tidak ditulis ulang: replaceState membuang aksi server
    // yang sedang berjalan (lihat `alamatBerubah`).
    if (!alamatBerubah(window.location.search, qs)) return;
    window.history.replaceState(null, '', qs ? `${pathname}?${qs}` : pathname);
  }, [viewMode, itemId, variantSku, dateFrom, dateTo, pathname]);

  // Dibuka dengan ?itemId= (mis. dari rincian GRN): kartu stoknya langsung ditampilkan.
  const sudahMuatAwal = useRef(false);
  useEffect(() => {
    if (sudahMuatAwal.current || !awalUrl.itemId) return;
    sudahMuatAwal.current = true;
    void loadStockCard();
  }, [awalUrl.itemId, loadStockCard]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // When item is selected, fetch variant options so the variant combobox is populated before Load
  useEffect(() => {
    if (!itemId) {
      setVariantOptions([]);
      return;
    }
    getItemVariantOptions(itemId)
      .then(setVariantOptions)
      .catch(() => setVariantOptions([]));
  }, [itemId]);

  const handleExport = () => {
    if (!data) return;
    const headers = [
      'Tanggal',
      'Dokumen',
      'Keterangan',
      'Masuk',
      'Keluar',
      'Sisa',
      'Harga Satuan',
      'Nilai Persediaan',
    ];
    const rows = data.movements.map((m) => ({
      Tanggal: format(new Date(m.date), "yyyy-MM-dd HH:mm"),
      Dokumen: m.docNumber,
      Keterangan: describeRefType(m.refType),
      Masuk: m.in ?? "",
      Keluar: m.out ?? "",
      Sisa: m.balance,
      "Harga Satuan": m.unitCost ?? "",
      /* null (not recorded) exports as an empty cell, never a bare 0. */
      "Nilai Persediaan": m.balanceValue ?? "",
    }));
    const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-card-${data.item?.sku ?? itemId}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePrintByItem = async () => {
    if (!data?.item) {
      toast.error(t('loadBeforePrint'));
      return;
    }
    try {
      await logPrint('StockCard', itemId);
      const html = buildStockCardPrintHtml({
        kind: 'item',
        itemSku: data.item.sku ?? '-',
        itemName: data.item.nameId ?? '-',
        uomCode: data.item.uom?.code ?? '',
        variantFilterLabel: variantSku.trim() ? variantSku : t('allVariants'),
        dateFromLabel: dateFrom,
        dateToLabel: dateTo,
        openingBalance: data.openingBalance,
        openingValue: data.openingValue,
        closingBalance: data.closingBalance,
        closingValue: data.closingValue,
        movements: data.movements.map((m) => ({
          date: m.date,
          docNumber: m.docNumber,
          description: describeRefType(m.refType),
          /* StockLedgerEntry has no notes column - render the column empty rather than
             drop it, so the print layout stays identical for every stock card kind. */
          notes: null,
          variantSku: m.variantSku ?? null,
          in: m.in,
          out: m.out,
          balance: m.balance,
          unitCost: m.unitCost,
          balanceValue: m.balanceValue,
        })),
        labels: stockCardPrintLabelsId,
      });
      printHtmlInIframe(html, t('printFrameTitle'), { errorMessage: t('printLoadFailed') });
    } catch {
      toast.error(t('printFailed'));
    }
  };

  const handlePrintByType = async () => {
    if (!dataByType) {
      toast.error(t('loadByTypeBeforePrint'));
      return;
    }
    try {
      await logPrint('StockCard', `by-type:${dataByType.type}`);
      const typeTitle =
        dataByType.type === 'raw' ? t('typeRawLong') : t('typeFinished');
      const html = buildStockCardPrintHtml({
        kind: 'byType',
        typeTitle,
        dateFromLabel: dateFrom,
        dateToLabel: dateTo,
        items: dataByType.items.map((row) => ({
          sku: row.item?.sku ?? '-',
          name: row.item?.nameId ?? '-',
          uomCode: row.item?.uom?.code ?? '',
          openingBalance: row.openingBalance,
          closingBalance: row.closingBalance,
          movements: row.movements.map((m) => ({
            date: m.date,
            docNumber: m.docNumber,
            description: describeRefType(m.refType),
            /* StockLedgerEntry has no notes column - see the by-item print handler above. */
            notes: null,
            in: m.in,
            out: m.out,
            balance: m.balance,
          })),
        })),
        labels: stockCardPrintLabelsId,
      });
      printHtmlInIframe(html, t('printByTypeFrameTitle'), { errorMessage: t('printLoadFailed') });
    } catch {
      toast.error(t('printFailed'));
    }
  };

  const handlePrintByCategory = async () => {
    if (!dataByCategory) {
      toast.error(t('loadByCategoryBeforePrint'));
      return;
    }
    try {
      await logPrint('StockCard', `by-category:${categoryId}`);
      const html = buildStockCardPrintHtml({
        kind: 'byCategory',
        categoryTitle: dataByCategory.category.name || t('categoryFallback'),
        categoryCode: dataByCategory.category.code,
        dateFromLabel: dateFrom,
        dateToLabel: dateTo,
        items: dataByCategory.items.map((row) => ({
          sku: row.item?.sku ?? '-',
          name: row.item?.nameId ?? '-',
          uomCode: row.item?.uom?.code ?? '',
          openingBalance: row.openingBalance,
          closingBalance: row.closingBalance,
          movements: row.movements.map((m) => ({
            date: m.date,
            docNumber: m.docNumber,
            description: describeRefType(m.refType),
            /* StockLedgerEntry has no notes column - see the by-item print handler above. */
            notes: null,
            in: m.in,
            out: m.out,
            balance: m.balance,
          })),
        })),
        labels: stockCardPrintLabelsId,
      });
      printHtmlInIframe(html, t('printByCategoryFrameTitle'), { errorMessage: t('printLoadFailed') });
    } catch {
      toast.error(t('printFailed'));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory" aria-label={t('backToInventory')} title={t('backToInventory')}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold tracking-tight">{t('judul')}</h1>
          <TombolBantuan judul={t('judul')} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dateRange')}</CardTitle>
        </CardHeader>
        <CardContent>
          <DateRangePicker
            id="stock-card-date-range"
            triggerClassName="min-h-[44px] max-w-md"
            value={{
              from: parseDateOnly(dateFrom),
              to: parseDateOnly(dateTo),
            }}
            onChange={(range) => {
              setDateFrom(range?.from ? formatDateOnly(range.from) : '');
              setDateTo(range?.to ? formatDateOnly(range.to) : '');
            }}
          />
        </CardContent>
      </Card>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
        <TabsList>
          <TabsTrigger value="by-item">{t('tabByItem')}</TabsTrigger>
          <TabsTrigger value="by-type">{t('tabByType')}</TabsTrigger>
          <TabsTrigger value="by-category">{t('tabByCategory')}</TabsTrigger>
        </TabsList>

        <TabsContent value="by-item" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('filter')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div className="space-y-2">
              <Label>{t('item')}</Label>
              <SearchableCombobox
                options={summary.map((s) => ({
                  value: s.itemId,
                  label: `${s.item?.sku ?? '-'} – ${s.item?.nameId ?? '-'}`,
                }))}
                value={itemId}
                onValueChange={(v) => {
                  setItemId(v);
                  setData(null);
                  setVariantSku('');
                }}
                placeholder={t('selectItem')}
                searchPlaceholder={t('cariBarang')}
                triggerClassName="min-h-[44px]"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={loadStockCard}
                disabled={isLoading || !itemId}
                className="min-h-[44px] w-full"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  t('load')
                )}
              </Button>
            </div>
            <div className="space-y-2">
              <Label>{t('variantOptional')}</Label>
              <SearchableCombobox
                options={[
                  { value: '__all__', label: t('allVariants') },
                  ...variantOptions.map((sku) => ({ value: sku, label: sku })),
                ]}
                value={variantSku || '__all__'}
                onValueChange={(v) => setVariantSku(v === '__all__' ? '' : v)}
                placeholder={t('allVariants')}
                searchPlaceholder={t('cariVarian')}
                triggerClassName="min-h-[44px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {data.item?.sku} – {data.item?.nameId}
              {data.item?.uom && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({data.item.uom.code})
                </span>
              )}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handlePrintByItem} className="min-h-[44px]">
                <Printer className="mr-2 h-4 w-4" />
                {t('print')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport} className="min-h-[44px]">
                <Download className="mr-2 h-4 w-4" />
                {t('exportCsv')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">{t('openingBalance')}</p>
                <p className="text-lg font-semibold">
                  {data.openingBalance.toLocaleString('id-ID')} {data.item?.uom?.code ?? ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.openingValue != null ? `Rp ${data.openingValue.toLocaleString('id-ID')}` : '—'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('closingBalance')}</p>
                <p className="text-lg font-semibold">
                  {data.closingBalance.toLocaleString('id-ID')} {data.item?.uom?.code ?? ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  {data.closingValue != null ? `Rp ${data.closingValue.toLocaleString('id-ID')}` : '—'}
                </p>
              </div>
            </div>

            {/*
             * Always visible, regardless of movements.length - the same idiom the store
             * detail card uses for its own ledger-cutover note. Value history (unit cost,
             * inventory value) only starts once the value columns were added; quantity
             * history on the ledger starts earlier, at the ledger's own cutover.
             */}
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>{t('valueHistoryNote')}</AlertDescription>
            </Alert>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colDoc')}</TableHead>
                    <TableHead>{t('colDesc')}</TableHead>
                    <TableHead className="hidden 2xl:table-cell">{t('colNotes')}</TableHead>
                    <TableHead>{t('colVariant')}</TableHead>
                    <TableHead>{t('colUom')}</TableHead>
                    <TableHead className="text-right text-green-600 dark:text-green-400">{t('colIn')}</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">{t('colOut')}</TableHead>
                    <TableHead className="text-right">{t('colBalance')}</TableHead>
                    <TableHead className="text-right">{t('colUnitCost')}</TableHead>
                    <TableHead className="text-right">{t('colBalanceValue')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{formatDisplayDateTime(m.date, locale)}</TableCell>
                      <TableCell className="font-medium">{m.docNumber || '-'}</TableCell>
                      <TableCell className="whitespace-normal min-w-[160px]">{describeRefType(m.refType)}</TableCell>
                      {/* StockLedgerEntry has no notes column - always empty for a ledger row. */}
                      <TableCell className="hidden 2xl:table-cell">-</TableCell>
                      <TableCell>{m.variantSku ?? '-'}</TableCell>
                      {/* Ledger qty is in the item's base UOM, the same unit material issues use. */}
                      <TableCell>{data.item?.uom?.code ?? '-'}</TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {m.in != null ? m.in.toLocaleString('id-ID') : '-'}
                      </TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400">
                        {m.out != null ? m.out.toLocaleString('id-ID') : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.balance.toLocaleString('id-ID')}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.unitCost != null
                          ? `Rp ${m.unitCost.toLocaleString('id-ID')}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.balanceValue != null ? `Rp ${m.balanceValue.toLocaleString('id-ID')}` : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {loadedOnce && data && data.movements.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          {t('noMovements')}
        </p>
      )}
        </TabsContent>

        <TabsContent value="by-type" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('filter')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('itemType')}</Label>
                  <Select
                    value={typeFilter}
                    onValueChange={(v) => {
                      setTypeFilter(v as 'raw' | 'finished');
                      setDataByType(null);
                    }}
                  >
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="raw">{t('typeRawLong')}</SelectItem>
                      <SelectItem value="finished">{t('typeFinished')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={loadStockCardByType}
                    disabled={isLoading}
                    className="min-h-[44px] w-full"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('load')
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {dataByType && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {t('byTypeTitle', { type: typeFilter === 'raw' ? t('typeRaw') : t('typeFinished') })}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => void handlePrintByType()} className="min-h-[44px]">
                  <Printer className="mr-2 h-4 w-4" />
                  {t('print')}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Always visible - see the by-item tab's Alert above for why. */}
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t('valueHistoryNote')}</AlertDescription>
                </Alert>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('colItem')}</TableHead>
                        <TableHead>{t('colUom')}</TableHead>
                        <TableHead className="text-right">{t('colOpening')}</TableHead>
                        <TableHead className="text-right">{t('colClosing')}</TableHead>
                        <TableHead className="text-right">{t('colMovements')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dataByType.items.map((row, idx) => {
                        const itemKey = row.item?.sku ?? `row-${idx}`;
                        const isOpen = expandedByType.has(itemKey);
                        const toggle = () => {
                          setExpandedByType((prev) => {
                            const next = new Set(prev);
                            if (next.has(itemKey)) next.delete(itemKey);
                            else next.add(itemKey);
                            return next;
                          });
                        };
                        return (
                          <Fragment key={itemKey}>
                            <TableRow>
                              <TableCell className="w-8 p-1 align-middle">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={toggle}
                                  aria-expanded={isOpen}
                                  aria-label={t(isOpen ? 'collapseRow' : 'expandRow', { sku: row.item?.sku ?? '-' })}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium whitespace-nowrap">{row.item?.sku ?? '-'}</TableCell>
                              <TableCell className="whitespace-normal min-w-[180px]">{row.item?.nameId ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.uom?.code ?? '-'}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.openingBalance.toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.closingBalance.toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">{row.movements.length}</TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow>
                                <TableCell colSpan={7} className="bg-muted/30 p-0 align-top">
                                  <div className="overflow-x-auto p-4">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>{t('colDate')}</TableHead>
                                          <TableHead>{t('colDoc')}</TableHead>
                                          <TableHead>{t('colDesc')}</TableHead>
                                          <TableHead>{t('colNotes')}</TableHead>
                                          <TableHead className="text-right">{t('colIn')}</TableHead>
                                          <TableHead className="text-right">{t('colOut')}</TableHead>
                                          <TableHead className="text-right">{t('colBalance')}</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {row.movements.map((m) => (
                                          <TableRow key={m.id}>
                                            <TableCell className="whitespace-nowrap">{formatDisplayDateTime(m.date, locale)}</TableCell>
                                            <TableCell className="font-medium">{m.docNumber || '-'}</TableCell>
                                            <TableCell className="whitespace-normal min-w-[180px]">{describeRefType(m.refType)}</TableCell>
                                            {/* StockLedgerEntry has no notes column - always empty for a ledger row. */}
                                            <TableCell>-</TableCell>
                                            <TableCell className="text-right text-green-600 dark:text-green-400">
                                              {m.in != null ? m.in.toLocaleString('id-ID') : '-'}
                                            </TableCell>
                                            <TableCell className="text-right text-red-600 dark:text-red-400">
                                              {m.out != null ? m.out.toLocaleString('id-ID') : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{m.balance.toLocaleString('id-ID')}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {dataByType.items.length === 0 && (
                  <p className="text-muted-foreground text-center py-6">
                    {t('noItemsByType')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="by-category" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('filter')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('itemCategory')}</Label>
                  <Select
                    value={categoryId || '__none__'}
                    onValueChange={(v) => {
                      setCategoryId(v === '__none__' ? '' : v);
                      setDataByCategory(null);
                    }}
                  >
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue placeholder={t('selectCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('selectCategory')}</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.code ? ` (${c.code})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    onClick={loadStockCardByCategory}
                    disabled={isLoading || !categoryId}
                    className="min-h-[44px] w-full"
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('load')
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {dataByCategory && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  {t('byCategoryTitle', { category: dataByCategory.category.name })}
                  {dataByCategory.category.code && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({dataByCategory.category.code})
                    </span>
                  )}
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => void handlePrintByCategory()} className="min-h-[44px]">
                  <Printer className="mr-2 h-4 w-4" />
                  {t('print')}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Always visible - see the by-item tab's Alert above for why. */}
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>{t('valueHistoryNote')}</AlertDescription>
                </Alert>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>{t('colItem')}</TableHead>
                        <TableHead>{t('colUom')}</TableHead>
                        <TableHead className="text-right">{t('colOpening')}</TableHead>
                        <TableHead className="text-right">{t('colClosing')}</TableHead>
                        <TableHead className="text-right">{t('colMovements')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dataByCategory.items.map((row, idx) => {
                        const itemKey = row.item?.sku ?? `row-${idx}`;
                        const isOpen = expandedByCategory.has(itemKey);
                        const toggle = () => {
                          setExpandedByCategory((prev) => {
                            const next = new Set(prev);
                            if (next.has(itemKey)) next.delete(itemKey);
                            else next.add(itemKey);
                            return next;
                          });
                        };
                        return (
                          <Fragment key={itemKey}>
                            <TableRow>
                              <TableCell className="w-8 p-1 align-middle">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 shrink-0"
                                  onClick={toggle}
                                  aria-expanded={isOpen}
                                  aria-label={t(isOpen ? 'collapseRow' : 'expandRow', { sku: row.item?.sku ?? '-' })}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium whitespace-nowrap">{row.item?.sku ?? '-'}</TableCell>
                              <TableCell className="whitespace-normal min-w-[180px]">{row.item?.nameId ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.uom?.code ?? '-'}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.openingBalance.toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.closingBalance.toLocaleString('id-ID')}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">{row.movements.length}</TableCell>
                            </TableRow>
                            {isOpen && (
                              <TableRow>
                                <TableCell colSpan={7} className="bg-muted/30 p-0 align-top">
                                  <div className="overflow-x-auto p-4">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>{t('colDate')}</TableHead>
                                          <TableHead>{t('colDoc')}</TableHead>
                                          <TableHead>{t('colDesc')}</TableHead>
                                          <TableHead>{t('colNotes')}</TableHead>
                                          <TableHead className="text-right">{t('colIn')}</TableHead>
                                          <TableHead className="text-right">{t('colOut')}</TableHead>
                                          <TableHead className="text-right">{t('colBalance')}</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {row.movements.map((m) => (
                                          <TableRow key={m.id}>
                                            <TableCell className="whitespace-nowrap">{formatDisplayDateTime(m.date, locale)}</TableCell>
                                            <TableCell className="font-medium">{m.docNumber || '-'}</TableCell>
                                            <TableCell className="whitespace-normal min-w-[180px]">{describeRefType(m.refType)}</TableCell>
                                            {/* StockLedgerEntry has no notes column - always empty for a ledger row. */}
                                            <TableCell>-</TableCell>
                                            <TableCell className="text-right text-green-600 dark:text-green-400">
                                              {m.in != null ? m.in.toLocaleString('id-ID') : '-'}
                                            </TableCell>
                                            <TableCell className="text-right text-red-600 dark:text-red-400">
                                              {m.out != null ? m.out.toLocaleString('id-ID') : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{m.balance.toLocaleString('id-ID')}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                {dataByCategory.items.length === 0 && (
                  <p className="text-muted-foreground text-center py-6">
                    {t('noItemsByCategory')}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
