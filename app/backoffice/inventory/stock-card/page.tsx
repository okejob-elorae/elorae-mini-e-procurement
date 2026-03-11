'use client';

import React, { useState, useCallback, useEffect, Fragment } from 'react';
import Link from 'next/link';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableCombobox } from '@/components/ui/searchable-combobox';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowLeft, Download, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { getStockCard, getStockCardByType, getStockCardByCategory, getCurrentStockSummary, getItemVariantOptions } from '@/app/actions/stock-card';
import { getItemCategories } from '@/app/actions/item-categories';
import { toast } from 'sonner';

const defaultFrom = startOfDay(subDays(new Date(), 30));
const defaultTo = endOfDay(new Date());

type ViewMode = 'by-item' | 'by-type' | 'by-category';

export default function StockCardPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('by-item');
  const [itemId, setItemId] = useState<string>('');
  const [dateFrom, setDateFrom] = useState(format(defaultFrom, 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(defaultTo, 'yyyy-MM-dd'));
  const [variantSku, setVariantSku] = useState<string>('');
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
      toast.error('Failed to load items');
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const list = await getItemCategories(true);
      setCategories(list);
    } catch {
      toast.error('Failed to load categories');
    }
  }, []);

  const loadStockCard = useCallback(async () => {
    if (!itemId) {
      toast.error('Select an item');
      return;
    }
    setIsLoading(true);
    try {
      const from = startOfDay(new Date(dateFrom));
      const to = endOfDay(new Date(dateTo));
      const result = await getStockCard(itemId, { from, to }, variantSku || undefined);
      setData(result);
      setLoadedOnce(true);
    } catch {
      toast.error('Failed to load stock card');
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [itemId, dateFrom, dateTo, variantSku]);

  const loadStockCardByType = useCallback(async () => {
    setIsLoading(true);
    try {
      const from = startOfDay(new Date(dateFrom));
      const to = endOfDay(new Date(dateTo));
      const result = await getStockCardByType(typeFilter, { from, to });
      setDataByType(result);
      setLoadedOnce(true);
    } catch {
      toast.error('Failed to load stock card by type');
      setDataByType(null);
    } finally {
      setIsLoading(false);
    }
  }, [typeFilter, dateFrom, dateTo]);

  const loadStockCardByCategory = useCallback(async () => {
    if (!categoryId) {
      toast.error('Select a category');
      return;
    }
    setIsLoading(true);
    try {
      const from = startOfDay(new Date(dateFrom));
      const to = endOfDay(new Date(dateTo));
      const result = await getStockCardByCategory(categoryId, { from, to });
      setDataByCategory(result);
      setLoadedOnce(true);
    } catch {
      toast.error('Failed to load stock card by category');
      setDataByCategory(null);
    } finally {
      setIsLoading(false);
    }
  }, [categoryId, dateFrom, dateTo]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

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
    const rows = data.movements.map((m) => [
      format(new Date(m.date), 'yyyy-MM-dd HH:mm'),
      m.docNumber,
      m.description,
      m.in ?? '',
      m.out ?? '',
      m.balance,
      m.unitCost ?? '',
      m.balanceValue,
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-card-${data.item?.sku ?? itemId}-${dateFrom}-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link href="/backoffice/inventory">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Stock Card</h1>
          <p className="text-muted-foreground">
            Movement history and running balance by item, by item type, or by item category
          </p>
        </div>
      </div>

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
        <TabsList>
          <TabsTrigger value="by-item">By item</TabsTrigger>
          <TabsTrigger value="by-type">By item type</TabsTrigger>
          <TabsTrigger value="by-category">By item category</TabsTrigger>
        </TabsList>

        <TabsContent value="by-item" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Filter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-5">
            <div className="space-y-2">
              <Label>Item</Label>
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
                placeholder="Select item"
                triggerClassName="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>From date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-[44px]"
              />
            </div>
            <div className="space-y-2">
              <Label>To date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-[44px]"
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
                  'Load'
                )}
              </Button>
            </div>
            <div className="space-y-2">
              <Label>Variant (optional)</Label>
              <SearchableCombobox
                options={[
                  { value: '__all__', label: 'All variants' },
                  ...variantOptions.map((sku) => ({ value: sku, label: sku })),
                ]}
                value={variantSku || '__all__'}
                onValueChange={(v) => setVariantSku(v === '__all__' ? '' : v)}
                placeholder="All variants"
                triggerClassName="min-h-[44px]"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {data && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {data.item?.sku} – {data.item?.nameId}
              {data.item?.uom && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  ({data.item.uom.code})
                </span>
              )}
            </CardTitle>
            <Button variant="outline" size="sm" onClick={handleExport} className="min-h-[44px]">
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2 print:grid-cols-2">
              <div>
                <p className="text-sm text-muted-foreground">Opening balance</p>
                <p className="text-lg font-semibold">
                  {data.openingBalance.toLocaleString()} {data.item?.uom?.code ?? ''}
                </p>
                <p className="text-sm text-muted-foreground">
                  Rp {data.openingValue.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Closing balance</p>
                <p className="text-lg font-semibold">
                  {data.closingBalance.toLocaleString()} {data.item?.uom?.code ?? ''}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tanggal</TableHead>
                    <TableHead>Dokumen</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead className="text-right text-green-600 dark:text-green-400">Masuk</TableHead>
                    <TableHead className="text-right text-red-600 dark:text-red-400">Keluar</TableHead>
                    <TableHead className="text-right">Sisa</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="text-right">Nilai Persediaan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.movements.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell>{format(new Date(m.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                      <TableCell className="font-medium">{m.docNumber}</TableCell>
                      <TableCell>{m.description}</TableCell>
                      <TableCell>{m.variantSku ?? '-'}</TableCell>
                      <TableCell className="text-right text-green-600 dark:text-green-400">
                        {m.in != null ? m.in.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-red-600 dark:text-red-400">
                        {m.out != null ? m.out.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.balance.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.unitCost != null
                          ? `Rp ${m.unitCost.toLocaleString()}`
                          : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {m.balanceValue.toLocaleString()}
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
          No movements in the selected date range.
        </p>
      )}
        </TabsContent>

        <TabsContent value="by-type" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Filter</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Item type</Label>
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
                      <SelectItem value="raw">Raw materials (Fabric + Accessories)</SelectItem>
                      <SelectItem value="finished">Finished goods</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>From date</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>To date</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="min-h-[44px]"
                  />
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
                      'Load'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {dataByType && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Stock card by type: {typeFilter === 'raw' ? 'Raw materials' : 'Finished goods'}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">Closing</TableHead>
                        <TableHead className="text-right">Movements</TableHead>
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
                                  aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium whitespace-nowrap">{row.item?.sku ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.nameId ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.uom?.code ?? '-'}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.openingBalance.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.closingBalance.toLocaleString()}
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
                                          <TableHead>Date</TableHead>
                                          <TableHead>Doc</TableHead>
                                          <TableHead>Description</TableHead>
                                          <TableHead className="text-right">In</TableHead>
                                          <TableHead className="text-right">Out</TableHead>
                                          <TableHead className="text-right">Balance</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {row.movements.map((m) => (
                                          <TableRow key={m.id}>
                                            <TableCell className="whitespace-nowrap">{format(new Date(m.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                                            <TableCell className="font-medium">{m.docNumber ?? '-'}</TableCell>
                                            <TableCell>{m.description}</TableCell>
                                            <TableCell className="text-right text-green-600 dark:text-green-400">
                                              {m.in != null ? m.in.toLocaleString() : '-'}
                                            </TableCell>
                                            <TableCell className="text-right text-red-600 dark:text-red-400">
                                              {m.out != null ? m.out.toLocaleString() : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{m.balance.toLocaleString()}</TableCell>
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
                    No items of this type or no movements in the selected date range.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="by-category" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Filter</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
                <div className="space-y-2">
                  <Label>Item category</Label>
                  <Select
                    value={categoryId || '__none__'}
                    onValueChange={(v) => {
                      setCategoryId(v === '__none__' ? '' : v);
                      setDataByCategory(null);
                    }}
                  >
                    <SelectTrigger className="min-h-[44px]">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Select category</SelectItem>
                      {categories.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                          {c.code ? ` (${c.code})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>From date</Label>
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="min-h-[44px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label>To date</Label>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="min-h-[44px]"
                  />
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
                      'Load'
                    )}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {dataByCategory && (
            <Card>
              <CardHeader>
                <CardTitle>
                  Stock card by category: {dataByCategory.category.name}
                  {dataByCategory.category.code && (
                    <span className="ml-2 text-sm font-normal text-muted-foreground">
                      ({dataByCategory.category.code})
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>Item</TableHead>
                        <TableHead>UOM</TableHead>
                        <TableHead className="text-right">Opening</TableHead>
                        <TableHead className="text-right">Closing</TableHead>
                        <TableHead className="text-right">Movements</TableHead>
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
                                  aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium whitespace-nowrap">{row.item?.sku ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.nameId ?? '-'}</TableCell>
                              <TableCell className="whitespace-nowrap">{row.item?.uom?.code ?? '-'}</TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.openingBalance.toLocaleString()}
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">
                                {row.closingBalance.toLocaleString()}
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
                                          <TableHead>Date</TableHead>
                                          <TableHead>Doc</TableHead>
                                          <TableHead>Description</TableHead>
                                          <TableHead className="text-right">In</TableHead>
                                          <TableHead className="text-right">Out</TableHead>
                                          <TableHead className="text-right">Balance</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {row.movements.map((m) => (
                                          <TableRow key={m.id}>
                                            <TableCell className="whitespace-nowrap">{format(new Date(m.date), 'dd/MM/yyyy HH:mm')}</TableCell>
                                            <TableCell className="font-medium">{m.docNumber ?? '-'}</TableCell>
                                            <TableCell>{m.description}</TableCell>
                                            <TableCell className="text-right text-green-600 dark:text-green-400">
                                              {m.in != null ? m.in.toLocaleString() : '-'}
                                            </TableCell>
                                            <TableCell className="text-right text-red-600 dark:text-red-400">
                                              {m.out != null ? m.out.toLocaleString() : '-'}
                                            </TableCell>
                                            <TableCell className="text-right">{m.balance.toLocaleString()}</TableCell>
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
                    No items in this category or no movements in the selected date range.
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
